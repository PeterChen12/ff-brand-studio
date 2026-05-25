#!/usr/bin/env node
/**
 * Unified migration runner — replaces the 4 near-identical
 * apply-XXXX-*.mjs scripts that grew through the session.
 *
 * Usage:
 *   PG... env vars set
 *   node scripts/apply-migration.mjs 0022          # auto-discovers .sql
 *   node scripts/apply-migration.mjs 0022_webhook  # prefix match also works
 *   node scripts/apply-migration.mjs --list        # list available migrations
 *
 * Auto-discovers the SQL file in `apps/mcp-server/drizzle/` by matching
 * the prefix you pass. Idempotency is the SQL's responsibility (use
 * `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).
 *
 * Required env: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, basename } from "node:path";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "..", "apps", "mcp-server", "drizzle");

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

const arg = process.argv[2];
if (!arg || arg === "--list" || arg === "-l") {
  console.log("Available migrations in", MIGRATIONS_DIR + ":");
  for (const f of listMigrations()) console.log("  " + f);
  process.exit(arg ? 0 : 1);
}

const matches = listMigrations().filter((f) => f.startsWith(arg));
if (matches.length === 0) {
  console.error('No migration found starting with "' + arg + '".');
  console.error("Available:");
  for (const f of listMigrations()) console.error("  " + f);
  process.exit(2);
}
if (matches.length > 1) {
  console.error('Ambiguous prefix "' + arg + '" — matches ' + matches.length + ":");
  for (const f of matches) console.error("  " + f);
  process.exit(3);
}

const migrationFile = matches[0];
const migrationPath = resolve(MIGRATIONS_DIR, migrationFile);
const sql = readFileSync(migrationPath, "utf8");

console.log("[migrate] applying " + migrationFile + "…");

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
  console.log("[migrate] " + basename(migrationFile) + " applied");

  // Best-effort verification: parse the migration to find the most
  // likely changed table, then list its columns. If the parse fails
  // (multi-table migration, view, function) we just skip the verify.
  const tableMatch = sql.match(/(?:CREATE TABLE(?:\s+IF NOT EXISTS)?|ALTER TABLE)\s+([a-z_]+)/i);
  if (tableMatch) {
    const tableName = tableMatch[1];
    const cols = await client.unsafe(
      "SELECT column_name, data_type FROM information_schema.columns " +
        "WHERE table_name = '" + tableName + "' ORDER BY ordinal_position"
    );
    if (cols.length > 0) {
      console.log("[migrate] verified — " + tableName + " has " + cols.length + " column(s):");
      for (const c of cols) console.log("  " + c.column_name + " :: " + c.data_type);
    }
  }
} finally {
  await client.end();
}
