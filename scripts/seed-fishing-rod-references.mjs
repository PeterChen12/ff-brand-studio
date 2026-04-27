// Seed real fishing-rod studio images into platform_assets so the
// dashboard library has something meaningful to render for the 3 D8 demo
// SKUs. Sources from the buyfishingrod product catalog at
// `C:\Users\zihao\buyfishingrod\public\images\products\<folder>\` —
// these are the agency's polished post-processed reference photos.
//
// Workflow:
//   1. Drop the orphaned V2-INT-DRINKWARE / V2-TEST-DRINKWARE-001
//      platform_assets that were leftover from earlier integration tests.
//   2. For each FF-DEMO-* SKU: ensure a product_variant row exists.
//   3. Upload N images per SKU to R2 (amazon main/lifestyle + shopify
//      main/lifestyle/detail) using `wrangler r2 object put`.
//   4. Insert platform_assets rows pointing at the public R2 URLs.
//
// Run:
//   $env:PGPASSWORD='...'; node scripts/seed-fishing-rod-references.mjs
import postgres from "postgres";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PG = {
  host: process.env.PGHOST || "170.9.252.93",
  port: parseInt(process.env.PGPORT || "5433"),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "ff_brand_studio",
  ssl: false,
};
if (!PG.password) {
  console.error("PGPASSWORD env var required.");
  process.exit(1);
}

const R2_BUCKET = "ff-brand-studio-assets";
const R2_PUBLIC = "https://pub-db3f39e3386347d58359ba96517eec84.r2.dev";
const BFR_ROOT = String.raw`C:\Users\zihao\buyfishingrod\public\images\products`;

// Map demo SKUs to a buyfishingrod product folder. The bite alarm has no
// 1:1 counterpart in the catalog, so we use the closest accessory (lure
// pliers) for the visual demo.
const SKU_MAP = [
  {
    sku: "FF-DEMO-ROD-12FT",
    sourceFolder: "prod_castmaster_apex",
    slots: [
      { platform: "amazon", slot: "main", file: "studio_1.png" },
      { platform: "amazon", slot: "lifestyle", file: "lifestyle_1.png" },
      { platform: "shopify", slot: "main", file: "studio_1.png" },
      { platform: "shopify", slot: "lifestyle", file: "lifestyle_1.png" },
      { platform: "shopify", slot: "detail", file: "detail_1.png" },
    ],
  },
  {
    sku: "FF-DEMO-REEL-4000",
    sourceFolder: "prod_ceron_ls3000",
    slots: [
      { platform: "amazon", slot: "main", file: "studio_1.png" },
      { platform: "amazon", slot: "lifestyle", file: "lifestyle_1.png" },
      { platform: "shopify", slot: "main", file: "studio_1.png" },
      { platform: "shopify", slot: "lifestyle", file: "lifestyle_1.png" },
      { platform: "shopify", slot: "detail", file: "close_1.png" },
    ],
  },
  {
    sku: "FF-DEMO-BITE-LED4",
    sourceFolder: "prod_lure_pliers",
    slots: [
      { platform: "amazon", slot: "main", file: "studio_1.png" },
      { platform: "amazon", slot: "lifestyle", file: "lifestyle_1.png" },
      { platform: "shopify", slot: "main", file: "studio_1.png" },
      { platform: "shopify", slot: "lifestyle", file: "lifestyle_1.png" },
      { platform: "shopify", slot: "detail", file: "detail_1.png" },
    ],
  },
];

// Resolve the wrangler entry script. We invoke node directly with the JS
// file rather than going through pnpm/npx/.cmd shims — works identically
// on Windows + Unix and avoids spawnSync's "can't run shell scripts"
// limitation on Windows.
const WRANGLER_JS =
  "apps/mcp-server/node_modules/wrangler/bin/wrangler.js";

