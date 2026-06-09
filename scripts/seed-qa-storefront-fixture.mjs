/**
 * Seed (or re-seed) the stable QA storefront-preview fixture.
 *
 * The qa repo's `ff-brand-studio-journey` has a test ("storefront preview
 * DELIVERS images for a product that has them") that opens this fixture's
 * drawer via ?focus=<id> and asserts its approved images render — the
 * regression test for the client's "NO ASSETS YET" incident (an unpaginated
 * /api/assets cap hid a product's images). That test needs a QA-tenant product
 * that actually HAS approved images; the QA tenant's own E2E products never get
 * generated images, so we seed a deterministic fixture here.
 *
 * Idempotent: fixed product/variant UUIDs (ON CONFLICT DO NOTHING) + the asset
 * rows are replaced each run. Safe to run repeatedly / after a QA DB reset.
 *
 * Env (same as issue-api-key.mjs):
 *   FF_PGHOST FF_PGPORT FF_PGDATABASE FF_PGUSER PGPASSWORD
 *   (falls back to PGHOST/PGPORT/PGDATABASE/PGUSER if FF_PG* unset)
 *
 * Usage:  node scripts/seed-qa-storefront-fixture.mjs
 */
import postgres from "postgres";

// QA Test Org tenant (isolated — see reference_ff_studio_qa_tenant). Its
// seller_id is reused from an existing QA product (seller_id is NOT NULL).
const QA_TENANT = "7a6479b1-8b39-4b12-affa-3bcb3108ab2f";
const FIXTURE_PRODUCT_ID = "f1f1f1f1-aaaa-4bbb-8ccc-d1d1d1d1d1d1";
const FIXTURE_VARIANT_ID = "f1f1f1f1-aaaa-4bbb-8ccc-d2d2d2d2d2d2";

// Real, publicly-reachable images on the FF R2 bucket (pub-*.r2.dev). Reused
// from a real generated BFR product so the URLs actually load in the browser.
const R2_BASE =
  "https://pub-db3f39e3386347d58359ba96517eec84.r2.dev/tenant/32b1f9d2-6c9c-46bf-a1f6-1be69b1abeb5/pipeline/215a5366-4d87-49d2-8189-907ecc45d059";
const FIXTURE_ASSETS = [
  { platform: "amazon", slot: "amazon-main", file: "banner.png" },
  { platform: "shopify", slot: "lifestyle", file: "lifestyle.png" },
  { platform: "shopify", slot: "close_up", file: "refine_crop_B.png" },
  { platform: "shopify", slot: "detail", file: "composite_detail_1.png" },
];

function connect() {
  const host = process.env.FF_PGHOST ?? process.env.PGHOST;
  const port = Number(process.env.FF_PGPORT ?? process.env.PGPORT ?? 5432);
  const database = process.env.FF_PGDATABASE ?? process.env.PGDATABASE ?? "ff_brand_studio";
  const user = process.env.FF_PGUSER ?? process.env.PGUSER ?? "postgres";
  const password = process.env.PGPASSWORD;
  if (!host || !password) {
    console.error("ERROR: missing FF_PGHOST/PGHOST or PGPASSWORD in env");
    process.exit(1);
  }
  return postgres({ host, port, database, user, password, ssl: false, max: 1 });
}

async function main() {
  const sql = connect();
  try {
    const [seller] = await sql`
      select seller_id from products
      where tenant_id = ${QA_TENANT} and seller_id is not null limit 1`;
    if (!seller) {
      console.error(
        "ERROR: no existing QA-tenant product to borrow a seller_id from. Create one product in the QA tenant first."
      );
      process.exit(1);
    }
    await sql.begin(async (tx) => {
      await tx`
        insert into products (id, tenant_id, seller_id, sku, name_en, name_zh, category)
        values (${FIXTURE_PRODUCT_ID}, ${QA_TENANT}, ${seller.seller_id},
                '7A6479-FIXTURE01', 'QA Storefront Fixture (do not delete)',
                'QA 实时预览测试夹具', 'fishing-rod')
        on conflict (id) do nothing`;
      await tx`
        insert into product_variants (id, product_id, tenant_id, color, pattern)
        values (${FIXTURE_VARIANT_ID}, ${FIXTURE_PRODUCT_ID}, ${QA_TENANT}, null, null)
        on conflict (id) do nothing`;
      await tx`delete from platform_assets where variant_id = ${FIXTURE_VARIANT_ID}`;
      for (const a of FIXTURE_ASSETS) {
        await tx`
          insert into platform_assets
            (variant_id, tenant_id, platform, slot, r2_url, width, height,
             format, status, model_used, cost_cents, compliance_score, approved_at)
          values (${FIXTURE_VARIANT_ID}, ${QA_TENANT}, ${a.platform}, ${a.slot},
                  ${`${R2_BASE}/${a.file}`}, 2000, 2000, 'png', 'approved',
                  'qa-fixture', 0, 'EXCELLENT', now())`;
      }
    });
    const [{ n }] = await sql`
      select count(*)::int n from platform_assets
      where variant_id = ${FIXTURE_VARIANT_ID} and status = 'approved'`;
    console.log(
      `OK — fixture product ${FIXTURE_PRODUCT_ID} seeded with ${n} approved images.`
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
