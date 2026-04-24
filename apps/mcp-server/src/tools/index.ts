import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGenerateBrandHero } from "./generate-brand-hero.js";
import { registerGenerateBilingualInfographic } from "./generate-bilingual-infographic.js";
import { registerLocalizeToZh } from "./localize-to-zh.js";
import { registerScoreBrandCompliance } from "./score-brand-compliance.js";
import { registerPublishToDAM } from "./publish-to-dam.js";
import { registerRunCampaign } from "./run-campaign.js";

export function registerAllTools(server: McpServer, env: CloudflareBindings): void {
  registerGenerateBrandHero(server, env);
  registerGenerateBilingualInfographic(server, env);
  registerLocalizeToZh(server, env);
  registerScoreBrandCompliance(server, env);
  registerPublishToDAM(server, env);
  registerRunCampaign(server, env);
}
