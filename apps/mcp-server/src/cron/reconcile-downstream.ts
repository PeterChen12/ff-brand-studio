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

import { and, asc, desc, eq, isNotNull, isNull, sql as drizzleSql } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import {
  integrationCredentials,
  products,
  reconciliationLog,
} from "../db/schema.js";
import { resolveCredentials } from "../integrations/credentials.js";
import { fetchProductStateGeneric } from "../integrations/generic-rest.js";
import { upsertDownstreamState } from "../integrations/downstream-state.js";

const MAX_PRODUCTS_PER_TICK = 50;
// Map FF Studio's internal status set to the tenant-api spec set so
// drift detection compares apples-to-apples regardless of which side
// chose the label.
//
// FIX P5-review #4: do NOT remap "stage_failed" to "staged". That hid
// real delivery failures: when the BFR push errored the local row was
// "stage_failed" and the remote correctly reported "staged" (it had
// never received anything) → previous normalize collapsed both to
// "staged" → no drift recorded. The operator never saw it.
function normalizeStatus(s: string | null | undefined): string | null {
  if (!s) return null;
  const v = s.toLowerCase().trim();
  if (v === "draft" || v === "staged" || v === "active" || v === "archived") return v;
  if (v === "staging") return "staged";
  return v;
}

// Returns true if a product is in a state that hasn't actually been
// pushed downstream yet — we skip reconcile for these because there's
// no remote state to compare against.
function shouldSkipReconcile(localStatus: string | null | undefined): boolean {
  if (!localStatus) return true;
  const v = localStatus.toLowerCase().trim();
  return v === "stage_failed" || v === "draft";
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
      // FIX P5-review #4: don't reconcile products that were never
      // delivered downstream. stage_failed / draft products have no
      // remote counterpart to compare against, and treating their
      // absence as drift would generate noise.
      if (shouldSkipReconcile(product.bfrStatus)) continue;
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
      // P4 — stamp last_reconciled_at via the canonical helper
      // (also mirrors to the legacy column during dual-write).
      await upsertDownstreamState(db, {
        productId: product.id,
        tenantId: integ.tenantId,
        integrationId: integ.id,
        provider: integ.provider,
        externalId: product.externalId,
        bumpReconciledAt: true,
      });

      const local = normalizeStatus(product.bfrStatus);
      const remoteStatus = normalizeStatus(remote?.status);
      if (local === remoteStatus) continue;

      // Drift — record. Resolve idle prior unresolved logs for this
      // product so we don't accumulate dozens of identical rows when
      // the drift persists for hours.
      // FIX P5-review #1: must be isNull(), not eq(..., NULL) — the
      // latter is always false in SQL, so prior rows were never
      // closed and the dashboard drift inbox grew unbounded.
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
            isNull(reconciliationLog.resolvedAt)
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
