import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ScoreSeoComplianceInput,
  type ScoreSeoComplianceInputType,
} from "@ff/types";
import { scoreSeoCompliance } from "@ff/brand-rules";
import { withToolErrorBoundary } from "../lib/tool_boundary.js";

/**
 * v2 SEO Layer · D5 — score_seo_compliance
 *
 * Deterministic scorer for SEO copy. Designed to feed the orchestrator's
 * evaluator-optimizer loop: if rating < EXCELLENT and iter < 3, regenerate
 * with the issues[] passed back to the LLM as feedback.
 *
 * Free / no API calls. The hard-limit checks duplicate what
 * generate_seo_description already performs, but we re-run them here so
 * the scorer is callable independently (e.g., on a hand-edited HITL
 * version of the copy).
 */
export function registerScoreSeoCompliance(server: McpServer, _env: CloudflareBindings): void {
  server.tool(
    "score_seo_compliance",
    "v2 SEO: score generated copy (any surface) against deterministic platform rubric. Returns rating + issues + suggestions. Use as the evaluator step in the SEO regeneration loop.",
    ScoreSeoComplianceInput.shape,
    withToolErrorBoundary("score_seo_compliance", async (params: ScoreSeoComplianceInputType) => {
      const result = scoreSeoCompliance({
        surface: params.surface,
        language: params.language,
        copy: params.copy,
        violations: params.violations,
        flags: params.flags,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                surface: params.surface,
                language: params.language,
                ...result,
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
