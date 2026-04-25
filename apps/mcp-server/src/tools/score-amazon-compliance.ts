import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ScoreAmazonComplianceInput } from "@ff/types";
import { createDbClient } from "../db/client.js";
import { scoreAmazonCompliance } from "../compliance/amazon_scorer.js";

export function registerScoreAmazonCompliance(
  server: McpServer,
  env: CloudflareBindings
): void {
  server.tool(
    "score_amazon_compliance",
    "v2 Phase 4: score one platform_assets row against the Amazon US main-image / A+ rubric. Returns rating + issues + suggestions.",
    ScoreAmazonComplianceInput.shape,
    async (params) => {
      const db = createDbClient(env);
      const result = await scoreAmazonCompliance(db, params.asset_id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
