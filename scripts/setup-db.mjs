// One-shot DB setup: creates ff_brand_studio database if it doesn't exist, then runs schema.sql against it.
// Safe: uses CREATE DATABASE / CREATE TABLE IF NOT EXISTS — idempotent, no data changes.
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PG = {
  host: process.env.PGHOST || "170.9.252.93",
  port: parseInt(process.env.PGPORT || "5433"),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD,
  ssl: false,
};

if (!PG.password) {
  console.error("PGPASSWORD env var required. Run with: $env:PGPASSWORD='...'; node scripts/setup-db.mjs");
  process.exit(1);
}

async function main() {
  // Step 1: connect to default 'postgres' DB and create ff_brand_studio if missing
  const root = postgres({ ...PG, database: "postgres", max: 1 });
  try {
    const rows = await root`SELECT 1 FROM pg_database WHERE datname = 'ff_brand_studio'`;
    if (rows.length === 0) {
      console.log("Creating database ff_brand_studio...");
      await root.unsafe(`CREATE DATABASE ff_brand_studio`);
      console.log("✓ Database created");
    } else {
      console.log("✓ Database ff_brand_studio already exists");
    }
  } finally {
    await root.end();
  }

  // Step 2: connect to ff_brand_studio and run schema.sql
  const db = postgres({ ...PG, database: "ff_brand_studio", max: 1 });
  try {
    const schemaSql = readFileSync(join(__dirname, "schema.sql"), "utf8");

    // Split on semicolons, filter empty statements
    const statements = schemaSql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    for (const stmt of statements) {
      // Skip pure comment blocks
      const compact = stmt.replace(/--[^\n]*/g, "").trim();
      if (!compact) continue;
      try {
        await db.unsafe(stmt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // pgvector extension may fail if not installed; log but continue
        if (msg.includes("vector") && msg.includes("does not exist")) {
          console.log("⚠ pgvector extension not available — skipping (ok for MVP)");
          continue;
        }
        throw err;
      }
    }
    console.log("✓ Schema applied");

    // Verify tables
    const tables = await db`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
    console.log("Tables in ff_brand_studio:", tables.map((t) => t.tablename).join(", "));
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
