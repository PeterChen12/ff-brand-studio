#!/usr/bin/env node
/**
 * Phase G migration runner — reads drizzle/0002_phase_g_tenancy.sql and
 * applies it to one Postgres target. Idempotent: re-running on an
 * already-migrated DB is safe (every CREATE has IF NOT EXISTS, every
 * ALTER ... ADD has IF NOT EXISTS, the backfill is bounded by IS NULL).
 *
 * Usage: PGHOST=... PGPORT=... PGUSER=... PGPASSWORD=... PGDATABASE=...
 *        node scripts/apply-phase-g-migration.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = resolve(__dirname, "..", "apps", "mcp-server", "drizzle", "0002_phase_g_tenancy.sql");
const sql = readFileSync(sqlPath, "utf8");

const target = {
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: false,
  max: 1,
};

console.log(
  `[apply-phase-g] target ${target.user}@${target.host}:${target.port}/${target.database}`
);

const client = postgres(target);

try {
  // The migration is one large SQL document with `DO $$ ... END $$;` blocks
  // that postgres-js needs to execute as a single unsafe() call (no
  // parameterization, no statement-by-statement splitting that would break
  // the dollar-quoted block).
  await client.unsafe(sql);
  console.log("[apply-phase-g] migration applied successfully");

  const [{ tenant_count }] = await client`SELECT count(*)::int AS tenant_count FROM tenants`;
  console.log(`[apply-phase-g] tenants table now has ${tenant_count} row(s)`);

  // Quick integrity audit — any NULL tenant_id remaining means the
  // migration's DO-block guard would have aborted.
  const tables = [
    "seller_profiles",
    "products",
    "product_variants",
    "product_references",
    "platform_assets",
    "launch_runs",
    "assets",
    "run_costs",
  ];
  for (const t of tables) {
    const [{ n }] = await client.unsafe(
      `SELECT count(*)::int AS n FROM ${t} WHERE tenant_id IS NULL`
    );
    if (n > 0) {
      throw new Error(
        `[apply-phase-g] ${t} still has ${n} rows with tenant_id IS NULL`
      );
    }
  }
  console.log("[apply-phase-g] tenancy backfill verified — 0 NULL rows across all 8 domain tables");
} catch (err) {
  console.error("[apply-phase-g] migration failed:", err);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
