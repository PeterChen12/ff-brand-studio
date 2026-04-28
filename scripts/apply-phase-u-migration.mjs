#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  resolve(__dirname, "..", "apps", "mcp-server", "drizzle", "0007_phase_u_rate_limit.sql"),
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
  console.log("[apply-phase-u] migration applied");
  const tables = await client.unsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_name = 'rate_limit_buckets'`
  );
  console.log(`[apply-phase-u] rate_limit_buckets present: ${tables.length > 0}`);
} catch (err) {
  console.error("[apply-phase-u] migration failed:", err);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
