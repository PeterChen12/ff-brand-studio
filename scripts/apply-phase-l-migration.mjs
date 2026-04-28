#!/usr/bin/env node
/**
 * Phase L migration runner — applies drizzle/0005_phase_l_api_keys.sql
 * + drizzle/0006_phase_l_webhooks.sql (if present). Idempotent.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const files = [
  resolve(__dirname, "..", "apps", "mcp-server", "drizzle", "0005_phase_l_api_keys.sql"),
  resolve(__dirname, "..", "apps", "mcp-server", "drizzle", "0006_phase_l_webhooks.sql"),
];

const target = {
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: false,
  max: 1,
};

console.log(`[apply-phase-l] target ${target.user}@${target.host}:${target.port}/${target.database}`);

const client = postgres(target);

try {
  for (const f of files) {
    if (!existsSync(f)) continue;
    const sql = readFileSync(f, "utf8");
    await client.unsafe(sql);
    console.log(`[apply-phase-l] applied ${f.split(/[\\/]/).pop()}`);
  }
  const tables = await client.unsafe(
    `SELECT table_name FROM information_schema.tables
     WHERE table_name IN ('api_keys', 'webhook_subscriptions', 'webhook_deliveries')
     ORDER BY table_name`
  );
  console.log(`[apply-phase-l] tables present: ${tables.map((r) => r.table_name).join(", ")}`);
} catch (err) {
  console.error("[apply-phase-l] migration failed:", err);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
