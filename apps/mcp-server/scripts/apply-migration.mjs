#!/usr/bin/env node
/**
 * Tiny ad-hoc migration runner — executes the SQL file passed as
 * argv[2] against the prod Postgres. Idempotent SQL (CREATE INDEX IF
 * NOT EXISTS, ALTER TABLE ... ADD COLUMN IF NOT EXISTS) is the
 * convention so re-running is safe.
 *
 * Usage:
 *   node scripts/apply-migration.mjs apps/mcp-server/drizzle/0013_phase_b_ingest.sql
 */
import postgres from "postgres";
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: apply-migration.mjs <path-to-sql>");
  process.exit(1);
}

const sql = postgres({
  host: process.env.PGHOST ?? process.env.FF_PGHOST,
  port: Number(process.env.PGPORT ?? process.env.FF_PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? process.env.FF_PGDATABASE,
  username: process.env.PGUSER ?? process.env.FF_PGUSER,
  password: process.env.PGPASSWORD ?? process.env.FF_PGPASSWORD,
  ssl: false,
  max: 1,
});

try {
  const text = readFileSync(file, "utf8");
  console.log(`applying ${file} (${text.length} bytes)`);
  await sql.unsafe(text);
  console.log("ok");
} catch (err) {
  console.error("migration failed:", err.message);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
