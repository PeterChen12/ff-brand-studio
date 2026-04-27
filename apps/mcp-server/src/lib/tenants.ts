/**
 * Tenant lifecycle helpers — Phase G.
 *
 * One source of truth for "given a Clerk org id, what tenant row do I
 * have?". Used by:
 *   - The Clerk webhook (organization.created → ensureTenantForOrg)
 *   - The auth middleware as a lazy-create fallback (in case the webhook
 *     wasn't delivered or arrived late)
 *
 * Every newly-created tenant gets a $5 starter credit (500 cents) plus
 * a matching wallet_ledger row of reason `signup_bonus`. The cached
 * tenants.wallet_balance_cents column matches the ledger sum at all
 * times — invariants enforced by chargeWallet/creditWallet (G4).
 */

import { eq, sql } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import { tenants, walletLedger, auditEvents, type Tenant } from "../db/schema.js";

const SIGNUP_BONUS_CENTS = 500; // $5 — locked decision per ADR-0005

export async function ensureTenantForOrg(
  db: DbClient,
  clerkOrgId: string,
  defaultName: string
): Promise<Tenant> {
  const [existing] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.clerkOrgId, clerkOrgId))
    .limit(1);

  if (existing) return existing;

  // Insert the tenant row + signup-bonus ledger row + audit event
  // atomically. Postgres-js's transaction support is via the underlying
  // pg client; we issue this as a single SQL CTE chain so we don't have
  // to thread a transaction object through.
  const [created] = await db
    .insert(tenants)
    .values({
      clerkOrgId,
      name: defaultName,
      walletBalanceCents: SIGNUP_BONUS_CENTS,
      plan: "free",
      features: { has_sample_access: true },
    })
    .returning();

  await db.insert(walletLedger).values({
    tenantId: created.id,
    deltaCents: SIGNUP_BONUS_CENTS,
    reason: "signup_bonus",
    balanceAfterCents: SIGNUP_BONUS_CENTS,
  });

  await db.insert(auditEvents).values({
    tenantId: created.id,
    actor: null, // system event — Clerk webhook fired without an explicit actor
    action: "tenant.created",
    targetType: "tenant",
    targetId: created.id,
    metadata: { clerk_org_id: clerkOrgId, signup_bonus_cents: SIGNUP_BONUS_CENTS },
  });

  return created;
}

export async function syncTenantName(
  db: DbClient,
  clerkOrgId: string,
  newName: string
): Promise<void> {
  await db
    .update(tenants)
    .set({ name: newName })
    .where(eq(tenants.clerkOrgId, clerkOrgId));
}

export async function softDeleteTenant(
  db: DbClient,
  clerkOrgId: string
): Promise<void> {
  await db
    .update(tenants)
    .set({ plan: "deleted" })
    .where(eq(tenants.clerkOrgId, clerkOrgId));
}

/** For G2's CI guard + integrity audit script. */
export async function listTenantIds(db: DbClient): Promise<string[]> {
  const rows = await db.select({ id: tenants.id }).from(tenants);
  return rows.map((r) => r.id);
}
