/**
 * Phase K2 — per-tenant monthly regenerate cap.
 *
 * Counts wallet_ledger rows in the current calendar month with
 * reason='image_gen' and reference_type='regenerate'. Default cap
 * is 200/month; tenants can be widened up to 1000 via
 * `tenant.features.max_regens_per_month`.
 */

import { and, eq, gte, sql } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import { walletLedger, tenants } from "../db/schema.js";

const DEFAULT_CAP = 200;
const HARD_CEILING = 1000;

interface RegenCapResult {
  used: number;
  cap: number;
  allowed: boolean;
}

function startOfMonth(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export async function checkRegenCap(
  db: DbClient,
  tenantId: string
): Promise<RegenCapResult> {
  const [tenantRow] = await db
    .select({ features: tenants.features })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const features = (tenantRow?.features ?? {}) as { max_regens_per_month?: number };
  const cap = Math.min(features.max_regens_per_month ?? DEFAULT_CAP, HARD_CEILING);

  const [{ used }] = await db
    .select({ used: sql<number>`count(*)::int` })
    .from(walletLedger)
    .where(
      and(
        eq(walletLedger.tenantId, tenantId),
        eq(walletLedger.referenceType, "regenerate"),
        gte(walletLedger.at, startOfMonth())
      )
    );

  return { used, cap, allowed: used < cap };
}
