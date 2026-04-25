// Apply just the v2 portion of schema.sql to ff_brand_studio.
// Bypasses the v1 pgvector cascade (brand_knowledge table can't be created
// without pgvector, which this prod server doesn't have — the v1 setup-db.mjs
// catches the extension error but not the cascading "relation does not exist"
// error from the index CREATE that follows).
//
// This script is idempotent: every CREATE TABLE uses IF NOT EXISTS,
// every seed uses ON CONFLICT DO NOTHING.
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
  database: "ff_brand_studio",
  max: 1,
};

if (!PG.password) {
  console.error("PGPASSWORD env var required.");
  process.exit(1);
}

const V2_MARKER = "-- v2 ecommerce-imagery schema";

async function main() {
  const sql = readFileSync(join(__dirname, "schema.sql"), "utf8");
  const idx = sql.indexOf(V2_MARKER);
  if (idx === -1) {
    console.error(`v2 marker not found in schema.sql: "${V2_MARKER}"`);
    process.exit(1);
  }
  const v2Sql = sql.slice(idx);

  // Send as a single multi-statement query — naive split(";") breaks on
  // semicolons inside quoted strings (e.g., notes like
  // '2000x2000 recommended; ≥85% product fill').
  const db = postgres({ ...PG, prepare: false });
  try {
    await db.unsafe(v2Sql);
    console.log("✓ v2 schema applied");

    const v2Tables = [
      "seller_profiles",
      "products",
      "product_references",
      "product_variants",
      "platform_assets",
      "platform_specs",
      "launch_runs",
    ];
    const present = await db`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename = ANY(${v2Tables})
      ORDER BY tablename
    `;
    console.log(
      `Verified tables (${present.length}/${v2Tables.length}):`,
      present.map((t) => t.tablename).join(", ")
    );

    const specs = await db`SELECT count(*)::int AS n FROM platform_specs`;
    console.log(`platform_specs rows: ${specs[0].n}`);

    if (present.length !== v2Tables.length) {
      console.error("MISSING tables:", v2Tables.filter((t) => !present.find((p) => p.tablename === t)));
      process.exit(2);
    }
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error("apply-v2-schema failed:", err.message || err);
  process.exit(1);
});
