#!/usr/bin/env node
/**
 * Apply 0024 — add `last_error` column to `launch_runs`.
 *
 * Idempotent (ADD COLUMN IF NOT EXISTS); safe to re-run.
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
    "0024_launch_runs_last_error.sql"
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
  console.log("[apply-0024] migration applied");

  const cols = await client.unsafe(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'launch_runs' AND column_name = 'last_error'
  `);
  if (cols.length === 0) {
    throw new Error("last_error column did not appear after migration");
  }
  console.log("[apply-0024] verified:", cols[0]);
} finally {
  await client.end();
}
