/**
 * Seed both DMK reels into ff-brand-studio:
 *   - DMK QINGSHUANG GLORY 800 (spinning reel)
 *   - DMK YINLING SMART PLUS ETA602XG (intelligent baitcasting reel)
 *
 * Mirrors the LYKAN seed: upload primary refs to R2, insert seller_profile
 * if missing, insert product, insert product_references. Idempotent on SKU.
 *
 * Run from apps/image-sidecar/:
 *   set -a && source ../../.env && set +a
 *   node scripts/seed-dmk-products.mjs
 */
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const TENANT_ID = "aadb7711-dabe-4fc5-8628-82e6c3b8bc49";
const SOURCE_ROOT = "C:/Users/zihao/OneDrive/桌面/creatorain/fishing";

const PRODUCTS = [
  {
    sku: "DMK-QINGSHUANG-GLORY-800",
    folder: `${SOURCE_ROOT}/26.5.6 DMK青霜荣耀版`,
    primaryFile: "主1.png",
    masterFile: "主2.png",
    keyPrefix: "references/dmk-qingshuang-glory-800",
    nameEn: "DMK QINGSHUANG GLORY 800 Ultralight Spinning Reel",
    nameZh: "DMK 青霜荣耀 800 轻量化纺车轮",
    description:
      "Ultralight spinning reel: 6.2:1 gear ratio, 11+1 stainless bearings, 4kg max drag, 146g, 63cm retrieve. Carbon fiber rotor and double handle, full-metal slanted-lip spool. TPE knob, anti-impact balance shaft, left/right interchangeable. Tuned for trout, panfish, small bass and light inshore finesse fishing.",
    category: "other",
    kind: "compact_square",
    dimensions: {
      model: "Glory 800",
      gear_ratio: "6.2:1",
      bearings: "11+1",
      max_drag_kg: 4,
      weight_g: 146,
      line_retrieve_cm: 63,
      handle_length_mm: 81,
      line_capacity_pe: { "0.6": 90, "0.8": 70 },
    },
    materials: [
      "carbon-fiber-rotor",
      "carbon-fiber-handle",
      "aluminum-alloy-body",
      "stainless-steel-bearings",
      "TPE-knob",
    ],
    colorsHex: ["#0a0a0a", "#1c1c1c"],
  },
  {
    sku: "DMK-YINLING-SMART-PLUS-ETA602XG",
    folder: `${SOURCE_ROOT}/26.5.6 DMK银翎智享版PLUS`,
    primaryFile: "主1.png",
    masterFile: "主2.png",
    keyPrefix: "references/dmk-yinling-smart-plus-eta602xg",
    nameEn: "DMK YINLING SMART PLUS Intelligent Baitcasting Reel ETA602XG",
    nameZh: "DMK 银翎智享版 PLUS 智能水滴轮 ETA602XG",
    description:
      "Intelligent baitcasting reel powered by the MIIEC chip: Spot Casting 0–50m via Bluetooth + WeChat mini-program, dynamic self-learning, self-generating power so no batteries. 8.5:1 high-speed gear, 11+1 precision bearings, 5kg drag, 74cm retrieve. AL7075-T6 spindle, super-hard coated 7075-T6 main gear, hard-copper pinion, 0.3mm ultra-low-inertia spool, carbon-fiber side plate and handle.",
    category: "tech-acc",
    kind: "compact_square",
    dimensions: {
      model: "ETA602XG",
      gear_ratio: "8.5:1",
      bearings: "11+1",
      max_drag_kg: 5,
      line_retrieve_cm: 74,
      smart_features: [
        "spot-casting-0-50m",
        "bluetooth",
        "wechat-mini-program",
        "self-generating-power",
        "dynamic-self-learning",
      ],
      spool_thickness_mm: 0.3,
    },
    materials: [
      "AL7075-T6-aerospace-aluminum",
      "carbon-fiber-side-plate",
      "carbon-fiber-handle",
      "hard-copper-pinion",
      "TPE-soft-grip-knob",
    ],
    colorsHex: ["#1c2e5c", "#5b3a7c"],
  },
];

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET ?? "ff-brand-studio-assets";
const PUBLIC_BASE = (process.env.R2_PUBLIC_URL ?? "").replace(/\/$/, "");

async function uploadOne(localPath, r2Key, contentType) {
  const bytes = await readFile(localPath);
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: r2Key, Body: bytes, ContentType: contentType })
  );
  const url = `${PUBLIC_BASE}/${r2Key}`;
  console.log(`  → uploaded ${r2Key} (${bytes.length} bytes)`);
  return url;
}

const sql = postgres({
  host: process.env.FF_PGHOST,
  port: Number(process.env.FF_PGPORT),
  database: process.env.FF_PGDATABASE,
  username: process.env.FF_PGUSER,
  password: process.env.FF_PGPASSWORD,
  ssl: false,
});

// Reuse existing seller for this tenant.
const [seller] = await sql`SELECT id FROM seller_profiles WHERE tenant_id = ${TENANT_ID} LIMIT 1`;
if (!seller) throw new Error(`no seller for tenant ${TENANT_ID}; run lykan seed first`);
console.log(`seller_id: ${seller.id}`);

for (const p of PRODUCTS) {
  console.log(`\n=== ${p.sku} ===`);
  // Upload references
  const primaryUrl = await uploadOne(`${p.folder}/${p.primaryFile}`, `${p.keyPrefix}/primary.png`, "image/png");
  const masterUrl = await uploadOne(`${p.folder}/${p.masterFile}`, `${p.keyPrefix}/master.png`, "image/png");

  // Insert or fetch product
  let productId;
  const existing = await sql`SELECT id FROM products WHERE sku = ${p.sku} LIMIT 1`;
  if (existing.length > 0) {
    productId = existing[0].id;
    console.log(`  product exists at ${productId} — reusing`);
  } else {
    const inserted = await sql`
      INSERT INTO products (tenant_id, seller_id, sku, name_en, name_zh, description,
                            category, kind, dimensions, materials, colors_hex)
      VALUES (
        ${TENANT_ID}, ${seller.id}, ${p.sku}, ${p.nameEn}, ${p.nameZh}, ${p.description},
        ${p.category}, ${p.kind}, ${sql.json(p.dimensions)},
        ${p.materials}::text[], ${p.colorsHex}::text[]
      )
      RETURNING id
    `;
    productId = inserted[0].id;
    console.log(`  created product ${productId}`);
  }

  // References (idempotent: skip if any already)
  const refs = await sql`SELECT 1 FROM product_references WHERE product_id = ${productId}`;
  if (refs.length > 0) {
    console.log(`  references already exist (${refs.length}) — skipping`);
  } else {
    await sql`
      INSERT INTO product_references (tenant_id, product_id, r2_url, kind, uploaded_by, approved_at)
      VALUES
        (${TENANT_ID}, ${productId}, ${primaryUrl}, 'studio_white_bg', 'spike-seed', NOW()),
        (${TENANT_ID}, ${productId}, ${masterUrl}, 'studio_master', 'spike-seed', NOW())
    `;
    console.log(`  inserted 2 references`);
  }

  console.log(`  product_id: ${productId}`);
  console.log(`  ready to launch:`);
  console.log(`    -d '{"product_id":"${productId}","platforms":["amazon","shopify"],"include_seo":true,"quality_preset":"balanced","cost_cap_cents":1500}'`);
}

await sql.end();
console.log("\n=== DONE ===");
