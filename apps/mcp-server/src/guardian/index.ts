import Anthropic from "@anthropic-ai/sdk";
import { BrandScorecard } from "@ff/types";
import type { BrandScorecardType } from "@ff/types";
import {
  type BrandProfile,
  FF_DEFAULT_PROFILE,
  formatProfileForGuardian,
  resolveBrandProfile,
} from "../lib/brand-profile.js";

// Phase 1 P1.2 — guardian no longer hardcodes Faraday Future brand
// rules. The system prompt is now rendered per-tenant from
// `tenants.brand_profile` (or the FF default for legacy/seed tenants).
// See lib/brand-profile.ts for the shape + resolver logic.

const GUARDIAN_USER_TEMPLATE = (
  assetType: string,
  brandName: string,
  passThreshold: number,
  copyEn?: string,
  copyZh?: string
) => `Score this ${assetType} asset against ${brandName} brand guidelines.

${copyEn ? `ENGLISH COPY:\n${copyEn}\n\n` : ""}${copyZh ? `CHINESE COPY:\n${copyZh}\n\n` : ""}
Return ONLY this JSON (no markdown fences):
{
  "overall_score": <0-100 integer>,
  "pass": <boolean, true if overall_score >= ${passThreshold}>,
  "dimensions": {
    "color_compliance": { "score": <0-100>, "notes": "<one sentence>" },
    "typography_compliance": { "score": <0-100>, "notes": "<one sentence>" },
    "logo_placement": { "score": <0-100>, "notes": "<one sentence>" },
    "image_quality": { "score": <0-100>, "notes": "<one sentence>" },
    "copy_tone": { "score": <0-100>, "notes": "<one sentence>" }
  },
  "violations": [
    { "rule": "<rule name>", "severity": "critical|warning|info", "description": "<what violated>", "guideline_reference": "<optional>" }
  ],
  "suggestions": ["<actionable fix>"]
}

For assets without visible text, score typography_compliance based on layout hierarchy.
For assets without logo, score logo_placement as 50 (neutral) unless logo is clearly misplaced.
If a dimension cannot be assessed, score it 75 and note "not applicable for this asset type".`;

export async function scoreBrandCompliance(params: {
  assetUrl: string;
  assetType: string;
  copyEn?: string;
  copyZh?: string;
  apiKey: string;
  /**
   * Phase 1 P1.2 — optional per-tenant brand profile. Pass the raw
   * `tenants.brand_profile` JSONB straight through; the resolver
   * handles null + malformed by falling back to FF defaults so the
   * historical (pre-refactor) behavior is preserved for any caller
   * that doesn't yet pass a profile.
   */
  brandProfile?: BrandProfile | unknown;
}): Promise<BrandScorecardType> {
  const client = new Anthropic({ apiKey: params.apiKey });

  const profile = params.brandProfile
    ? resolveBrandProfile(params.brandProfile)
    : FF_DEFAULT_PROFILE;
  const systemPrompt = formatProfileForGuardian(profile);

  const isVideo = params.assetType === "video";

  const userText = GUARDIAN_USER_TEMPLATE(
    params.assetType,
    profile.name,
    profile.pass_threshold,
    params.copyEn,
    params.copyZh
  );

  const contentBlocks: Anthropic.MessageParam["content"] = isVideo
    ? [{ type: "text", text: userText }]
    : [
        {
          type: "image",
          source: { type: "url", url: params.assetUrl },
        } as unknown as Anthropic.ImageBlockParam,
        { type: "text", text: userText },
      ];

  // Phase 6 P6.7 — Anthropic prompt caching. The guardian system prompt
  // is the same across every call FOR THE SAME TENANT (resolved from
  // `tenants.brand_profile`). Wrap in a content block with ephemeral
  // cache so repeat asset scoring within the cache window hits the
  // cache instead of paying full input cost. Threshold: only cache if
  // the prompt is long enough to amortize the 1.25x write cost.
  const systemParam =
    systemPrompt.length >= 4096
      ? ([
          { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
        ] as unknown as Anthropic.MessageCreateParams["system"])
      : systemPrompt;

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1024,
    system: systemParam,
    messages: [{ role: "user", content: contentBlocks }],
  });

  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Strip markdown fences if model adds them
  const cleaned = rawText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Return a fallback scorecard if JSON is malformed
    return fallbackScorecard(`JSON parse error: ${cleaned.slice(0, 200)}`, profile.pass_threshold);
  }

  const result = BrandScorecard.safeParse(parsed);
  if (!result.success) {
    return fallbackScorecard(`Schema validation failed: ${result.error.message}`, profile.pass_threshold);
  }

  // Enforce pass threshold consistency. Profile-driven threshold means
  // a brand can be stricter or looser than the default 70.
  const scorecard = result.data;
  scorecard.pass = scorecard.overall_score >= profile.pass_threshold;

  return scorecard;
}

function fallbackScorecard(reason: string, passThreshold: number = 70): BrandScorecardType {
  return {
    overall_score: 50,
    pass: 50 >= passThreshold,
    dimensions: {
      color_compliance: { score: 50, notes: "Could not assess — guardian error" },
      typography_compliance: { score: 50, notes: "Could not assess — guardian error" },
      logo_placement: { score: 50, notes: "Could not assess — guardian error" },
      image_quality: { score: 50, notes: "Could not assess — guardian error" },
      copy_tone: { score: 50, notes: "Could not assess — guardian error" },
    },
    violations: [
      {
        rule: "guardian_error",
        severity: "warning",
        description: reason,
        guideline_reference: undefined,
      },
    ],
    suggestions: ["Review asset manually — automated scoring failed."],
  };
}
