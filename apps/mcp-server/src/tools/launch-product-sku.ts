import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LaunchProductSkuInput } from "@ff/types";
import { createDbClient } from "../db/client.js";
import { runLaunchPipeline } from "../orchestrator/launch_pipeline.js";

/**
 * v2 launch_product_sku — wires the LangGraph-style orchestrator (hand-rolled
 * for now per V2_INVENTORY note). Phase 1 was a no-op stub; Phase 3 wires in
 * planner → workers (stub) → adapters (real, spec-driven).
 *
 * dry_run defaults to true. Pass dry_run=false to actually run the fan-out.
 * Phase 2 fills in real generators; Phase 4 adds evaluator-optimizer.
 */
export function registerLaunchProductSku(
  server: McpServer,
  env: CloudflareBindings
): void {
  server.tool(
    "launch_product_sku",
    "v2 orchestrator: plan + fan-out canonical asset generation across Amazon US + Shopify DTC for one product SKU. Phase 3 has stubbed generators (Phase 2) but real adapters; Phase 4 will add compliance scorers.",
    LaunchProductSkuInput.shape,
    async (params) => {
      const db = createDbClient(env);

      try {
        const result = await runLaunchPipeline(db, {
          product_id: params.product_id,
          platforms: params.platforms,
          include_video: params.include_video,
          dry_run: params.dry_run,
          vision_pass: params.vision_pass,
          cost_cap_cents: params.cost_cap_cents,
          anthropic_api_key: env.ANTHROPIC_API_KEY,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  ...result,
                  // Trim canonicals for return — full payload is in DB.
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: msg,
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
