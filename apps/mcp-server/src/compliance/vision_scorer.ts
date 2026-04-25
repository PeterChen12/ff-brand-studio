/**
 * v2 Phase 4-follow — Opus 4.7 vision scorer.
 *
 * The deterministic scorer (`amazon_scorer.ts`) can only check what's in
 * platform_assets metadata — dimensions, format, spec compliance. It cannot
 * see whether the actual image has overlaid text, watermarks, props, or
 * violates category-specific rules (apparel must be on a model, shoes
 * facing 45° left, etc.).
 *
 * This module fetches the rendered image from R2 and asks Claude Opus 4.7
 * vision to score the image content directly. Returns the same shape as
 * the deterministic scorer so the two can be merged in `amazon_scorer.ts`.
 *
 * Cost: ~$0.02 per call (Opus 4.7 vision input + ~200 output tokens).
 * Opt-in only — the deterministic path remains the default cost-zero scorer.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  PlatformComplianceRatingType,
  PlatformComplianceResultType,
} from "@ff/types";

export const AMAZON_VISION_RUBRIC_SYSTEM_PROMPT = `You audit Amazon US main-image compliance by looking at the actual rendered image. Score on:

1. Background — must be pure white RGB(255,255,255) at all four corners and >95% of frame.
2. Product fill — main product must occupy ~85-95% of the longest canvas dimension.
3. Text/logos/watermarks — main image MUST NOT contain overlaid text, watermarks, brand callouts, "best", "guaranteed", price stickers, or any added graphics. Logos that are physically printed on the product itself are OK.
4. Props/packaging — only the product itself; no boxes (unless the product IS a box), no stands, no extra items, no people unless the category is apparel/wearables.
5. Category rules — if visible:
   - Apparel: must be on a model OR a ghost mannequin. Hangers and flat-lay are NOT allowed.
   - Shoes: single shoe, facing 45° left, no laces hanging.
   - Kids' clothing: flat-lay or off-model only (no AI-generated children).
6. Composition — product centered, in focus, single product (no comparison shots).
7. AI artifacts — no obvious hallucinations (extra fingers, distorted hardware, melted edges).

Return JSON ONLY, no prose:
{
  "rating": "EXCELLENT" | "GOOD" | "FAIR" | "POOR",
  "issues": ["specific issue 1", ...],
  "suggestions": ["specific fix 1", ...]
}

Map issue counts to rating: 0 issues → EXCELLENT, 1 minor → GOOD, 1 major OR 2 minor → FAIR, 3+ or any blocking issue (text/watermarks/missing-model-on-apparel) → POOR.`;

export interface VisionScorerInput {
  /** Public URL where the image lives (R2 public URL or fal CDN). */
  asset_url: string;
  /** Hint for the model on category rules to apply. */
  category?: string;
  /** Anthropic API key from Worker env. */
  api_key: string;
  /** Override default model. */
  model?: string;
}

export async function visionScoreAmazonMain(
  input: VisionScorerInput
): Promise<PlatformComplianceResultType & { cost_cents: number }> {
  const client = new Anthropic({ apiKey: input.api_key });
  const model = input.model ?? "claude-opus-4-7";

  const userText =
    `Audit this Amazon US main image. ` +
    (input.category ? `Product category: ${input.category}. ` : "") +
    `Apply the rubric. Return JSON only.`;

  let resp;
  try {
    // SDK v0.36 only supports base64 image source. Fetch + convert.
    const imgResp = await fetch(input.asset_url);
    if (!imgResp.ok) {
      throw new Error(`fetch ${input.asset_url} -> ${imgResp.status}`);
    }
    const contentType = imgResp.headers.get("content-type") ?? "image/jpeg";
    const allowedMedia = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    const mediaType = (
      allowedMedia.includes(contentType) ? contentType : "image/jpeg"
    ) as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    const buf = Buffer.from(await imgResp.arrayBuffer());
    const base64 = buf.toString("base64");

    resp = await client.messages.create({
      model,
      max_tokens: 800,
      system: [
        {
          type: "text",
          text: AMAZON_VISION_RUBRIC_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            { type: "text", text: userText },
          ],
        },
      ],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      rating: "POOR",
      issues: [`vision scorer api error: ${msg}`],
      suggestions: [
        "fall back to deterministic scorer; re-run when API key/budget restored",
      ],
      metrics: { vision_error: msg },
      cost_cents: 0,
    };
  }

  const raw = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "";

  let parsed: { rating?: string; issues?: unknown; suggestions?: unknown } = {};
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      // Fall through to default
    }
  }

  const ratingStr = String(parsed.rating ?? "POOR").toUpperCase();
  const rating: PlatformComplianceRatingType = (
    ["EXCELLENT", "GOOD", "FAIR", "POOR"].includes(ratingStr)
      ? ratingStr
      : "POOR"
  ) as PlatformComplianceRatingType;

  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.filter((s: unknown): s is string => typeof s === "string")
    : [];
  const suggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions.filter((s: unknown): s is string => typeof s === "string")
    : [];

  // Cost estimate: Opus 4.7 vision input ~$15/MTok, output ~$75/MTok. Image
  // tokens ~1.5K for a 1024×1024 image. With cached system prompt the input
  // marginal cost is ~$0.005 + ~$0.015 output ≈ $0.02/call.
  const inputTokens = resp.usage?.input_tokens ?? 0;
  const cachedTokens = resp.usage?.cache_read_input_tokens ?? 0;
  const outputTokens = resp.usage?.output_tokens ?? 0;
  const costUsd =
    ((inputTokens - cachedTokens) * 15 +
      cachedTokens * 1.5 +
      outputTokens * 75) /
    1_000_000;
  const cost_cents = Math.round(costUsd * 100 * 100) / 100;

  return {
    rating,
    issues,
    suggestions,
    metrics: {
      model,
      input_tokens: inputTokens,
      cached_tokens: cachedTokens,
      output_tokens: outputTokens,
    },
    cost_cents,
  };
}
