/**
 * P4 — canonical state helpers.
 *
 * Single entry-point for "this product's state on a downstream
 * destination just changed". All callsites (bulk-approve, the
 * inbound bfr-status-update receiver, the reconciler) call
 * upsertDownstreamState() instead of writing to products.bfr_*
 * directly. The helper dual-writes for the migration window:
 *
 *   - write to product_downstream_state (canonical)
 *   - mirror to products.bfr_* IFF provider === "buyfishingrod-admin"
 *     so legacy reads keep working
 *
 * Once readers all switch to product_downstream_state (P4.5), the
 * mirror gets removed and the bfr_* columns dropped.
 */

import { and, eq, sql as drizzleSql } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import {
  integrationCredentials,
  productDownstreamState,
  products,
} from "../db/schema.js";

export interface DownstreamStatePatch {
  productId: string;
  /** Either integrationId (preferred) OR (tenantId + provider) to look up. */
  integrationId?: string;
  tenantId?: string;
  provider?: string;
  externalId?: string | null;
  externalUrl?: string | null;
  status?: string | null;
  stageEventId?: string | null;
  bumpSyncedAt?: boolean;
  bumpReconciledAt?: boolean;
}

async function resolveIntegrationId(
  db: DbClient,
  tenantId: string,
  provider: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: integrationCredentials.id })
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, provider),
        eq(integrationCredentials.status, "active")
      )
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * Upsert a product's downstream state for a single (product,
 * integration) pair. Dual-writes the legacy bfr_* columns when the
 * provider is "buyfishingrod-admin" so existing readers keep
 * functioning during the migration window.
 *
 * No-op when the integration_id can't be resolved — callers that
 * matter today (bulk-approve, reconciler) already have the id in
 * hand from upstream lookups.
 */
export async function upsertDownstreamState(
  db: DbClient,
  patch: DownstreamStatePatch
): Promise<void> {
  let integrationId = patch.integrationId ?? null;
  let provider = patch.provider ?? null;

  if (!integrationId) {
    if (!patch.tenantId || !patch.provider) {
      throw new Error(
        "upsertDownstreamState: need integrationId OR (tenantId + provider)"
      );
    }
    integrationId = await resolveIntegrationId(db, patch.tenantId, patch.provider);
    if (!integrationId) {
      // No active integration → no canonical row to write. Legacy
      // mirror still runs below (for BFR provider) so the bfr_*
      // column write keeps working during transition.
    }
  }

  if (!provider && integrationId) {
    const [row] = await db
      .select({ provider: integrationCredentials.provider })
      .from(integrationCredentials)
      .where(eq(integrationCredentials.id, integrationId))
      .limit(1);
    provider = row?.provider ?? null;
  }

  // Canonical write — skip when integrationId resolution failed.
  if (integrationId && provider) {
    const now = new Date();
    await db
      .insert(productDownstreamState)
      .values({
        productId: patch.productId,
        integrationId,
        provider,
        externalId: patch.externalId ?? null,
        externalUrl: patch.externalUrl ?? null,
        status: patch.status ?? null,
        stageEventId: patch.stageEventId ?? null,
        lastSyncedAt: patch.bumpSyncedAt ? now : null,
        lastReconciledAt: patch.bumpReconciledAt ? now : null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [productDownstreamState.productId, productDownstreamState.integrationId],
        set: {
          provider,
          ...(patch.externalId !== undefined ? { externalId: patch.externalId } : {}),
          ...(patch.externalUrl !== undefined ? { externalUrl: patch.externalUrl } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.stageEventId !== undefined ? { stageEventId: patch.stageEventId } : {}),
          ...(patch.bumpSyncedAt ? { lastSyncedAt: now } : {}),
          ...(patch.bumpReconciledAt ? { lastReconciledAt: now } : {}),
          updatedAt: now,
        },
      });
  }

  // Legacy mirror: dual-write to products.bfr_* for the
  // buyfishingrod-admin provider so existing reads keep working.
  // Removed in P4.5 once readers all switch to the join table.
  if (provider === "buyfishingrod-admin") {
    const legacyUpdate: Record<string, unknown> = {};
    if (patch.status !== undefined) legacyUpdate.bfrStatus = patch.status;
    if (patch.externalUrl !== undefined) legacyUpdate.bfrUrl = patch.externalUrl;
    if (patch.stageEventId !== undefined) legacyUpdate.bfrStageEventId = patch.stageEventId;
    if (patch.bumpSyncedAt) legacyUpdate.bfrSyncedAt = drizzleSql`now()`;
    if (patch.bumpReconciledAt) legacyUpdate.lastReconciledAt = drizzleSql`now()`;
    if (Object.keys(legacyUpdate).length > 0) {
      await db
        .update(products)
        .set(legacyUpdate)
        .where(eq(products.id, patch.productId));
    }
  }
}

/**
 * Read helper. Returns the canonical row for (product, integration)
 * or, when only product+provider are given, the active integration's
 * row. Falls back to NULL — callers should compose with legacy reads
 * during the dual-write window if they need the shadow.
 */
export async function getDownstreamState(
  db: DbClient,
  args:
    | { productId: string; integrationId: string }
    | { productId: string; tenantId: string; provider: string }
) {
  let integrationId = "integrationId" in args ? args.integrationId : null;
  if (!integrationId) {
    integrationId = await resolveIntegrationId(
      db,
      (args as { tenantId: string }).tenantId,
      (args as { provider: string }).provider
    );
  }
  if (!integrationId) return null;
  const [row] = await db
    .select()
    .from(productDownstreamState)
    .where(
      and(
        eq(productDownstreamState.productId, args.productId),
        eq(productDownstreamState.integrationId, integrationId)
      )
    )
    .limit(1);
  return row ?? null;
}
