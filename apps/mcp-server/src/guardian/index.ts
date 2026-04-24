import Anthropic from "@anthropic-ai/sdk";
import { BrandScorecard } from "@ff/types";
import type { BrandScorecardType } from "@ff/types";

const GUARDIAN_SYSTEM = `You are the Faraday Future Brand Guardian — an expert visual compliance reviewer trained on FF brand guidelines.

BRAND STANDARDS:
- Primary Blue: #1C3FAA | Electric Blue: #00A8E8 | Accent Gold: #C9A84C | FF Black: #0A0A0A | FF White: #FFFFFF
- Typography: Maison Neue (EN), Source Han Sans SC (ZH). Min H1: 32pt, H2: 24pt, Body: 14pt
- Logo: min 80px wide, 40px clear space, allowed placements: top-left, bottom-center, bottom-right
- Imagery: studio-grade or cinematic quality. No blur, compression artifacts, amateur lighting, or stock-photo feel
- Copy tone: aspirational, precise, investor-grade, future-forward. NO exclamation marks. NEVER use: cheap, affordable, budget, discount, deal, sale, low cost, inexpensive
- Scoring weights: color 20%, typography 20%, logo 15%, image quality 25%, copy tone 20%
- Pass threshold: 70/100. Critical violations cap score at 40

You will receive an asset (image URL or copy text) and must return a JSON scorecard ONLY — no prose, no markdown, pure JSON.`;

const GUARDIAN_USER_TEMPLATE = (
  assetType: string,
  copyEn?: string,
  copyZh?: string
) => `Score this ${assetType} asset against FF brand guidelines.

${copyEn ? `ENGLISH COPY:\n${copyEn}\n\n` : ""}${copyZh ? `CHINESE COPY:\n${copyZh}\n\n` : ""}
Return ONLY this JSON (no markdown fences):
{
  "overall_score": <0-100 integer>,
  "pass": <boolean, true if overall_score >= 70>,
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
}): Promise<BrandScorecardType> {
  const client = new Anthropic({ apiKey: params.apiKey });

  const isVideo = params.assetType === "video";

  const userText = GUARDIAN_USER_TEMPLATE(params.assetType, params.copyEn, params.copyZh);

  const contentBlocks: Anthropic.MessageParam["content"] = isVideo
    ? [{ type: "text", text: userText }]
    : [
        {
          type: "image",
          source: { type: "url", url: params.assetUrl },
        } as unknown as Anthropic.ImageBlockParam,
        { type: "text", text: userText },
      ];

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1024,
    system: GUARDIAN_SYSTEM,
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
    return fallbackScorecard(`JSON parse error: ${cleaned.slice(0, 200)}`);
  }

  const result = BrandScorecard.safeParse(parsed);
  if (!result.success) {
    return fallbackScorecard(`Schema validation failed: ${result.error.message}`);
  }

  // Enforce pass threshold consistency
  const scorecard = result.data;
  scorecard.pass = scorecard.overall_score >= 70;

  return scorecard;
}

function fallbackScorecard(reason: string): BrandScorecardType {
  return {
    overall_score: 50,
    pass: false,
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
