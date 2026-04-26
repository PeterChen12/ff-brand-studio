import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ScoreAmazonComplianceInput } from "@ff/types";
import { createDbClient } from "../db/client.js";
import { scoreAmazonCompliance } from "../compliance/amazon_scorer.js";
import { withToolErrorBoundary } from "../lib/tool_boundary.js";

export function registerScoreAmazonCompliance(
  server: McpServer,
  env: CloudflareBindings
): void {
  server.tool(
    "score_amazon_compliance",
    "v2 Phase 4: score one platform_assets row against the Amazon US main-image / A+ rubric. Set vision=true for the Opus 4.7 second pass that catches text/logos/watermarks/props (~$0.02/call).",
    ScoreAmazonComplianceInput.shape,
    withToolErrorBoundary("score_amazon_compliance", async (params) => {
      const db = createDbClient(env);
      const result = await scoreAmazonCompliance(db, params.asset_id, {
        vision: params.vision,
        anthropic_api_key: env.ANTHROPIC_API_KEY,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    })
  );
}
