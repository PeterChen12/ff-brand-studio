// Phase 3 end-to-end test — verifies plan §3.4 acceptance.
// Run: PGPASSWORD=... npx tsx scripts/test-phase3-pipeline.ts
//
// Inserts a test seller + product if missing, resets prior platform_assets
// for the product, runs the orchestrator, asserts ≥10 platform_assets and
// status=succeeded within 90s wall-clock.

import postgres from "postgres";
import { createDbClient } from "../apps/mcp-server/src/db/client.js";
import { runLaunchPipeline } from "../apps/mcp-server/src/orchestrator/launch_pipeline.js";

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

const raw = postgres(PG);

async function ensureTestSeller(): Promise<string> {
  const existing = await raw`
    SELECT id::text AS id FROM seller_profiles WHERE org_name_en = 'V2_TEST_SELLER' LIMIT 1
  `;
  if (existing.length > 0) return existing[0].id;
  const inserted = await raw`
    INSERT INTO seller_profiles (org_name_en, org_name_zh, contact_email, amazon_seller_id)
    VALUES ('V2_TEST_SELLER', '测试卖家', 'test@example.com', 'A-TEST-SELLER-1')
    RETURNING id::text AS id
  `;
  return inserted[0].id;
}

async function ensureTestProduct(sellerId: string): Promise<string> {
  const sku = "V2-TEST-DRINKWARE-001";
  const existing = await raw`SELECT id::text AS id FROM products WHERE sku = ${sku} LIMIT 1`;
  if (existing.length > 0) {
    const productId = existing[0].id;
    // Reset prior test assets / variants
    await raw`DELETE FROM platform_assets WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = ${productId}::uuid)`;
    await raw`DELETE FROM product_variants WHERE product_id = ${productId}::uuid`;
    return productId;
  }
  const inserted = await raw`
    INSERT INTO products (seller_id, sku, name_en, name_zh, category, colors_hex)
    VALUES (
      ${sellerId}::uuid,
      ${sku},
      'Test 24oz Insulated Tumbler',
      '测试 24盎司保温杯',
      'drinkware',
      ARRAY['#0a1f44', '#c0c0c0']::text[]
    )
    RETURNING id::text AS id
  `;
  return inserted[0].id;
}

async function main() {
  const sellerId = await ensureTestSeller();
  const productId = await ensureTestProduct(sellerId);
  console.log(`Test seller:   ${sellerId}`);
  console.log(`Test product:  ${productId}`);

  const env = {
    PGHOST: PG.host,
    PGPORT: String(PG.port),
    PGUSER: PG.user,
    PGPASSWORD: PG.password!,
    PGDATABASE: PG.database,
  } as unknown as CloudflareBindings;
  const db = createDbClient(env);

  const startedAt = Date.now();
  const result = await runLaunchPipeline(db, {
    product_id: productId,
    platforms: ["amazon", "shopify"],
    include_video: true,
    dry_run: false,
  });
  const wallMs = Date.now() - startedAt;

  const assetsCount = await raw`
    SELECT count(*)::int AS n
    FROM platform_assets
    WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = ${productId}::uuid)
  `;
  const violationsCount = await raw`
    SELECT count(*)::int AS n
    FROM platform_assets
    WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = ${productId}::uuid)
      AND compliance_issues IS NOT NULL
  `;

  console.log("\n──────────── Phase 3 acceptance ────────────");
  console.log(`run_id:               ${result.run_id}`);
  console.log(`status:               ${result.status}`);
  console.log(
    `canonicals produced:  ${result.canonicals.length} (${result.canonicals
      .map((c) => c.kind)
      .join(", ")})`
  );
  console.log(`adapter_results:      ${result.adapter_results.length}`);
  console.log(`platform_assets rows: ${assetsCount[0].n}`);
  console.log(`spec violations:      ${violationsCount[0].n}`);
  console.log(`duration_ms:          ${result.duration_ms}`);
  console.log(`wall-clock from test: ${wallMs}ms`);
  console.log(`total_cost_cents:     ${result.total_cost_cents}`);
  console.log("\nadapter detail:");
  for (const ar of result.adapter_results) {
    const flag = ar.spec_compliant ? "  " : "✗ ";
    console.log(
      `  ${flag}${ar.platform.padEnd(8)} ${ar.slot.padEnd(22)} ${
        ar.spec_violations.length > 0 ? ar.spec_violations.join("; ") : ""
      }`
    );
  }

  const pass =
    assetsCount[0].n >= 10 && result.status === "succeeded" && wallMs < 90_000;

  console.log(`\nVerdict: ${pass ? "PASS" : "FAIL"}`);
  if (!pass) {
    if (assetsCount[0].n < 10) console.log(`  - assets count ${assetsCount[0].n} < 10`);
    if (result.status !== "succeeded") console.log(`  - status ${result.status}`);
    if (wallMs >= 90_000) console.log(`  - wall-clock ${wallMs}ms >= 90000ms`);
    process.exitCode = 1;
  }

  await raw.end();
}

main().catch((err) => {
  console.error(err);
  raw.end();
  process.exit(1);
});
