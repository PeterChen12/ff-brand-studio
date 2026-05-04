#!/usr/bin/env node
/**
 * Backend audit P1-3/P1-4/P1-6/P2-4 — apply 0009_indexes_audit.sql.
 *
 * Adds composite indexes on hot cursor-paginated paths and tightens
 * the platform_listings_versions FK to ON DELETE CASCADE.
 *
 * Idempotent (CREATE INDEX IF NOT EXISTS + DO $$ guard on the FK
 * alter); safe to re-run.
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
    "0009_indexes_audit.sql"
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
  console.log("[apply-0009] migration applied");

  const indexes = await client.unsafe(`
    SELECT indexname FROM pg_indexes
    WHERE indexname IN (
      'idx_products_tenant_created',
      'idx_launch_runs_tenant_created',
      'idx_assets_tenant_created'
    )
  `);
  console.log(
    `[apply-0009] indexes present: ${indexes.map((r) => r.indexname).sort().join(", ")}`
  );
  if (indexes.length !== 3) {
    console.error(
      `[apply-0009] expected 3 indexes, found ${indexes.length} — investigate`
    );
    process.exit(1);
  }

  const fk = await client.unsafe(`
    SELECT confdeltype FROM pg_constraint
    WHERE conname = 'platform_listings_versions_parent_listing_id_fkey'
  `);
  // 'c' = ON DELETE CASCADE
  if (fk[0]?.confdeltype !== "c") {
    console.error(
      `[apply-0009] platform_listings_versions FK not in CASCADE mode (got ${fk[0]?.confdeltype ?? "missing"})`
    );
    process.exit(1);
  }
  console.log("[apply-0009] platform_listings_versions FK = ON DELETE CASCADE");
} catch (err) {
  console.error("[apply-0009] migration failed:", err);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
