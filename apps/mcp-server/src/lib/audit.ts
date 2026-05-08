/**
 * Audit log helper — Phase G4.
 *
 * Fire-and-forget INSERTs into audit_events. Strongly-typed Action union
 * so call sites can't typo `launch.start` vs `launch_start`. Phase L
 * adds a /audit dashboard route on top of these rows.
 */

import type { DbClient } from "../db/client.js";
import { auditEvents } from "../db/schema.js";

export type AuditAction =
  // tenant lifecycle
  | "tenant.created"
  | "tenant.updated"
  | "tenant.deleted"
  // launch flow
  | "launch.start"
  | "launch.complete"
  | "launch.failed"
  // P0-4 — surfaces a refund-after-failure path that lost money;
  // separate from launch.failed so support can grep for these
  // specifically and reconcile the wallet manually.
  | "launch.refund_failed"
  // listing flow (Phase K)
  | "listing.edit"
  | "listing.publish"
  | "listing.unpublish"
  // product
  | "product.create"
  | "product.delete"
  // wallet
  | "wallet.debit"
  | "wallet.credit"
  | "wallet.refund"
  // billing (Phase H)
  | "billing.stripe_topup"
  | "billing.subscription_change"
  // api keys (Phase L)
  | "api_key.created"
  | "api_key.revoked"
  // promo codes (testing wallet top-ups)
  | "promo.redeem"
  // Phase A2 — emitted by the scheduled zombie sweeper when it
  // force-fails a stuck 'running' run and refunds the pre-charge.
  | "launch.refund_zombie"
  // Phase B (B1) — inbound product ingest from a customer admin.
  // Fires on successful POST /v1/products/ingest; idempotent re-sends
  // do NOT re-emit. Subscribers correlate via metadata.external_id +
  // metadata.external_source so they can match it to their own row.
  | "product.ingested"
  // Phase B (B3) — operator-driven asset review outcomes. Wired by
  // POST /v1/assets/:id/approve and /v1/assets/:id/reject (F4 inbox).
  // asset.published is emitted by marketplace adapters on success.
  | "asset.approved"
  | "asset.rejected"
  | "asset.published";

export interface AuditEventInput {
  tenantId: string;
  actor: string | null; // Clerk user id, or null for system events
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Audit actions that are fan-out events for webhook delivery (Phase L4).
 * Deliveries fire fire-and-forget; failures don't block the parent op.
 */
const WEBHOOK_FAN_OUT: ReadonlySet<AuditAction> = new Set<AuditAction>([
  "launch.complete",
  "launch.failed",
  "listing.publish",
  "listing.unpublish",
  "billing.stripe_topup",
  // Phase B (B3) — events that customer admins (e.g. buyfishingrod-admin)
  // subscribe to so they can pull approved assets back into their own
  // catalog without polling.
  "product.ingested",
  "asset.approved",
  "asset.rejected",
  "asset.published",
]);

export async function auditEvent(
  db: DbClient,
  input: AuditEventInput
): Promise<void> {
  let insertedId: string | null = null;
  try {
    const [row] = await db.insert(auditEvents).values({
      tenantId: input.tenantId,
      actor: input.actor,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: (input.metadata ?? {}) as Record<string, unknown>,
    }).returning({ id: auditEvents.id });
    insertedId = row?.id ?? null;
  } catch (err) {
    // Audit is non-blocking — log but never fail the parent operation.
    console.error(`[audit ${input.action}] failed:`, err);
    return;
  }

  // Phase L4 — webhook fan-out. Don't await; failures land in
  // webhook_deliveries with next_attempt_at populated for the future
  // queue-driven retry to pick up.
  if (insertedId && WEBHOOK_FAN_OUT.has(input.action)) {
    void (async () => {
      try {
        const { deliverEvent } = await import("./webhooks.js");
        await deliverEvent(db, {
          id: insertedId,
          type: input.action,
          tenant_id: input.tenantId,
          created_at: new Date().toISOString(),
          version: 1,
          data: {
            actor: input.actor,
            target_type: input.targetType ?? null,
            target_id: input.targetId ?? null,
            metadata: input.metadata ?? {},
          },
        });
      } catch (err) {
        console.warn(`[webhook ${input.action}] fan-out failed:`, err);
      }
    })();
  }
}
