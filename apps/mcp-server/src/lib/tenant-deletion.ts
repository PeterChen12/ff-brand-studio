/**
 * Tenant self-serve deletion — GDPR Article 17 "right to erasure".
 *
 * STATUS: scaffolding only. The HTTP routes in `index.ts` import
 * `requestDeletion` / `cancelDeletion` / `getDeletionStatus` /
 * `sweepExpiredDeletions` / `GDPR_GRACE_PERIOD_DAYS`, and the
 * scheduled handler imports `sweepExpiredDeletions`. To unblock CI
 * (and therefore the auto-deploy of the multi-tenant work that has
 * piled up since 2026-05-18) this file provides the signatures
 * without the underlying `tenant_deletions` table.
 *
 * What needs to happen for the real implementation:
 *   1. Migration adding `tenant_deletions` (tenantId pk, status:
 *      'pending'|'cancelled'|'completed', requestedAt, eligibleAt,
 *      reason, cancelledAt).
 *   2. `requestDeletion` writes one row, sets `eligibleAt =
 *      requestedAt + GDPR_GRACE_PERIOD_DAYS`.
 *   3. `cancelDeletion` flips status to 'cancelled' if still in grace.
 *   4. `sweepExpiredDeletions` deletes tenant data (assets, runs,
 *      subscriptions, integration credentials) for rows past
 *      eligibleAt, then flips status to 'completed'.
 *
 * Until then:
 *   - GET returns `{ pending: false }` so the Settings UI doesn't get
 *     stuck on a loading state.
 *   - POST throws so callers see a clear error rather than a silent
 *     no-op (deletion is a destructive op; failing loud is correct).
 *   - DELETE returns `{ cancelled: false }` (404 path in the route).
 *   - The cron sweeper is a noop.
 */

import type { DbClient } from "../db/client.js";

/** Days between `requestDeletion` and irreversible erasure. */
export const GDPR_GRACE_PERIOD_DAYS = 30;

export interface DeletionStatus {
  pending: boolean;
  requestedAt: Date | null;
  eligibleAt: Date | null;
  reason: string | null;
}

const NOT_PENDING: DeletionStatus = {
  pending: false,
  requestedAt: null,
  eligibleAt: null,
  reason: null,
};

/** GET `/v1/tenant/delete-request` — current request status (if any). */
export async function getDeletionStatus(
  _db: DbClient,
  _tenantId: string
): Promise<DeletionStatus> {
  // No backing table yet — every tenant looks "not pending". Safe
  // default: Settings UI shows the "Request deletion" affordance,
  // operator gets a clear error from POST below if they click it.
  return NOT_PENDING;
}

/** POST `/v1/tenant/delete-request` — initiate the grace window. */
export async function requestDeletion(
  _db: DbClient,
  _tenantId: string,
  _reason: string | null
): Promise<DeletionStatus> {
  throw new Error(
    "tenant_deletion_not_implemented: " +
      "tenant_deletions table + sweeper not yet shipped. " +
      "Email peter@creatorain.com to delete the tenant manually."
  );
}

/** DELETE `/v1/tenant/delete-request` — cancel within the grace window. */
export async function cancelDeletion(
  _db: DbClient,
  _tenantId: string
): Promise<{ cancelled: boolean }> {
  // No row to cancel — route maps this to 404, which is what we want.
  return { cancelled: false };
}

/** Scheduled handler — sweep tenants past their eligibleAt date. */
export async function sweepExpiredDeletions(
  _db: DbClient
): Promise<{ swept: number }> {
  // No-op until the table lands. Keeping the export so the cron
  // wiring in `index.ts` stays intact — once the table ships, this
  // function gets a real query and the sweep starts running on
  // every */5 cron tick automatically.
  return { swept: 0 };
}
