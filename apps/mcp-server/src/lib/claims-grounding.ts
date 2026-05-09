/**
 * Phase C · Iteration 01 — Claims-grounding LLM judge.
 *
 * Catches hallucinated specs in generated listing copy before it reaches
 * the operator inbox. Compares the source product fields (name,
 * description, supplier specs the user typed in) against the AI-written
 * copy and flags any factual claim in the copy that isn't supported by
 * the source.
 *
 * Why this matters: today the EXCELLENT/GOOD/FAIR/POOR rating only
 * scores image quality. The text never gets fact-checked. If the SEO
 * step writes "Waterproof to 50m" or "Made in USA" out of thin air,
 * the operator can publish false advertising to Amazon — listing
 * takedown, FTC exposure, product-liability risk.
 *
 * Cheap Haiku 4.5 pass (~$0.005-$0.01 per listing). On any UNGROUNDED
 * verdict we downgrade the listing rating to FAIR so the existing HITL
 * inbox flow catches it. Operator sees the flagged claims inline and
 * can reject + regenerate without manually scanning every word.
 *
 * Failure mode: if the judge call itself errors (timeout, 5xx), we
 * default to PARTIALLY_GROUNDED with confidence:0 so we err on the side
 * of HITL review — never silently ship.
 */
import Anthropic from "@anthropic-ai/sdk";

export type ClaimsGroundingRating =
  | "GROUNDED"
  | "PARTIALLY_GROUNDED"
  | "UNGROUNDED";

export interface ClaimsGroundingResult {
  rating: ClaimsGroundingRating;
  ungroundedClaims: string[];
  confidence: number;
  source: "ai" | "fallback";
  costCents: number;
}

const SYSTEM_PROMPT = `You audit AI-generated e-commerce listing copy for false claims.

Given source product data and generated listing copy, list every factual claim in the copy that is NOT supported by, or directly contradicts, the source.

Reasonable inferences from the source ARE grounded:
  - "100% cotton" in source → "soft hand feel" in copy = grounded
  - "stainless steel" in source → "durable" in copy = grounded
  - "rechargeable lithium battery" in source → "long battery life" = grounded

Fabricated specs are NOT grounded:
  - "made of plastic" in source → "stainless steel" in copy = ungrounded
  - source says nothing about water → "waterproof to 50m" in copy = ungrounded
  - source says nothing about origin → "Made in USA" in copy = ungrounded
  - source says nothing about IP rating → "IP68 rated" in copy = ungrounded

Return ONLY this JSON shape, no prose, no markdown:
{
  "rating": "GROUNDED" | "PARTIALLY_GROUNDED" | "UNGROUNDED",
  "ungrounded_claims": ["claim 1", "claim 2"],
  "confidence": 0.0-1.0
}

Use GROUNDED when ungrounded_claims is empty.
Use PARTIALLY_GROUNDED for 1-2 minor unsupported claims.
Use UNGROUNDED for 3+ claims or any safety/material/origin claim.`;

const FALLBACK_RESULT: Omit<ClaimsGroundingResult, "costCents"> = {
  rating: "PARTIALLY_GROUNDED",
  ungroundedClaims: [],
  confidence: 0,
  source: "fallback",
};

const JUDGE_COST_CENTS = 1;

export async function checkClaimsGrounding(args: {
  source: {
    name: string;
    description?: string | null;
    category?: string | null;
  };
  generated: {
    surface: string;
    language: string;
    copy: Record<string, unknown> | null;
  };
  anthropicKey?: string;
}): Promise<ClaimsGroundingResult> {
  if (!args.anthropicKey || !args.generated.copy) {
    return { ...FALLBACK_RESULT, costCents: 0 };
  }

  const client = new Anthropic({ apiKey: args.anthropicKey });
  const sourceText = [
    `Product name: ${args.source.name}`,
    args.source.description ? `Description: ${args.source.description}` : null,
    args.source.category ? `Category: ${args.source.category}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const generatedText = JSON.stringify(args.generated.copy, null, 2);
  const userMsg = `=== SOURCE ===\n${sourceText}\n\n=== GENERATED COPY (${args.generated.surface} · ${args.generated.language}) ===\n${generatedText}`;

  let raw = "";
  try {
    const resp = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMsg }],
    });
    raw = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "";
  } catch {
    return { ...FALLBACK_RESULT, costCents: 0 };
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { ...FALLBACK_RESULT, costCents: JUDGE_COST_CENTS };

  let parsed: {
    rating?: string;
    ungrounded_claims?: unknown;
    confidence?: number;
  };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { ...FALLBACK_RESULT, costCents: JUDGE_COST_CENTS };
  }

  const ratingValid =
    parsed.rating === "GROUNDED" ||
    parsed.rating === "PARTIALLY_GROUNDED" ||
    parsed.rating === "UNGROUNDED";
  if (!ratingValid) {
    return { ...FALLBACK_RESULT, costCents: JUDGE_COST_CENTS };
  }

  const claimsArr = Array.isArray(parsed.ungrounded_claims)
    ? (parsed.ungrounded_claims as unknown[])
        .filter((c): c is string => typeof c === "string")
        .slice(0, 20)
    : [];

  const confidence =
    typeof parsed.confidence === "number" &&
    parsed.confidence >= 0 &&
    parsed.confidence <= 1
      ? parsed.confidence
      : 0.5;

  return {
    rating: parsed.rating as ClaimsGroundingRating,
    ungroundedClaims: claimsArr,
    confidence,
    source: "ai",
    costCents: JUDGE_COST_CENTS,
  };
}

/**
 * Determines the final listing rating after both image-quality and
 * claims-grounding checks. Claims-grounding is the safety floor:
 * UNGROUNDED forces FAIR (HITL review), regardless of image quality.
 * PARTIALLY_GROUNDED downgrades EXCELLENT/GOOD to GOOD/FAIR — minor
 * issues shouldn't block, but the operator should see them.
 */
export function combineRating(
  imageRating: string | null,
  groundingRating: ClaimsGroundingRating
): "EXCELLENT" | "GOOD" | "FAIR" | "POOR" {
  const baseline: "EXCELLENT" | "GOOD" | "FAIR" | "POOR" =
    imageRating === "EXCELLENT" || imageRating === "GOOD" ||
    imageRating === "FAIR" || imageRating === "POOR"
      ? imageRating
      : "FAIR";

  if (groundingRating === "UNGROUNDED") {
    // Force HITL — never let UNGROUNDED claims reach a customer
    return baseline === "POOR" ? "POOR" : "FAIR";
  }
  if (groundingRating === "PARTIALLY_GROUNDED") {
    if (baseline === "EXCELLENT") return "GOOD";
    if (baseline === "GOOD") return "FAIR";
    return baseline;
  }
  return baseline;
}
