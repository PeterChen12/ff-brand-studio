import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createDbClient } from "../../src/db/client.js";
import { runLaunchPipeline } from "../../src/orchestrator/launch_pipeline.js";
import { scoreAmazonCompliance } from "../../src/compliance/amazon_scorer.js";
import { scoreShopifyCompliance } from "../../src/compliance/shopify_scorer.js";
import { flagUsAdContent } from "../../src/compliance/us_ad_flagger.js";

/**
 * End-to-end integration test:
 *  1. Seeds a test seller + drinkware product in the live ff_brand_studio DB.
 *  2. Runs the orchestrator with all Phase 3 stub workers.
 *  3. Asserts the orchestrator produces 10 platform_assets in <90s.
 *  4. Runs scorers across all 10 — expects 10 EXCELLENT.
 *  5. Verifies idempotency: re-running the orchestrator does NOT duplicate
 *     rows (P0 #3 fix).
 *
 * Requires PGPASSWORD env. Skips with a clear message if missing.
 */

const PG_PASSWORD = process.env.PGPASSWORD;
const skipReason = !PG_PASSWORD
  ? "PGPASSWORD not set — integration test skipped"
  : null;

const PG = {
  host: process.env.PGHOST || "170.9.252.93",
  port: parseInt(process.env.PGPORT || "5433"),
  user: process.env.PGUSER || "postgres",
  password: PG_PASSWORD,
  ssl: false,
  database: "ff_brand_studio",
  max: 1,
};

let raw: ReturnType<typeof postgres>;
let productId: string;
let sellerId: string;
let tenantId: string;

// Dedicated, isolated tenant for this fixture. It deliberately is NOT the
// sample tenant (whose assets render in every sample-access user's dashboard
// catalog) and NOT the QA tenant (whose own assets the qa loadable-image gate
// inspects) — the stub pipeline this test exercises writes dead _phase3_stub
// r2Urls, and we don't want those surfacing anywhere user-facing. afterAll
// tears the fixture down regardless.
const INT_TEST_CLERK_ORG = "org_v2_int_test";

beforeAll(async () => {
  if (skipReason) return;
  raw = postgres(PG);

  // tenant_id is NOT NULL on seller_profiles + products (constraint added after
  // this fixture was first seeded — the old rows predated it). Get-or-create a
  // dedicated tenant so the INSERTs below always have a valid tenant_id.
  const tenants = await raw`SELECT id::text AS id FROM tenants WHERE clerk_org_id = ${INT_TEST_CLERK_ORG} LIMIT 1`;
  if (tenants.length > 0) {
    tenantId = tenants[0].id;
  } else {
    const ins = await raw`
      INSERT INTO tenants (clerk_org_id, name, plan)
      VALUES (${INT_TEST_CLERK_ORG}, 'V2 Integration Test', 'free')
      RETURNING id::text AS id
    `;
    tenantId = ins[0].id;
  }

  const sellers = await raw`SELECT id::text AS id FROM seller_profiles WHERE org_name_en = 'V2_INT_TEST' LIMIT 1`;
  if (sellers.length > 0) {
    sellerId = sellers[0].id;
  } else {
    const ins = await raw`
      INSERT INTO seller_profiles (tenant_id, org_name_en, contact_email, amazon_seller_id)
      VALUES (${tenantId}::uuid, 'V2_INT_TEST', 'int@test', 'A-INT-1')
      RETURNING id::text AS id
    `;
    sellerId = ins[0].id;
  }

  const products = await raw`SELECT id::text AS id FROM products WHERE sku = 'V2-INT-DRINKWARE' LIMIT 1`;
  if (products.length > 0) {
    productId = products[0].id;
    // Reset for clean run
    await raw`DELETE FROM platform_assets WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = ${productId}::uuid)`;
    await raw`DELETE FROM product_variants WHERE product_id = ${productId}::uuid`;
  } else {
    const ins = await raw`
      INSERT INTO products (tenant_id, seller_id, sku, name_en, category, colors_hex)
      VALUES (${tenantId}::uuid, ${sellerId}::uuid, 'V2-INT-DRINKWARE', 'Int Test Tumbler', 'drinkware', ARRAY['#0a1f44']::text[])
      RETURNING id::text AS id
    `;
    productId = ins[0].id;
  }
}, 30_000);

