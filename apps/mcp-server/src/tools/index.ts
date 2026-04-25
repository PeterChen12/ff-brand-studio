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

export function registerAllTools(server: McpServer, env: CloudflareBindings): void {
  // v1
  registerGenerateBrandHero(server, env);
  registerGenerateBilingualInfographic(server, env);
  registerLocalizeToZh(server, env);
  registerScoreBrandCompliance(server, env);
  registerPublishToDAM(server, env);
  registerRunCampaign(server, env);
  // v2
  registerLaunchProductSku(server, env);
  registerScoreAmazonCompliance(server, env);
  registerScoreShopifyCompliance(server, env);
  registerFlagUsAdContent(server, env);
  registerTranscreateZhToEnUs(server, env);
}
