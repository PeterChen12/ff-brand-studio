/**
 * One-shot seed for the LYKAN CHOP CULTER S702ML-RF spike test:
 *  1. Upload S70.png + 主1.jpg to R2 under `references/lykan-cc-s702mlrf/`
 *  2. Create a seller_profile for `My Organization` (if missing)
 *  3. Insert the product row
 *  4. Insert product_references rows pointing at the uploaded URLs
 *  5. Top up wallet to 2000¢ ($20) so a real launch fits with margin
 *  6. Flip `production_pipeline` feature flag for this tenant
 *
 * Run from `apps/image-sidecar/` (where @aws-sdk/client-s3 is installed):
 *   set -a && source ../../.env && set +a
 *   node scripts/seed-lykan-product.mjs
 */
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const TENANT_ID = "aadb7711-dabe-4fc5-8628-82e6c3b8bc49"; // My Organization
const SKU = "LYKAN-CC-S702MLRF";
const SOURCE_DIR = "C:/Users/zihao/OneDrive/桌面/creatorain/fishing/奈肯LYKAN/26.4.20 CHOP CULTER-斩翘（远投翘嘴竿）系列";

const ENDPOINT = process.env.R2_S3_ENDPOINT;
const BUCKET = process.env.R2_BUCKET ?? "ff-brand-studio-assets";
const PUBLIC_BASE = (process.env.R2_PUBLIC_URL ?? "").replace(/\/$/, "");

if (!ENDPOINT || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
  throw new Error("R2_* env vars missing — source ../../.env first");
}
if (!PUBLIC_BASE) {
  throw new Error("R2_PUBLIC_URL missing — source ../../.env first");
}

const s3 = new S3Client({
  region: "auto",
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function uploadOne(localPath, r2Key, contentType) {
  const bytes = await readFile(localPath);
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: r2Key,
      Body: bytes,
      ContentType: contentType,
    })
  );
  const url = `${PUBLIC_BASE}/${r2Key}`;
  console.log(`  → uploaded ${r2Key} (${bytes.length} bytes) → ${url}`);
  return url;
}

console.log("=== 1. Upload references to R2 ===");
const s70Url = await uploadOne(
  `${SOURCE_DIR}/S70.png`,
  "references/lykan-cc-s702mlrf/S70.png",
  "image/png"
);
const masterUrl = await uploadOne(
  `${SOURCE_DIR}/主1.jpg`,
  "references/lykan-cc-s702mlrf/master.jpg",
  "image/jpeg"
);

const sql = postgres({
  host: process.env.FF_PGHOST,
  port: Number(process.env.FF_PGPORT),
  database: process.env.FF_PGDATABASE,
  username: process.env.FF_PGUSER,
  password: process.env.FF_PGPASSWORD,
  ssl: false,
});

console.log("\n=== 2. Create / reuse seller_profile ===");
let sellerId;
const existingSeller = await sql`
  SELECT id FROM seller_profiles WHERE tenant_id = ${TENANT_ID} LIMIT 1
`;
if (existingSeller.length > 0) {
  sellerId = existingSeller[0].id;
  console.log(`  → reusing seller_profile ${sellerId}`);
} else {
  const inserted = await sql`
    INSERT INTO seller_profiles (tenant_id, org_name_en, org_name_zh)
    VALUES (${TENANT_ID}, 'My Organization', '我的组织')
    RETURNING id
  `;
  sellerId = inserted[0].id;
  console.log(`  → created seller_profile ${sellerId}`);
}

