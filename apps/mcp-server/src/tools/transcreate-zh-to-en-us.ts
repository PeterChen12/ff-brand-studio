import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TranscreateZhToEnUsInput } from "@ff/types";
import { flagUsAdContent } from "../compliance/us_ad_flagger.js";

/**
 * v2 Phase 4 — reverse transcreation: Chinese seller copy → American-English
 * ecommerce copy. Replaces v1's `localize_to_zh` (which goes the other way)
 * for the v2 Chinese-sellers-on-American-platforms flow.
 *
 * Phase 4 minimum: stub LLM call signature and return the source verbatim
 * (passthrough) so downstream tools can wire against it. Phase 4 follow-up
 * fills in the Anthropic Sonnet 4.6 call with the system prompt below.
 *
 * The flagger ALWAYS runs over the output, regardless of LLM stub or real,
 * because that's the v2 compliance moat.
 */
export const TRANSCREATION_SYSTEM_PROMPT = `You translate Chinese ecommerce copy to American-audience English.

Rules:
- Preserve product specs verbatim (dimensions, weights, materials, model numbers).
- Apply American conventions: imperial units alongside metric where helpful, sentence case for titles, no machine-translation hallmarks ("the said product", "very nice quality").
- Strip China-specific cultural references (双11, 618 unless seller explicitly retains them).
- Do NOT use: "best", "#1", "guaranteed", "eco-friendly" without certification, "money-back guarantee" without backing policy, named competitor comparisons.
- For amazon_title: 80–200 chars, brand + product + key feature.
- For amazon_bullet: imperative voice, lead with benefit, ≤180 chars.
- For image_overlay: ≤8 words, marketing voice, no banned phrases.

Output JSON: { en_text: string, notes: string[] }`;

export function registerTranscreateZhToEnUs(
  server: McpServer,
  _env: CloudflareBindings
): void {
  server.tool(
    "transcreate_zh_to_en_us",
    "v2 Phase 4: reverse transcreation of Chinese seller copy to American-audience English. Replaces v1 localize_to_zh for the v2 Chinese-sellers-on-American-platforms flow. Phase 4 stub: passthrough output + ad-content flagger.",
    TranscreateZhToEnUsInput.shape,
    async (params) => {
      // Phase 4 stub — Phase 4-follow wires the real Sonnet 4.6 call.
      // Returning the zh source unmodified is intentional; the flagger result
      // is the load-bearing signal for the orchestrator.
      const en_text_stub = `[PHASE_4_STUB] ${params.zh_source}`;

      const flags = flagUsAdContent(en_text_stub);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                surface: params.surface,
                en_text: en_text_stub,
                flagged_issues: flags,
                cost_cents: 0,
                stub: true,
                note: "Phase 4 stub — replace function body with anthropic.messages.create({ system: TRANSCREATION_SYSTEM_PROMPT, ... }) and prompt-cache the system to keep cost <$0.001/call.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
