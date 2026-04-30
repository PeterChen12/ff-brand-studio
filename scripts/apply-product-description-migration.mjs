#!/usr/bin/env node
/**
 * Issue 2 — apply migration 0008_product_description.sql.
 *
 * Adds a nullable `description` text column to the products table.
 * Idempotent (CREATE COLUMN IF NOT EXISTS); safe to re-run.
 *
 * Required env: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE.
 * Source those from the repo `.env` (mirrored from
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
    "0008_product_description.sql"
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
  console.log("[apply-0008] migration applied");
  const cols = await client.unsafe(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_name = 'products' AND column_name = 'description'`
  );
  if (cols.length === 0) {
    console.error("[apply-0008] description column NOT found after apply");
    process.exit(1);
  }
  console.log(
    `[apply-0008] products.description present: ${cols[0].data_type} (nullable=${cols[0].is_nullable})`
  );
} catch (err) {
  console.error("[apply-0008] migration failed:", err);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
