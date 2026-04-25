// Phase 4 acceptance test — runs the deterministic compliance scorers
// against the platform_assets rows produced by the Phase 3 test product.
// Also exercises the US ad-content flagger with a known-bad string.
//
// Run: PGPASSWORD=... npx tsx scripts/test-phase4-scorers.ts

import postgres from "postgres";
import { createDbClient } from "../apps/mcp-server/src/db/client.js";
import { scoreAmazonCompliance } from "../apps/mcp-server/src/compliance/amazon_scorer.js";
import { scoreShopifyCompliance } from "../apps/mcp-server/src/compliance/shopify_scorer.js";
import { flagUsAdContent } from "../apps/mcp-server/src/compliance/us_ad_flagger.js";

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

async function main() {
  const product = await raw`SELECT id::text AS id FROM products WHERE sku = 'V2-TEST-DRINKWARE-001' LIMIT 1`;
  if (product.length === 0) {
    console.error("Phase 3 test product not found — run scripts/test-phase3-pipeline.ts first.");
    process.exit(1);
  }
  const productId = product[0].id;

  const assets = await raw`
    SELECT pa.id::text AS id, pa.platform, pa.slot
    FROM platform_assets pa
    JOIN product_variants pv ON pv.id = pa.variant_id
    WHERE pv.product_id = ${productId}::uuid
    ORDER BY pa.platform, pa.slot
  `;

  if (assets.length === 0) {
    console.error("No platform_assets for the test product. Run Phase 3 first.");
    process.exit(1);
  }

  console.log(`\n──────────── Phase 4 scorer test (${assets.length} assets) ────────────`);

  const env = {
    PGHOST: PG.host,
    PGPORT: String(PG.port),
    PGUSER: PG.user,
    PGPASSWORD: PG.password!,
    PGDATABASE: PG.database,
  } as unknown as CloudflareBindings;
  const db = createDbClient(env);

  const ratings: Record<string, number> = { EXCELLENT: 0, GOOD: 0, FAIR: 0, POOR: 0 };
  let scoreCount = 0;

  for (const a of assets) {
    const result =
      a.platform === "amazon"
        ? await scoreAmazonCompliance(db, a.id)
        : await scoreShopifyCompliance(db, a.id);
    ratings[result.rating] = (ratings[result.rating] ?? 0) + 1;
    scoreCount++;

    const bar = { EXCELLENT: "✓", GOOD: "•", FAIR: "~", POOR: "✗" }[result.rating] ?? "?";
    console.log(`${bar} ${a.platform.padEnd(8)} ${a.slot.padEnd(22)} ${result.rating}`);
    if (result.issues.length > 0) {
      for (const iss of result.issues) console.log(`     └─ ${iss}`);
    }
  }

  console.log("\nRating distribution:", ratings);

  // ── Ad-content flagger spot tests ──
  console.log("\n──────────── Ad-content flagger spot tests ────────────");
  const cases = [
    {
      label: "clean copy",
      text: "Insulated stainless steel tumbler. 24oz capacity. Dishwasher safe.",
      expectedClean: true,
    },
    {
      label: "amazon ToS violation (best)",
      text: "Best insulated tumbler on the market — guaranteed!",
      expectedClean: false,
    },
    {
      label: "FTC violation (as seen on)",
      text: "Premium tumbler — as seen on national TV.",
      expectedClean: false,
    },
    {
      label: "health claim",
      text: "Drink hot water to cure your cold. Lose 10 lbs in a week.",
      expectedClean: false,
    },
  ];

  let flaggerPasses = 0;
  for (const c of cases) {
    const flags = flagUsAdContent(c.text);
    const isClean = flags.length === 0;
    const expectedMatch = isClean === c.expectedClean;
    flaggerPasses += expectedMatch ? 1 : 0;
    const marker = expectedMatch ? "✓" : "✗";
    console.log(
      `${marker} ${c.label.padEnd(36)} flags=${flags.length} expected_clean=${c.expectedClean}`
    );
    if (flags.length > 0) {
      console.log(`     └─ ${flags.map((f) => `${f.category}:${f.matched}`).join("; ")}`);
    }
  }

  // ── Verdict ──
  const scorerOk = scoreCount === assets.length;
  const flaggerOk = flaggerPasses === cases.length;
  console.log(
    `\nVerdict: scorers ran ${scoreCount}/${assets.length} | flagger spot tests ${flaggerPasses}/${cases.length}`
  );
  if (!scorerOk || !flaggerOk) process.exitCode = 1;

  await raw.end();
}

main().catch((e) => {
  console.error(e);
  raw.end();
  process.exit(1);
});
