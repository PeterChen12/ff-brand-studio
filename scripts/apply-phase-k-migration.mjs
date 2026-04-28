#!/usr/bin/env node
/**
 * Phase K3 migration runner — applies drizzle/0004_phase_k_approvals.sql.
 * Adds approved_at to platform_listings + platform_assets. Idempotent.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = resolve(
  __dirname,
  "..",
  "apps",
  "mcp-server",
  "drizzle",
  "0004_phase_k_approvals.sql"
);
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
  `[apply-phase-k] target ${target.user}@${target.host}:${target.port}/${target.database}`
);

const client = postgres(target);

try {
  await client.unsafe(sql);
  console.log("[apply-phase-k] migration applied successfully");

  const cols = await client.unsafe(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE column_name = 'approved_at'
     AND table_name IN ('platform_listings', 'platform_assets')`
  );
  console.log(`[apply-phase-k] approved_at on ${cols.length} table(s):`);
  for (const r of cols) console.log(`  ${r.table_name}.${r.column_name}`);
} catch (err) {
  console.error("[apply-phase-k] migration failed:", err);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
