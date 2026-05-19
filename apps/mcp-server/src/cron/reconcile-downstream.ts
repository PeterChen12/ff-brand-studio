/**
 * P3 — reverse reconciler.
 *
 * Every 15 min the worker's scheduled handler invokes this. For each
 * tenant with at least one active integration, we sample a small
 * batch of products (those with external_id set and oldest
 * last_reconciled_at), fetch their downstream state via the
 * appropriate adapter, and write any drift to reconciliation_log.
 *
 * Bounded per run so we never starve the launch pipeline: at most
 * MAX_PRODUCTS_PER_TICK total fetches across all tenants, with a
 * per-fetch timeout of 10s.
 */

import { and, asc, desc, eq, isNotNull, sql as drizzleSql } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import {
  integrationCredentials,
  products,
  reconciliationLog,
} from "../db/schema.js";
import { resolveCredentials } from "../integrations/credentials.js";
import { fetchProductStateGeneric } from "../integrations/generic-rest.js";

const MAX_PRODUCTS_PER_TICK = 50;
// Map FF Studio's internal status set to the tenant-api spec set so
// drift detection compares apples-to-apples regardless of which side
// chose the label.
function normalizeStatus(s: string | null | undefined): string | null {
  if (!s) return null;
  const v = s.toLowerCase().trim();
  if (v === "draft" || v === "staged" || v === "active" || v === "archived") return v;
  // BFR-internal flavors → spec values.
  if (v === "staging") return "staged";
  if (v === "stage_failed") return "staged"; // we attempted; downstream may not show it
  return v;
}

export interface ReconcileResult {
  tenants: number;
  productsChecked: number;
  driftsRecorded: number;
  fetchErrors: number;
}

export async function reconcileDownstream(
  db: DbClient,
  env: Record<string, unknown>
): Promise<ReconcileResult> {
  // Find every (tenant, integration) pair that's active. We currently
  // only know how to reconcile the generic REST contract (which
  // buyfishingrod-admin also implements), so filter to those two
  // providers — future adapters will extend this list.
  const integrations = await db
    .select({
      id: integrationCredentials.id,
      tenantId: integrationCredentials.tenantId,
      provider: integrationCredentials.provider,
    })
    .from(integrationCredentials)
    .where(eq(integrationCredentials.status, "active"));

  const reconcilable = integrations.filter(
    (i) => i.provider === "buyfishingrod-admin" || i.provider === "generic-rest"
  );

  const result: ReconcileResult = {
    tenants: new Set(reconcilable.map((i) => i.tenantId)).size,
    productsChecked: 0,
    driftsRecorded: 0,
    fetchErrors: 0,
  };

  for (const integ of reconcilable) {
    if (result.productsChecked >= MAX_PRODUCTS_PER_TICK) break;

    let creds;
    try {
      creds = await resolveCredentials(db, env, integ.tenantId, integ.provider);
    } catch (err) {
      console.warn(
        `[reconcile] resolveCredentials failed tenant=${integ.tenantId} provider=${integ.provider}: ${err instanceof Error ? err.message : err}`
      );
      continue;
    }
    const baseUrl = String(creds.config.baseUrl ?? "");
    const signingSecret = String(creds.config.signingSecret ?? "");
    if (!baseUrl || !signingSecret) continue;

    const budget = MAX_PRODUCTS_PER_TICK - result.productsChecked;
    if (budget <= 0) break;

    // Oldest-reconciled-first: ensures every product gets compared
    // eventually even when the total set exceeds the per-tick budget.
    const batch = await db
      .select({
        id: products.id,
        externalId: products.externalId,
        bfrStatus: products.bfrStatus,
      })
      .from(products)
      .where(
        and(
          eq(products.tenantId, integ.tenantId),
          isNotNull(products.externalId)
        )
      )
      .orderBy(asc(products.lastReconciledAt))
      .limit(budget);

    for (const product of batch) {
      result.productsChecked++;
      if (!product.externalId) continue;
      let remote;
      try {
        remote = await fetchProductStateGeneric({
          baseUrl,
          signingSecret,
          externalId: product.externalId,
        });
      } catch (err) {
        result.fetchErrors++;
        console.warn(
          `[reconcile] fetch failed product=${product.id}: ${err instanceof Error ? err.message : err}`
        );
        continue;
      }
      // Stamp last_reconciled_at even on miss / 404 so we don't keep
      // hammering products that don't exist downstream.
      await db
        .update(products)
        .set({ lastReconciledAt: new Date() })
        .where(eq(products.id, product.id));

      const local = normalizeStatus(product.bfrStatus);
      const remoteStatus = normalizeStatus(remote?.status);
      if (local === remoteStatus) continue;

      // Drift — record. Resolve idle prior unresolved logs for this
      // product so we don't accumulate dozens of identical rows when
      // the drift persists for hours.
      result.driftsRecorded++;
      await db
        .update(reconciliationLog)
        .set({
          resolvedAt: drizzleSql`now()`,
          resolution: "superseded",
        })
        .where(
          and(
            eq(reconciliationLog.productId, product.id),
            eq(reconciliationLog.resolvedAt, drizzleSql`NULL` as never)
          )
        )
        .catch(() => {});
      await db.insert(reconciliationLog).values({
        tenantId: integ.tenantId,
        productId: product.id,
        provider: integ.provider,
        externalId: product.externalId,
        localStatus: local,
        remoteStatus,
        diff: {
          local: { status: local },
          remote: { status: remoteStatus, url: remote?.url, lastModifiedAt: remote?.lastModifiedAt },
        },
      });
    }
  }

  return result;
}

/**
 * Read endpoint for the dashboard /library?tab=drift view.
 * Returns the most recent unresolved drift per product.
 */
export async function listUnresolvedDrift(
  db: DbClient,
  tenantId: string,
  limit = 50
): Promise<Array<{
  id: string;
  productId: string;
  provider: string;
  localStatus: string | null;
  remoteStatus: string | null;
  detectedAt: Date;
}>> {
  const rows = await db
    .select({
      id: reconciliationLog.id,
      productId: reconciliationLog.productId,
      provider: reconciliationLog.provider,
      localStatus: reconciliationLog.localStatus,
      remoteStatus: reconciliationLog.remoteStatus,
      detectedAt: reconciliationLog.detectedAt,
      resolvedAt: reconciliationLog.resolvedAt,
    })
    .from(reconciliationLog)
    .where(eq(reconciliationLog.tenantId, tenantId))
    .orderBy(desc(reconciliationLog.detectedAt))
    .limit(limit);
  return rows
    .filter((r) => r.resolvedAt === null)
    .map(({ resolvedAt: _ignore, ...rest }) => rest);
}
