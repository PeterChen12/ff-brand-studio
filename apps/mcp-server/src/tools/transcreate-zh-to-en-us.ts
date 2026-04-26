import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Anthropic from "@anthropic-ai/sdk";
import { TranscreateZhToEnUsInput } from "@ff/types";
import { flagUsAdContent } from "../compliance/us_ad_flagger.js";
import { withToolErrorBoundary } from "../lib/tool_boundary.js";

/**
 * v2 Phase 4 — reverse transcreation: Chinese seller copy → American-English
 * ecommerce copy. Replaces v1's `localize_to_zh` (which goes the other way)
 * for the v2 Chinese-sellers-on-American-platforms flow.
 *
 * Phase 4-follow: real Sonnet 4.6 call with cached system prompt. Estimated
 * <$0.001/call after the first request warms the cache.
 *
 * The flagger ALWAYS runs over the output; it's the v2 compliance moat.
 */
export const TRANSCREATION_SYSTEM_PROMPT = `You translate Chinese ecommerce product copy to American-audience English for Amazon US and Shopify DTC listings.

Rules:
- Preserve product specs verbatim (dimensions, weights, materials, model numbers, capacity).
- Apply American conventions: imperial units alongside metric where helpful (e.g. "24oz / 710ml"), sentence case for titles, no machine-translation hallmarks ("the said product", "very nice quality").
- Strip China-specific cultural references (双11, 618, 节日, 直播 unless seller explicitly retains them).
- DO NOT use any of these phrases — they trigger Amazon ToS / FTC violations: "best", "#1", "guaranteed", "money-back guarantee" without policy backing, "eco-friendly" without certification, named competitor comparisons, "as seen on", expert/doctor endorsements, FDA-related claims, weight-loss promises with specific amounts.
- Surface-specific length:
  - amazon_title: 80–200 chars, format "Brand + Product + Key Feature + Variant"
  - amazon_bullet: imperative voice, lead with benefit, ≤180 chars per bullet
  - amazon_description: paragraphs, 1500-2000 chars total
  - a_plus_callout: 1-2 sentences per callout, ≤80 chars each
  - shopify_description: warmer brand voice, 800-1200 chars
  - image_overlay: ≤8 words, marketing voice, no banned phrases

Return JSON only, no prose: { "en_text": "...", "notes": ["any decisions made"] }`;

const SURFACE_HINT: Record<string, string> = {
  amazon_title: "Output a single Amazon listing title.",
  amazon_bullet: "Output up to 5 bullet-point benefits, one per line.",
  amazon_description: "Output an Amazon long-form product description.",
  a_plus_callout: "Output 3 short callout strings as a JSON array in en_text.",
  shopify_description: "Output a Shopify product description.",
  image_overlay: "Output a single ≤8-word headline string.",
};

export function registerTranscreateZhToEnUs(
  server: McpServer,
  env: CloudflareBindings
): void {
  server.tool(
    "transcreate_zh_to_en_us",
    "v2 Phase 4: Sonnet 4.6 reverse transcreation of Chinese seller copy to American-audience English with cached system prompt + automatic US ad-content flagging.",
    TranscreateZhToEnUsInput.shape,
    withToolErrorBoundary("transcreate_zh_to_en_us", async (params) => {
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

      const surfaceHint = SURFACE_HINT[params.surface] ?? "";
      const brandVoiceHint = params.brand_voice
        ? `\n\nBrand voice constraints: ${JSON.stringify(params.brand_voice)}`
        : "";

      let resp;
      let costCents = 0;
      let stub = false;
      let en_text = "";
      let notes: string[] = [];

      try {
        resp = await client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          system: [
            {
              type: "text",
              text: TRANSCREATION_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [
            {
              role: "user",
              content: `Surface: ${params.surface}\n${surfaceHint}${brandVoiceHint}\n\nChinese source:\n${params.zh_source}`,
            },
          ],
        });

        const raw = resp.content[0].type === "text" ? resp.content[0].text.trim() : "";
        // Try to extract JSON; tolerant of fences or surrounding prose.
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            en_text = parsed.en_text ?? raw;
            notes = Array.isArray(parsed.notes) ? parsed.notes : [];
          } catch {
            en_text = raw;
            notes = ["model returned non-JSON; using raw output"];
          }
        } else {
          en_text = raw;
        }

        // Cost estimate using approx cached system + small user message
        const inputTokens = resp.usage?.input_tokens ?? 0;
        const cachedTokens = resp.usage?.cache_read_input_tokens ?? 0;
        const outputTokens = resp.usage?.output_tokens ?? 0;
        // Sonnet 4.6: $3/MTok input, $0.30/MTok cached, $15/MTok output
        const costUsd =
          ((inputTokens - cachedTokens) * 3 +
            cachedTokens * 0.3 +
            outputTokens * 15) /
          1_000_000;
        costCents = Math.round(costUsd * 100 * 100) / 100;
      } catch (err) {
        // Fall back to passthrough stub if API errors out (e.g., key revoked).
        stub = true;
        en_text = `[TRANSCREATE_FAILED] ${params.zh_source}`;
        notes = [`anthropic api error: ${(err as Error).message}`];
      }

      // ALWAYS run the ad-content flagger on the output, real or stub.
      const flags = flagUsAdContent(en_text);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                surface: params.surface,
                en_text,
                notes,
                flagged_issues: flags,
                cost_cents: costCents,
                stub,
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
