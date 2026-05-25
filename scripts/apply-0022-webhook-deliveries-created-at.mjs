#!/usr/bin/env node
/**
 * Apply 0022 — add `created_at` column to `webhook_deliveries`.
 *
 * Idempotent (ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS);
 * safe to re-run.
 *
 * Required env: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE.
 * Source from the repo `.env` (mirrored from
 * creatorain/Claude_Code_Context/.env).
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
    "0022_webhook_deliveries_created_at.sql"
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
  console.log("[apply-0022] migration applied");

  const cols = await client.unsafe(`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'webhook_deliveries' AND column_name = 'created_at'
  `);
  if (cols.length === 0) {
    throw new Error("created_at column did not appear after migration");
  }
  console.log("[apply-0022] verified column:", cols[0]);
} finally {
  await client.end();
}
