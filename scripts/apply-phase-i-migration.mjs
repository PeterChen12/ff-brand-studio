#!/usr/bin/env node
/**
 * Phase I migration runner — applies drizzle/0003_phase_i_pipeline.sql.
 * Adds products.kind with a category-driven backfill. Idempotent.
 *
 * Usage: PGHOST=... PGPORT=... PGUSER=... PGPASSWORD=... PGDATABASE=...
 *        node scripts/apply-phase-i-migration.mjs
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
  "0003_phase_i_pipeline.sql"
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
  `[apply-phase-i] target ${target.user}@${target.host}:${target.port}/${target.database}`
);

const client = postgres(target);

try {
  await client.unsafe(sql);
  console.log("[apply-phase-i] migration applied successfully");

  const [{ kind_null }] = await client.unsafe(
    `SELECT count(*)::int AS kind_null FROM products WHERE kind IS NULL`
  );
  if (kind_null > 0) {
    throw new Error(`[apply-phase-i] products.kind still has ${kind_null} NULL rows`);
  }

  const dist = await client.unsafe(
    `SELECT kind, count(*)::int AS n FROM products GROUP BY kind ORDER BY n DESC`
  );
  console.log("[apply-phase-i] kind distribution:");
  for (const row of dist) {
    console.log(`  ${row.kind.padEnd(22)} ${row.n}`);
  }
} catch (err) {
  console.error("[apply-phase-i] migration failed:", err);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
