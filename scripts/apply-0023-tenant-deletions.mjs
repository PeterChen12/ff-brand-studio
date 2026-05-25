#!/usr/bin/env node
/**
 * Apply 0023 — tenant_deletions table.
 *
 * Idempotent (CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS);
 * safe to re-run.
 *
 * Required env: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  resolve(
    __dirname,
    "..",
    "apps",
    "mcp-server",
    "drizzle",
    "0023_tenant_deletions.sql"
  ),
  "utf8"
);

const client = postgres({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: false,
  max: 1,
});

try {
  await client.unsafe(sql);
  console.log("[apply-0023] migration applied");

  const cols = await client.unsafe(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'tenant_deletions'
    ORDER BY ordinal_position
  `);
  if (cols.length === 0) {
    throw new Error("tenant_deletions table did not appear after migration");
  }
  console.log("[apply-0023] verified table:");
  for (const c of cols) console.log(`  ${c.column_name} :: ${c.data_type}`);
} finally {
  await client.end();
}
