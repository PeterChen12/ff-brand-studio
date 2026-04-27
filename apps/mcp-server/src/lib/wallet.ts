/**
 * Wallet helpers — Phase G4.
 *
 * One source of truth for tenant balance changes. Every cost flows
 * through chargeWallet; every top-up / refund flows through creditWallet.
 * The wallet_ledger row is append-only — the cached
 * tenants.wallet_balance_cents column is a denormalized fast-path that
 * MUST equal the SUM of ledger rows for that tenant.
 *
 * Phase G4 ships these helpers without yet wiring them into
 * runLaunchPipeline (covered by the deliverables checklist but punted
 * to the integration wave that follows G2's domain-handler migration —
 * keeps the migration commit reviewable). Phase H billing immediately
 * builds on chargeWallet for Stripe top-ups.
 */

import { eq, sql } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import { tenants, walletLedger, type WalletLedgerEntry } from "../db/schema.js";

export class InsufficientFundsError extends Error {
  constructor(public balanceCents: number, public requestedCents: number) {
    super(
      `wallet has ${balanceCents}¢, cannot debit ${requestedCents}¢ (would go negative)`
    );
    this.name = "InsufficientFundsError";
  }
}

type Reason =
  | "launch_run"
  | "image_gen"
  | "seo_run"
  | "signup_bonus"
  | "stripe_topup"
  | "refund"
  | "admin_grant"
  | "tenant_created";

export interface WalletChangeInput {
  tenantId: string;
  cents: number; // always positive — sign comes from charge vs credit
  reason: Reason;
  referenceType?: string;
  referenceId?: string;
}

export interface WalletChangeResult {
  balanceAfterCents: number;
  ledgerRow: WalletLedgerEntry;
}

async function applyDelta(
  db: DbClient,
  input: WalletChangeInput,
  delta: number
): Promise<WalletChangeResult> {
  const [tenant] = await db
    .select({
      id: tenants.id,
      balance: tenants.walletBalanceCents,
    })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .limit(1);

  if (!tenant) {
    throw new Error(`tenant not found: ${input.tenantId}`);
  }

  const projected = tenant.balance + delta;
  if (projected < 0) {
    throw new InsufficientFundsError(tenant.balance, Math.abs(delta));
  }

  const [ledgerRow] = await db
    .insert(walletLedger)
    .values({
      tenantId: input.tenantId,
      deltaCents: delta,
      reason: input.reason,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      balanceAfterCents: projected,
    })
    .returning();

  await db
    .update(tenants)
    .set({ walletBalanceCents: projected })
    .where(eq(tenants.id, input.tenantId));

  return { balanceAfterCents: projected, ledgerRow };
}

export function chargeWallet(
  db: DbClient,
  input: WalletChangeInput
): Promise<WalletChangeResult> {
  return applyDelta(db, input, -Math.abs(input.cents));
}

export function creditWallet(
  db: DbClient,
  input: WalletChangeInput
): Promise<WalletChangeResult> {
  return applyDelta(db, input, Math.abs(input.cents));
}

export async function getBalanceCents(
  db: DbClient,
  tenantId: string
): Promise<number> {
  const [row] = await db
    .select({ balance: tenants.walletBalanceCents })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row?.balance ?? 0;
}

/** Drift = cached tenants.wallet_balance_cents − SUM(wallet_ledger.delta_cents). */
export async function reconcileTenant(
  db: DbClient,
  tenantId: string
): Promise<{ cached: number; ledgerSum: number; drift: number }> {
  const [{ cached }] = await db
    .select({ cached: tenants.walletBalanceCents })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const [{ ledgerSum }] = await db
    .select({ ledgerSum: sql<number>`coalesce(sum(delta_cents), 0)::int` })
    .from(walletLedger)
    .where(eq(walletLedger.tenantId, tenantId));
  return { cached, ledgerSum, drift: cached - ledgerSum };
}