afterAll(async () => {
  // Clean up the test fixture so it doesn't linger in the SHARED production
  // ff_brand_studio DB. This test runs the legacy stub pipeline (no env), which
  // writes platform_assets with dead `_phase3_stub` r2Urls under the sample
  // tenant — and those surface as BROKEN images in the dashboard's sample
  // catalog for every sample-access tenant. beforeAll only reset state before a
  // run, so the artifacts from the LAST run sat in prod until the next CI run.
  // Tear them down here (afterAll runs even if assertions fail).
  if (raw) {
    try {
      if (productId) {
        await raw`DELETE FROM platform_assets WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = ${productId}::uuid)`;
        await raw`DELETE FROM product_variants WHERE product_id = ${productId}::uuid`;
        await raw`DELETE FROM products WHERE id = ${productId}::uuid`;
      }
      if (sellerId) {
        await raw`DELETE FROM seller_profiles WHERE id = ${sellerId}::uuid`;
      }
    } catch {
      // Best-effort cleanup — never fail the suite on teardown.
    }
    await raw.end();
  }
});

describe.skipIf(skipReason)("full v2 pipeline integration", () => {
  it("orchestrator produces ≥10 platform_assets with 0 spec violations", async () => {
    const env = {
      PGHOST: PG.host,
      PGPORT: String(PG.port),
      PGUSER: PG.user,
      PGPASSWORD: PG.password!,
      PGDATABASE: PG.database,
    } as unknown as CloudflareBindings;
    const db = createDbClient(env);

    const result = await runLaunchPipeline(db, {
      product_id: productId,
      platforms: ["amazon", "shopify"],
      include_video: true,
      dry_run: false,
    });

    expect(result.status).toBe("succeeded");
    expect(result.adapter_results.length).toBeGreaterThanOrEqual(10);
    expect(result.duration_ms).toBeLessThan(90_000);
    const allCompliant = result.adapter_results.every((r) => r.spec_compliant);
    expect(allCompliant).toBe(true);
  });

  it("scorers rate all 10 platform_assets as EXCELLENT", async () => {
    const env = {
      PGHOST: PG.host,
      PGPORT: String(PG.port),
      PGUSER: PG.user,
      PGPASSWORD: PG.password!,
      PGDATABASE: PG.database,
    } as unknown as CloudflareBindings;
    const db = createDbClient(env);

    const assets = await raw`
      SELECT pa.id::text AS id, pa.platform
      FROM platform_assets pa
      JOIN product_variants pv ON pv.id = pa.variant_id
      WHERE pv.product_id = ${productId}::uuid
    `;
    expect(assets.length).toBeGreaterThanOrEqual(10);

    let excellentCount = 0;
    for (const a of assets) {
      const result =
        a.platform === "amazon"
          ? await scoreAmazonCompliance(db, a.id)
          : await scoreShopifyCompliance(db, a.id);
      if (result.rating === "EXCELLENT") excellentCount++;
    }
    expect(excellentCount).toBe(assets.length);
  });

  it("re-running the orchestrator is idempotent (P0 #3 fix)", async () => {
    const env = {
      PGHOST: PG.host,
      PGPORT: String(PG.port),
      PGUSER: PG.user,
      PGPASSWORD: PG.password!,
      PGDATABASE: PG.database,
    } as unknown as CloudflareBindings;
    const db = createDbClient(env);

    const beforeCount = await raw`
      SELECT count(*)::int AS n FROM platform_assets pa
      JOIN product_variants pv ON pv.id = pa.variant_id
      WHERE pv.product_id = ${productId}::uuid
    `;

    await runLaunchPipeline(db, {
      product_id: productId,
      platforms: ["amazon", "shopify"],
      include_video: true,
      dry_run: false,
    });

    const afterCount = await raw`
      SELECT count(*)::int AS n FROM platform_assets pa
      JOIN product_variants pv ON pv.id = pa.variant_id
      WHERE pv.product_id = ${productId}::uuid
    `;

    expect(afterCount[0].n).toBe(beforeCount[0].n);
  });

  it("US ad flagger correctly flags problematic copy", () => {
    expect(flagUsAdContent("clean copy")).toEqual([]);
    const flagged = flagUsAdContent("Best #1 product, guaranteed!");
    expect(flagged.length).toBeGreaterThanOrEqual(2);
  });
});