console.log("\n=== 3. Insert product (or reuse if SKU already exists) ===");
let productId;
const existingProduct = await sql`SELECT id FROM products WHERE sku = ${SKU} LIMIT 1`;
if (existingProduct.length > 0) {
  productId = existingProduct[0].id;
  console.log(`  → product ${SKU} already exists at ${productId} — reusing`);
} else {
  const inserted = await sql`
    INSERT INTO products (
      tenant_id, seller_id, sku, name_en, name_zh, description,
      category, kind, dimensions, materials, colors_hex
    )
    VALUES (
      ${TENANT_ID},
      ${sellerId},
      ${SKU},
      ${"LYKAN CHOP CULTER S702ML-RF Long-Distance Casting Fishing Rod"},
      ${"LYKAN 奈肯 斩翘 S702ML-RF 远投翘嘴竿"},
      ${"7'02\" Medium-Light, regular-fast action 2-piece spinning rod from the LYKAN CHOP CULTER series. Tuned for topmouth-culter and freshwater bass at distance. High-modulus carbon fiber blank, Fuji K-Series SiC guides, EVA split-grip handle, Fuji DPS reel seat."},
      ${"other"},
      ${"long_thin_vertical"},
      ${sql.json({
        length_in: 86,
        length_cm: 218,
        power: "Medium-Light",
        action: "Regular-Fast",
        pieces: 2,
        line_weight_lb: "6-12",
        lure_weight_oz: "1/8-3/8",
        weight_g: 110,
      })},
      ${["high-modulus-carbon-fiber", "Fuji-K-SiC-guides", "EVA-split-grip", "Fuji-DPS-reel-seat"]}::text[],
      ${["#1a1a1a", "#c9a84c"]}::text[]
    )
    RETURNING id
  `;
  productId = inserted[0].id;
  console.log(`  → created product ${productId}`);
}

console.log("\n=== 4. Insert product_references ===");
const existingRefs = await sql`SELECT id, r2_url FROM product_references WHERE product_id = ${productId}`;
if (existingRefs.length > 0) {
  console.log(`  → ${existingRefs.length} reference(s) already exist — skipping insert`);
  for (const r of existingRefs) console.log(`    - ${r.r2_url}`);
} else {
  await sql`
    INSERT INTO product_references (tenant_id, product_id, r2_url, kind, uploaded_by, approved_at)
    VALUES
      (${TENANT_ID}, ${productId}, ${s70Url}, 'studio_white_bg', 'spike-seed', NOW()),
      (${TENANT_ID}, ${productId}, ${masterUrl}, 'studio_master', 'spike-seed', NOW())
  `;
  console.log(`  → inserted 2 references`);
}

console.log("\n=== 5. Top up wallet to 2000¢ ===");
const beforeBal = await sql`SELECT wallet_balance_cents FROM tenants WHERE id = ${TENANT_ID}`;
console.log(`  before: ${beforeBal[0].wallet_balance_cents}¢`);
await sql`UPDATE tenants SET wallet_balance_cents = 2000 WHERE id = ${TENANT_ID}`;
const afterBal = await sql`SELECT wallet_balance_cents FROM tenants WHERE id = ${TENANT_ID}`;
console.log(`  after:  ${afterBal[0].wallet_balance_cents}¢`);

console.log("\n=== 6. Flip production_pipeline feature flag ===");
const beforeFeat = await sql`SELECT features FROM tenants WHERE id = ${TENANT_ID}`;
console.log(`  before: ${JSON.stringify(beforeFeat[0].features)}`);
await sql`
  UPDATE tenants
  SET features = features || '{"production_pipeline": true}'::jsonb
  WHERE id = ${TENANT_ID}
`;
const afterFeat = await sql`SELECT features FROM tenants WHERE id = ${TENANT_ID}`;
console.log(`  after:  ${JSON.stringify(afterFeat[0].features)}`);

await sql.end();

console.log("\n=== READY ===");
console.log(`product_id: ${productId}`);
console.log(`SKU:        ${SKU}`);
console.log(`Launch payload (waiting for sidecar):`);
console.log(`  POST https://ff-brand-studio-mcp.creatorain.workers.dev/v1/launches`);
console.log(`  Authorization: Bearer ff_live_CSIKLU3DV6QDXNI6X2NG24CYCKJNQJXSU4DSQPSKXTO5XSS5JZ5Q`);
console.log(`  body: {"product_id":"${productId}","platforms":["amazon","shopify"],"include_seo":true,"quality_preset":"balanced","cost_cap_cents":1500}`);
