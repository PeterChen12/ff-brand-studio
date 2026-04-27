// SEO Layer · D8 — pre-seed 3 fishing-rod-themed demo SKUs.
//
// Idempotent: ON CONFLICT DO UPDATE so re-running picks up edits without
// dup'ing rows. Adds:
//   1× seller_profiles row "Demo · 钓具工坊"
//   3× products rows ('FF-DEMO-ROD-12FT', 'FF-DEMO-REEL-4000', 'FF-DEMO-BITE-LED4')
//
// These power the dashboard SEO Atelier as a "live demo fallback" — the
// /demo/seo-preview endpoint already works without DB rows, but the full
// launch_product_sku flow (D6 orchestrator) requires a real product UUID.
//
// Run:
//   $env:PGPASSWORD='...'; node scripts/seed-demo-skus.mjs
import postgres from "postgres";

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

const SELLER = {
  org_name_en: "Demo · Tackle Atelier",
  org_name_zh: "钓具工坊",
  contact_email: "demo@ff-brand-studio.local",
  brand_voice: {
    tone: "confident, specific, sport-led",
    banned_words: ["best", "guaranteed", "#1"],
    must_use_phrases: [],
  },
  amazon_seller_id: null, // null → orchestrator skips video generation (planner.ts)
};

const PRODUCTS = [
  {
    sku: "FF-DEMO-ROD-12FT",
    name_en: "Carbon fiber telescopic fishing rod 12ft",
    name_zh: "碳纤维伸缩钓竿 12 英尺",
    category: "other",
    dimensions: { length_cm: 366, packed_cm: 78, weight_g: 285 },
    materials: ["carbon-fiber", "aluminum-reel-seat", "EVA-grip"],
    colors_hex: ["#1a1a1a", "#c9a84c"],
  },
  {
    sku: "FF-DEMO-REEL-4000",
    name_en: "Saltwater spinning reel 4000 series",
    name_zh: "海钓纺车轮 4000 型",
    category: "tech-acc",
    dimensions: {
      gear_ratio: 5.2,
      bearings: 7,
      max_drag_kg: 8,
      weight_g: 245,
    },
    materials: ["aluminum-body", "stainless-bearings"],
    colors_hex: ["#0a0a0a", "#1c3faa"],
  },
  {
    sku: "FF-DEMO-BITE-LED4",
    name_en: "LED bite alarm 4-pack",
    name_zh: "LED 咬钩报警器 4 件套",
    category: "tech-acc",
    dimensions: {
      sensitivity_levels: 9,
      battery: "AA",
      ip_rating: "IPX4",
      pack_count: 4,
    },
    materials: ["ABS-housing", "rubber-clip"],
    colors_hex: ["#0a0a0a", "#00a8e8"],
  },
];

async function main() {
  const sql = postgres(PG);
  try {
    // Idempotent seller upsert keyed by org_name_en.
    const existing = await sql`
      SELECT id FROM seller_profiles WHERE org_name_en = ${SELLER.org_name_en} LIMIT 1
    `;
    let sellerId;
    if (existing.length > 0) {
      sellerId = existing[0].id;
      await sql`
        UPDATE seller_profiles
        SET org_name_zh = ${SELLER.org_name_zh},
            contact_email = ${SELLER.contact_email},
            brand_voice = ${sql.json(SELLER.brand_voice)},
            amazon_seller_id = ${SELLER.amazon_seller_id}
        WHERE id = ${sellerId}
      `;
      console.log(`✓ updated seller ${sellerId}`);
    } else {
      const ins = await sql`
        INSERT INTO seller_profiles (org_name_en, org_name_zh, contact_email, brand_voice, amazon_seller_id)
        VALUES (${SELLER.org_name_en}, ${SELLER.org_name_zh}, ${SELLER.contact_email}, ${sql.json(SELLER.brand_voice)}, ${SELLER.amazon_seller_id})
        RETURNING id
      `;
      sellerId = ins[0].id;
      console.log(`✓ inserted seller ${sellerId}`);
    }

    // Products: idempotent on the unique sku column.
    for (const p of PRODUCTS) {
      const upserted = await sql`
        INSERT INTO products (
          seller_id, sku, name_en, name_zh, category,
          dimensions, materials, colors_hex
        ) VALUES (
          ${sellerId}, ${p.sku}, ${p.name_en}, ${p.name_zh}, ${p.category},
          ${sql.json(p.dimensions)}, ${p.materials}, ${p.colors_hex}
        )
        ON CONFLICT (sku) DO UPDATE SET
          name_en = EXCLUDED.name_en,
          name_zh = EXCLUDED.name_zh,
          category = EXCLUDED.category,
          dimensions = EXCLUDED.dimensions,
          materials = EXCLUDED.materials,
          colors_hex = EXCLUDED.colors_hex
        RETURNING id
      `;
      console.log(`  · ${p.sku} → ${upserted[0].id}`);
    }

    const count = await sql`SELECT COUNT(*)::int AS n FROM products WHERE seller_id = ${sellerId}`;
    console.log(`\nDemo seller now owns ${count[0].n} products. Use product_id to call launch_product_sku.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
