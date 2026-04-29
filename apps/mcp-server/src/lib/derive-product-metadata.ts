/**
 * Phase iter1 / Issue 3 — derive category + kind from name + description.
 *
 * Operators (Chinese sellers using FF Brand Studio) shouldn't have to
 * pick a category from a hardcoded UI list — the system can read the
 * product name + description and infer it. Sonnet 4.6 is cheap, fast,
 * and constrained to a fixed enum so the output stays valid for
 * downstream image-shape-aware crops.
 *
 * If ANTHROPIC_API_KEY is missing or the call fails, we fall back to
 * sensible defaults (`other` / `compact_square`) so onboarding never
 * blocks on a flaky model — operators can edit on the product page
 * later (TODO once that page exists).
 */

import Anthropic from "@anthropic-ai/sdk";

export const PRODUCT_CATEGORIES = [
  "fishing-rod",
  "drinkware",
  "handbag",
  "watch",
  "shoe",
  "apparel",
  "accessory",
  "other",
] as const;

export const PRODUCT_KINDS = [
  "long_thin_vertical",
  "long_thin_horizontal",
  "compact_square",
  "compact_round",
  "horizontal_thin",
  "multi_component",
  "apparel_flat",
  "accessory_small",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export type ProductKind = (typeof PRODUCT_KINDS)[number];

const SYSTEM_PROMPT = `You classify e-commerce products for an SEO + image-generation pipeline.

Given a product name and (optional) description, output a JSON object with two fields:

  category — one of: ${PRODUCT_CATEGORIES.join(", ")}
  kind     — one of: ${PRODUCT_KINDS.join(", ")}

The "kind" describes the image shape, used for shape-aware crops:
  - long_thin_vertical: rod, umbrella, pole, ski (held vertically)
  - long_thin_horizontal: skis (laid flat), paddle, baguette
  - compact_square: handbag, drinkware, watch, shoe, most boxed items (1:1)
  - compact_round: hat, beanie, ball
  - horizontal_thin: 1.5-2.0 aspect ratio (wallet, clutch)
  - multi_component: a set with multiple separate parts
  - apparel_flat: t-shirt, hoodie, flat-laid clothing
  - accessory_small: jewelry, keychain, small items

Pick the SINGLE best fit. If nothing maps cleanly, return category "other"
and the closest "kind" by aspect ratio.

Respond with JSON only, no prose, no markdown:
{"category": "...", "kind": "..."}`;

export interface DerivedMetadata {
  category: ProductCategory;
  kind: ProductKind;
  source: "ai" | "fallback";
}

const DEFAULT_FALLBACK: DerivedMetadata = {
  category: "other",
  kind: "compact_square",
  source: "fallback",
};

export async function deriveProductMetadata(args: {
  name: string;
  description?: string | null;
  anthropicKey?: string;
}): Promise<DerivedMetadata> {
  if (!args.anthropicKey) return DEFAULT_FALLBACK;

  const client = new Anthropic({ apiKey: args.anthropicKey });
  const userMsg = `Product name: ${args.name}
Description: ${args.description?.trim() || "(none)"}`;

  let raw = "";
  try {
    const resp = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMsg }],
    });
    raw =
      resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "";
  } catch {
    return DEFAULT_FALLBACK;
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return DEFAULT_FALLBACK;
  let parsed: { category?: string; kind?: string };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return DEFAULT_FALLBACK;
  }

  const category = (
    PRODUCT_CATEGORIES as readonly string[]
  ).includes(parsed.category ?? "")
    ? (parsed.category as ProductCategory)
    : "other";

  const kind = (PRODUCT_KINDS as readonly string[]).includes(parsed.kind ?? "")
    ? (parsed.kind as ProductKind)
    : "compact_square";

  return { category, kind, source: "ai" };
}
