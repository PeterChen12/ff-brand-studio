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
  | "api_key.revoked";

export interface AuditEventInput {
  tenantId: string;
  actor: string | null; // Clerk user id, or null for system events
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export async function auditEvent(
  db: DbClient,
  input: AuditEventInput
): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      tenantId: input.tenantId,
      actor: input.actor,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: (input.metadata ?? {}) as Record<string, unknown>,
    });
  } catch (err) {
    // Audit is non-blocking — log but never fail the parent operation.
    console.error(`[audit ${input.action}] failed:`, err);
  }
}
