import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ScoreBrandComplianceInput } from "@ff/types";
import type { BrandScorecardType } from "@ff/types";
import { scoreBrandCompliance } from "../guardian/index.js";

export function stubScorecard(): BrandScorecardType {
  return {
    overall_score: 75,
    pass: true,
    dimensions: {
      color_compliance: { score: 75, notes: "Stub scorecard — guardian bypassed." },
      typography_compliance: { score: 75, notes: "Stub scorecard — guardian bypassed." },
      logo_placement: { score: 75, notes: "Stub scorecard — guardian bypassed." },
      image_quality: { score: 75, notes: "Stub scorecard — guardian bypassed." },
      copy_tone: { score: 75, notes: "Stub scorecard — guardian bypassed." },
    },
    violations: [],
    suggestions: [],
  };
}

export function registerScoreBrandCompliance(
  server: McpServer,
  env: CloudflareBindings
): void {
  server.tool(
    "score_brand_compliance",
    "Score a marketing asset against FF brand guidelines using the Brand Guardian vision model",
    ScoreBrandComplianceInput.shape,
    async (params) => {
      const scorecard = await scoreBrandCompliance({
        assetUrl: params.asset_url,
        assetType: params.asset_type,
        copyEn: params.copy_en,
        copyZh: params.copy_zh,
        apiKey: env.ANTHROPIC_API_KEY,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(scorecard),
          },
        ],
      };
    }
  );
}
