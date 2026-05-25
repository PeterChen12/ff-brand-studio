/**
 * Tenant self-serve deletion — GDPR Article 17 "right to erasure".
 *
 * Workflow (per migration 0023):
 *   1. POST `/v1/tenant/delete-request` → row inserted in `tenant_deletions`
 *      with status='pending', eligible_at = requested_at + GDPR_GRACE_PERIOD_DAYS.
 *   2. GET → returns current status (or {pending: false} if no row).
 *   3. DELETE within the grace window → status='cancelled', cancelled_at
 *      populated. Row stays for audit history. Tenant can request again later.
 *   4. Cron sweep (`sweepExpiredDeletions`) picks up status='pending' AND
 *      eligible_at <= NOW() → flips to status='completed'.
 *
 * IMPORTANT — what the sweep does NOT yet do: cascade-delete the tenant's
 * actual data (assets, runs, products, subscriptions, integration
 * credentials, etc.). The migration creates the request lifecycle; the
 * cascading erasure is a separate, deliberately-manual step. The sweep
 * logs an audit event so an operator can hard-delete on a regular
 * schedule until that wiring lands.
 */

import { and, eq, lte, isNotNull } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import { tenantDeletions, auditEvents } from "../db/schema.js";

/** Days between `requestDeletion` and irreversible erasure. */
export const GDPR_GRACE_PERIOD_DAYS = 30;

export interface DeletionStatus {
  pending: boolean;
  status: "pending" | "cancelled" | "completed" | null;
  requestedAt: Date | null;
  eligibleAt: Date | null;
  cancelledAt: Date | null;
  completedAt: Date | null;
  reason: string | null;
}

const NOT_PENDING: DeletionStatus = {
  pending: false,
  status: null,
  requestedAt: null,
  eligibleAt: null,
  cancelledAt: null,
  completedAt: null,
  reason: null,
};

/** GET `/v1/tenant/delete-request` — current request status (if any). */
export async function getDeletionStatus(
  db: DbClient,
  tenantId: string
): Promise<DeletionStatus> {
  const [row] = await db
    .select()
    .from(tenantDeletions)
    .where(eq(tenantDeletions.tenantId, tenantId))
    .limit(1);

  if (!row) return NOT_PENDING;

  return {
    pending: row.status === "pending",
    status: row.status as DeletionStatus["status"],
    requestedAt: row.requestedAt,
    eligibleAt: row.eligibleAt,
    cancelledAt: row.cancelledAt,
    completedAt: row.completedAt,
    reason: row.reason,
  };
}

/**
 * POST `/v1/tenant/delete-request` — initiate the grace window.
 *
 * INSERT ... ON CONFLICT upserts: if a tenant previously cancelled,
 * they can re-request and the old row is overwritten with a fresh
 * grace window. If they already have a pending request, the request
 * is idempotent (same eligible_at).
 *
 * The audit_events row is the bridge between request and operator-
 * visible action — Settings UIs can list pending deletions by
 * filtering audit_events on action='tenant.deletion_requested'.
 */
export async function requestDeletion(
  db: DbClient,
  tenantId: string,
  reason: string | null
): Promise<DeletionStatus> {
  const now = new Date();
  const eligibleAt = new Date(
    now.getTime() + GDPR_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
  );

  await db
    .insert(tenantDeletions)
    .values({
      tenantId,
      status: "pending",
      requestedAt: now,
      eligibleAt,
      reason,
      cancelledAt: null,
      completedAt: null,
    })
    .onConflictDoUpdate({
      target: tenantDeletions.tenantId,
      set: {
        status: "pending",
        requestedAt: now,
        eligibleAt,
        reason,
        cancelledAt: null,
        completedAt: null,
      },
    });

  await db.insert(auditEvents).values({
    tenantId,
    action: "tenant.deletion_requested",
    targetType: "tenant",
    targetId: tenantId,
    metadata: { eligible_at: eligibleAt.toISOString(), reason },
  });

  return getDeletionStatus(db, tenantId);
}

/**
 * DELETE `/v1/tenant/delete-request` — cancel within the grace window.
 *
 * Only flips `status='pending'` rows to `cancelled`. Already-cancelled
 * or already-completed rows return `{cancelled: false}` so the route
 * maps to 404 (or 409 — current route returns 404 for both, which is
 * the lenient choice).
 */
export async function cancelDeletion(
  db: DbClient,
  tenantId: string
): Promise<{ cancelled: boolean }> {
  const now = new Date();
  const rows = await db
    .update(tenantDeletions)
    .set({ status: "cancelled", cancelledAt: now })
    .where(
      and(
        eq(tenantDeletions.tenantId, tenantId),
        eq(tenantDeletions.status, "pending")
      )
    )
    .returning({ tenantId: tenantDeletions.tenantId });

  if (rows.length === 0) return { cancelled: false };

  await db.insert(auditEvents).values({
    tenantId,
    action: "tenant.deletion_cancelled",
    targetType: "tenant",
    targetId: tenantId,
    metadata: { cancelled_at: now.toISOString() },
  });

  return { cancelled: true };
}

/**
 * Scheduled handler — pick up pending requests past their eligible_at.
 *
 * Soft sweep: flips status to 'completed' + writes an audit event.
 * Does NOT cascade-delete tenant data yet — that wiring is a separate,
 * deliberate operator-driven step (see file header). Returns
 * `{ swept }` so the cron handler in index.ts can log the count.
 */
export async function sweepExpiredDeletions(
  db: DbClient
): Promise<{ swept: number }> {
  const now = new Date();
  const rows = await db
    .update(tenantDeletions)
    .set({ status: "completed", completedAt: now })
    .where(
      and(
        eq(tenantDeletions.status, "pending"),
        lte(tenantDeletions.eligibleAt, now),
        isNotNull(tenantDeletions.eligibleAt)
      )
    )
    .returning({
      tenantId: tenantDeletions.tenantId,
      reason: tenantDeletions.reason,
    });

  for (const row of rows) {
    await db.insert(auditEvents).values({
      tenantId: row.tenantId,
      action: "tenant.deletion_eligible",
      targetType: "tenant",
      targetId: row.tenantId,
      // The label "eligible" not "completed" makes it clear to
      // operators that the grace window passed and the request
      // should now be honoured — the actual data-cascade still
      // needs a human in the loop until the cascade plan ships.
      metadata: {
        completed_at: now.toISOString(),
        reason: row.reason,
        notice:
          "Marked completed in tenant_deletions table; tenant data still needs operator-driven cascade delete.",
      },
    });
  }

  return { swept: rows.length };
}
