import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGenerateBrandHero } from "./generate-brand-hero.js";
import { registerGenerateBilingualInfographic } from "./generate-bilingual-infographic.js";
import { registerLocalizeToZh } from "./localize-to-zh.js";
import { registerScoreBrandCompliance } from "./score-brand-compliance.js";
import { registerPublishToDAM } from "./publish-to-dam.js";
import { registerRunCampaign } from "./run-campaign.js";
import { registerLaunchProductSku } from "./launch-product-sku.js";
import { registerScoreAmazonCompliance } from "./score-amazon-compliance.js";
import { registerScoreShopifyCompliance } from "./score-shopify-compliance.js";
import { registerFlagUsAdContent } from "./flag-us-ad-content.js";
import { registerTranscreateZhToEnUs } from "./transcreate-zh-to-en-us.js";
import { registerResearchKeywords } from "./research-keywords.js";
import { registerExpandSeed } from "./expand-seed.js";
import { registerClusterKeywords } from "./cluster-keywords.js";

/**
 * Single registration array. Add new tools by importing the registrar above
 * and adding it here — keeps the "did I forget to register a new tool?"
 * question to one grep target. v1 tools first, then v2 (separated by comment).
 */
const REGISTRARS: Array<(server: McpServer, env: CloudflareBindings) => void> = [
  // v1 — single-agent ReAct social-content path
  registerGenerateBrandHero,
  registerGenerateBilingualInfographic,
  registerLocalizeToZh,
  registerScoreBrandCompliance,
  registerPublishToDAM,
  registerRunCampaign,
  // v2 — multi-model ecommerce-imagery path (Chinese sellers → American platforms)
  registerLaunchProductSku,
  registerScoreAmazonCompliance,
  registerScoreShopifyCompliance,
  registerFlagUsAdContent,
  registerTranscreateZhToEnUs,
  // v2 SEO Layer (D1+)
  registerResearchKeywords,
  registerExpandSeed,
  registerClusterKeywords,
];

export function registerAllTools(server: McpServer, env: CloudflareBindings): void {
  for (const r of REGISTRARS) r(server, env);
}
