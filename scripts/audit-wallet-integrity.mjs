#!/usr/bin/env node
/**
 * Phase G4 — wallet integrity check.
 *
 * For every tenant: SUM(wallet_ledger.delta_cents) MUST equal
 * tenants.wallet_balance_cents. Drift indicates a transactional bug
 * (charge/credit didn't run atomically) or manual DB tampering. Either
 * way, alert.
 *
 * Run: PGPASSWORD=... node scripts/audit-wallet-integrity.mjs
 * Returns exit 0 on clean, exit 1 on any drift.
 */

import postgres from "postgres";

const sql = postgres({
  host: process.env.PGHOST || "170.9.252.93",
  port: Number(process.env.PGPORT || 5433),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "ff_brand_studio",
  ssl: false,
  max: 1,
});

if (!process.env.PGPASSWORD) {
  console.error("PGPASSWORD env var required");
  process.exit(1);
}

try {
  const rows = await sql`
    SELECT
      t.id,
      t.name,
      t.wallet_balance_cents AS cached,
      COALESCE(SUM(wl.delta_cents), 0)::int AS ledger_sum,
      t.wallet_balance_cents - COALESCE(SUM(wl.delta_cents), 0)::int AS drift,
      COUNT(wl.id)::int AS ledger_rows
    FROM tenants t
    LEFT JOIN wallet_ledger wl ON wl.tenant_id = t.id
    GROUP BY t.id, t.name, t.wallet_balance_cents
    ORDER BY t.created_at
  `;

  let driftFound = 0;
  console.log(`audit-wallet-integrity — ${rows.length} tenant(s)`);
  for (const r of rows) {
    const sign = r.drift === 0 ? "✓" : "✗";
    console.log(
      `  ${sign} ${r.name.padEnd(40)} cached=${r.cached}¢ ledger=${r.ledger_sum}¢ rows=${r.ledger_rows} drift=${r.drift}¢`
    );
    if (r.drift !== 0) driftFound++;
  }

  if (driftFound > 0) {
    console.error(
      `\n✗ ${driftFound} tenant(s) have wallet drift — investigate immediately`
    );
    process.exit(1);
  }
  console.log("\n✓ all tenants reconcile cleanly");
} finally {
  await sql.end({ timeout: 5 });
}
