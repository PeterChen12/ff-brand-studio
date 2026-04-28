/**
 * Phase I — spec extraction for the text composite slot.
 *
 * Pulls 3 short marketing-friendly specs from the product metadata
 * (dimensions, materials). Falls back to a Sonnet call when metadata
 * is sparse — that path is cached in R2 by sha256(name+category) so
 * we never re-bill the same product twice.
 */

import type { Product } from "../db/schema.js";
import { sha256Hex } from "./cache.js";

export const SONNET_SPEC_COST_CENTS = 1; // ~$0.01 per call at ~150 tokens

export interface SpecExtractionResult {
  specs: string[];
  source: "metadata" | "sonnet" | "fallback";
  costCents: number;
}

const MAX_SPEC_LEN = 30;

function trimSpec(s: string): string {
  return s.length <= MAX_SPEC_LEN ? s : s.slice(0, MAX_SPEC_LEN - 1).trim() + "…";
}

function fromMetadata(product: Pick<Product, "dimensions" | "materials" | "category">): string[] {
  const out: string[] = [];

  // Dimensions: cherry-pick the most marketable one or two attributes.
  const dims = product.dimensions as Record<string, unknown> | null;
  if (dims) {
    if (typeof dims.length === "string") out.push(`Length ${dims.length}`);
    if (typeof dims.weight === "string") out.push(`Weight ${dims.weight}`);
    if (typeof dims.capacity === "string") out.push(`Capacity ${dims.capacity}`);
    if (typeof dims.dimensions === "string") out.push(`${dims.dimensions}`);
    if (typeof dims.size === "string") out.push(`${dims.size}`);
  }

  // Materials: take up to 1 — agencies care about fabric / leather / aluminum signal.
  const mats = product.materials;
  if (Array.isArray(mats) && mats.length > 0) {
    out.push(mats[0]);
  }

  return out.slice(0, 3).map(trimSpec);
}

export async function extractSpecs(
  env: CloudflareBindings,
  product: Pick<Product, "id" | "nameEn" | "category" | "dimensions" | "materials">
): Promise<SpecExtractionResult> {
  const fromMeta = fromMetadata(product);
  if (fromMeta.length === 3) {
    return { specs: fromMeta, source: "metadata", costCents: 0 };
  }

  // Cache the Sonnet result by name + category fingerprint.
  const cacheTag = await sha256Hex(`${product.nameEn}|${product.category}`);
  const cacheKey = `pipeline-cache/specs/${cacheTag}.json`;
  const cached = await env.R2.get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(await cached.text()) as { specs: string[] };
      if (Array.isArray(parsed.specs) && parsed.specs.length === 3) {
        return { specs: parsed.specs, source: "sonnet", costCents: 0 };
      }
    } catch {
      // fall through
    }
  }

  if (!env.ANTHROPIC_API_KEY) {
    // No LLM — pad with category-flavored fallbacks so downstream never gets <3.
    const padded = [...fromMeta];
    while (padded.length < 3) {
      padded.push(`${product.category} essentials`);
    }
    return { specs: padded.slice(0, 3), source: "fallback", costCents: 0 };
  }

  const prompt = [
    `Product name: ${product.nameEn}`,
    `Category: ${product.category}`,
    "",
    "Generate exactly 3 short marketing-friendly product specs (each ≤30 chars).",
    "Each spec should emphasize a tangible product feature (size, weight, material,",
    "capacity, count, etc.). Avoid vague words like 'premium', 'luxury', 'best-in-class'.",
    "",
    "Return JSON only:",
    `{"specs":["spec1","spec2","spec3"]}`,
  ].join("\n");

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    const padded = [...fromMeta];
    while (padded.length < 3) padded.push(`${product.category} essentials`);
    return { specs: padded.slice(0, 3), source: "fallback", costCents: 0 };
  }

  if (!res.ok) {
    const padded = [...fromMeta];
    while (padded.length < 3) padded.push(`${product.category} essentials`);
    return { specs: padded.slice(0, 3), source: "fallback", costCents: 0 };
  }

  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = json.content?.find((c) => c.type === "text")?.text ?? "";
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed: { specs?: string[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = {};
  }
  let specs = Array.isArray(parsed.specs) ? parsed.specs.map(trimSpec).filter(Boolean) : [];
  specs = specs.slice(0, 3);
  while (specs.length < 3) specs.push(`${product.category} essentials`);

  await env.R2.put(cacheKey, JSON.stringify({ specs }), {
    httpMetadata: { contentType: "application/json" },
  });
  return { specs, source: "sonnet", costCents: SONNET_SPEC_COST_CENTS };
}
