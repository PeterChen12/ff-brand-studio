#!/usr/bin/env node
/**
 * Image QA Layer 1+3 — apply 0010_image_qa_judgments.sql.
 *
 * Adds the image_qa_judgments table that Layer 1 dual-judge writes
 * model verdicts into and Layer 3 client-instruction regens write
 * iteration rows into.
 *
 * Idempotent (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS).
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
    "0010_image_qa_judgments.sql"
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
  console.log("[apply-0010] migration applied");
  const cols = await client.unsafe(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'image_qa_judgments'
    ORDER BY ordinal_position
  `);
  if (cols.length === 0) {
    console.error("[apply-0010] image_qa_judgments not present after apply");
    process.exit(1);
  }
  console.log(
    `[apply-0010] image_qa_judgments columns: ${cols.map((c) => `${c.column_name}:${c.data_type}`).join(", ")}`
  );
  const indexes = await client.unsafe(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'image_qa_judgments'
  `);
  console.log(
    `[apply-0010] indexes: ${indexes.map((r) => r.indexname).sort().join(", ")}`
  );
} catch (err) {
  console.error("[apply-0010] migration failed:", err);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
