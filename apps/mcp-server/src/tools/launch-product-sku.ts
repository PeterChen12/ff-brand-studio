import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LaunchProductSkuInput } from "@ff/types";
import { createDbClient } from "../db/client.js";
import { runLaunchPipeline } from "../orchestrator/launch_pipeline.js";
import { withToolErrorBoundary } from "../lib/tool_boundary.js";

/**
 * v2 launch_product_sku — wires the hand-rolled orchestrator. Phase 1 was
 * a no-op stub; Phase 3 wires in planner → workers (stub) → adapters →
 * evaluator-optimizer. dry_run defaults to true. Phase 2 fills in real
 * generators.
 *
 * Errors caught by the shared withToolErrorBoundary; structured isError
 * response replaces the previous in-handler try/catch.
 */
export function registerLaunchProductSku(
  server: McpServer,
  env: CloudflareBindings
): void {
  server.tool(
    "launch_product_sku",
    "v2 orchestrator: plan + fan-out canonical asset generation across Amazon US + Shopify DTC for one product SKU. Phase 3 has stubbed generators (Phase 2) but real adapters + evaluator-optimizer.",
    LaunchProductSkuInput.shape,
    withToolErrorBoundary("launch_product_sku", async (params) => {
      const db = createDbClient(env);
      const result = await runLaunchPipeline(db, {
        product_id: params.product_id,
        platforms: params.platforms,
        include_video: params.include_video,
        dry_run: params.dry_run,
        vision_pass: params.vision_pass,
        cost_cap_cents: params.cost_cap_cents,
        anthropic_api_key: env.ANTHROPIC_API_KEY,
        include_seo: params.include_seo,
        seo_cost_cap_cents: params.seo_cost_cap_cents,
        openai_api_key: env.OPENAI_API_KEY,
        dataforseo_login: env.DATAFORSEO_LOGIN,
        dataforseo_password: env.DATAFORSEO_PASSWORD,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                ...result,
                canonicals_summary: result.canonicals.map((c) => ({
                  kind: c.kind,
                  model_used: c.model_used,
                  cost_cents: c.cost_cents,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    })
  );
}
