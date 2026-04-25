import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ScoreShopifyComplianceInput } from "@ff/types";
import { createDbClient } from "../db/client.js";
import { scoreShopifyCompliance } from "../compliance/shopify_scorer.js";

export function registerScoreShopifyCompliance(
  server: McpServer,
  env: CloudflareBindings
): void {
  server.tool(
    "score_shopify_compliance",
    "v2 Phase 4: score one platform_assets row against the Shopify DTC rubric (lighter than Amazon).",
    ScoreShopifyComplianceInput.shape,
    async (params) => {
      const db = createDbClient(env);
      const result = await scoreShopifyCompliance(db, params.asset_id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