// Upload `localPath` to R2 at `<bucket>/<key>` via node + wrangler. Args
// are passed as an array — no shell, no injection.
function r2Put(localPath, key) {
  const result = spawnSync(
    process.execPath, // current node binary
    [
      WRANGLER_JS,
      "r2",
      "object",
      "put",
      `${R2_BUCKET}/${key}`,
      `--file=${localPath}`,
      "--content-type=image/png",
    ],
    {
      env: {
        ...process.env,
        CLOUDFLARE_EMAIL:
          process.env.CLOUDFLARE_EMAIL || "peter@creatorain.com",
        CLOUDFLARE_API_KEY:
          process.env.CLOUDFLARE_API_KEY ||
          "b063a69bedf659ffc1b0aab67033774aff22f",
        CLOUDFLARE_ACCOUNT_ID:
          process.env.CLOUDFLARE_ACCOUNT_ID ||
          "40595082727ca8581658c1f562d5f1ff",
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `wrangler r2 object put failed (${result.status}): ${result.stderr || result.stdout || "unknown error"}`
    );
  }
}

async function main() {
  const sql = postgres(PG);
  try {
    // ── 1. Clean up orphaned test-drinkware platform_assets ─────────────
    const dropResult = await sql`
      DELETE FROM platform_assets
      WHERE variant_id IN (
        SELECT pv.id FROM product_variants pv
        JOIN products p ON pv.product_id = p.id
        WHERE p.sku IN ('V2-INT-DRINKWARE', 'V2-TEST-DRINKWARE-001')
      )
      RETURNING id
    `;
    console.log(
      `✓ dropped ${dropResult.length} stale drinkware platform_assets`
    );

    // ── 2-4. Per SKU ──────────────────────────────────────────────────
    let totalUploaded = 0;
    let totalInserted = 0;
    for (const cfg of SKU_MAP) {
      console.log(`\n─── ${cfg.sku} ←  ${cfg.sourceFolder} ───`);

      const product = await sql`
        SELECT id, sku, name_en FROM products WHERE sku = ${cfg.sku} LIMIT 1
      `;
      if (product.length === 0) {
        console.warn(
          `  ⚠ SKU ${cfg.sku} not found in products — run scripts/seed-demo-skus.mjs first`
        );
        continue;
      }
      const productId = product[0].id;

      // Phase G — every row carries tenant_id; demo SKUs go to the
      // sample-catalog tenant so any signed-in tenant with
      // features.has_sample_access sees them.
      const SAMPLE_TENANT_ID = "00000000-0000-0000-0000-000000000001";

      let variant = await sql`
        SELECT id FROM product_variants WHERE product_id = ${productId} LIMIT 1
      `;
      let variantId;
      if (variant.length === 0) {
        const ins = await sql`
          INSERT INTO product_variants (tenant_id, product_id, color, pattern)
          VALUES (${SAMPLE_TENANT_ID}, ${productId}, NULL, NULL)
          RETURNING id
        `;
        variantId = ins[0].id;
        console.log(`  + created variant ${variantId}`);
      } else {
        variantId = variant[0].id;
      }

      // Drop existing platform_assets for this variant so re-runs are clean
      const dropCount = await sql`
        DELETE FROM platform_assets
        WHERE variant_id = ${variantId}
        RETURNING id
      `;
      if (dropCount.length > 0) {
        console.log(`  ↻ dropped ${dropCount.length} stale platform_assets`);
      }

      for (const slot of cfg.slots) {
        const localPath = join(BFR_ROOT, cfg.sourceFolder, slot.file);
        if (!existsSync(localPath)) {
          console.warn(`  ⚠ missing source ${localPath} — skipping`);
          continue;
        }
        const sluggedSku = cfg.sku.toLowerCase();
        const key = `references/${sluggedSku}/${slot.platform}-${slot.slot}.png`;
        const r2Url = `${R2_PUBLIC}/${key}`;

        try {
          r2Put(localPath, key);
        } catch (err) {
          console.error(
            `  ✗ R2 upload failed for ${key}:`,
            err.message ?? err
          );
          continue;
        }
        totalUploaded++;

        await sql`
          INSERT INTO platform_assets (
            tenant_id, variant_id, platform, slot, r2_url, format, status,
            model_used, cost_cents, compliance_score
          ) VALUES (
            ${SAMPLE_TENANT_ID}, ${variantId}, ${slot.platform}, ${slot.slot}, ${r2Url},
            'png', 'reference', 'buyfishingrod-catalog', 0, 'GOOD'
          )
          ON CONFLICT (variant_id, platform, slot) DO UPDATE SET
            r2_url = EXCLUDED.r2_url,
            format = EXCLUDED.format,
            status = EXCLUDED.status,
            model_used = EXCLUDED.model_used,
            compliance_score = EXCLUDED.compliance_score
        `;
        totalInserted++;
        console.log(`  · ${slot.platform}/${slot.slot} → ${key}`);
      }
    }

    console.log(
      `\n✓ uploaded ${totalUploaded} files, inserted/updated ${totalInserted} platform_assets`
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
