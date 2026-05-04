/**
 * Image QA Layer 2 — batch consistency check.
 *
 * Runs ONCE at the end of a launch, after every individual image has
 * passed Layer 1's dual-judge. The single Haiku 4.5 call sees all
 * approved images at once and verifies cross-image properties Layer 1
 * cannot:
 *   - Same product across every shot? (e.g. handle/branding/proportions
 *     consistent — addresses the "lifestyle handle differs from main"
 *     failure mode)
 *   - Uniform background style?
 *   - No near-duplicate angles?
 *   - Decent coverage (front + side + detail + lifestyle)?
 *
 * Returns per-image flags + an `overall_approved` boolean. The pipeline
 * uses the boolean to demote runs to `hitl_blocked` (V1 behavior — auto-
 * regen of inconsistent images is deferred per the iteration plan).
 *
 * Cost: one Haiku call with up to 12 images attached (Amazon 7 + Shopify
 * 5). ~55K input tokens + ~1K output ≈ $0.06/launch.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { DbClient } from "../db/client.js";
import { imageQaJudgments } from "../db/schema.js";

export const BATCH_CONSISTENCY_SYSTEM_PROMPT = `You are a strict cross-image consistency judge for an e-commerce listing.

You will see N images of what the operator says is the SAME product. Your job: verify they actually depict the same product and read together as a coherent listing set.

CHECKS (per the OVERALL set):
1. Product consistency — same product in every shot? Distinctive features (handle/grip color & shape, branding text, hardware, proportions, materials) should be consistent. Lighting/angle variation is fine; product identity changes are not.
2. Background style — backgrounds should be coherent across the set. Pure-white slots should all be pure white; lifestyle slots should all use a similar scene grammar (don't mix studio + outdoor + abstract).
3. Near-duplicates — no two images should be too similar. Each image should serve a distinct purpose (main / left / right / detail / lifestyle).
4. Coverage — the set should reasonably showcase the product (front view + at least one alternate angle + at least one detail/lifestyle).

REJECT individual images for:
- This image's product differs from the others (handle color wrong, branding mismatch, etc.)
- This image is essentially a near-duplicate of another in the set
- This image has a wildly different background style than the others
- This image is positionally redundant (we already have two front-views)

Return JSON ONLY (no prose):
{
  "overall_approved": boolean,
  "overall_reason": "short string",
  "per_image": [
    { "index": 0, "approved": boolean, "issue": "string-if-rejected" },
    ...
  ]
}

Be strict but fair: if all images depict the same product reasonably well and the set has decent coverage, approve. If you see a clear inconsistency or duplication, reject the offending image AND set overall_approved to false.`;

export interface BatchConsistencyImage {
  asset_id: string;
  platform: string;
  slot: string;
  url: string;
}

export interface BatchConsistencyJudgment {
  asset_id: string;
  index: number;
  approved: boolean;
  issue?: string;
}

export interface BatchConsistencyResult {
  overall_approved: boolean;
  overall_reason: string;
  per_image: BatchConsistencyJudgment[];
  cost_cents: number;
  metrics: Record<string, unknown>;
}

interface ImagePayload {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
}

async function fetchImageAsBase64(url: string): Promise<ImagePayload> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
  const ct = r.headers.get("content-type") ?? "image/jpeg";
  const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const mediaType = (allowed.includes(ct) ? ct : "image/jpeg") as
    | "image/jpeg"
    | "image/png"
    | "image/gif"
    | "image/webp";
  const buf = Buffer.from(await r.arrayBuffer());
  return { mediaType, data: buf.toString("base64") };
}

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
// Cap at 12 — Amazon main+left+right+lifestyle+a_plus×3 + Shopify hero+
// gallery×4 ≈ 12. Beyond that the input cost balloons without marginal
// signal gain on a single check.
export const MAX_BATCH_IMAGES = 12;

export interface BatchConsistencyInput {
  images: BatchConsistencyImage[];
  api_key: string;
  model?: string;
  /** When set, persists each per-image judgment row. */
  persist?: { db: DbClient; tenantId: string };
}

export async function checkBatchConsistency(
  input: BatchConsistencyInput
): Promise<BatchConsistencyResult> {
  // Skip the call entirely if there's only one image — nothing to compare.
  if (input.images.length <= 1) {
    return {
      overall_approved: true,
      overall_reason: "single image — no batch check needed",
      per_image: input.images.map((img, i) => ({
        asset_id: img.asset_id,
        index: i,
        approved: true,
      })),
      cost_cents: 0,
      metrics: { skipped: "single_image" },
    };
  }

  // Cap to MAX_BATCH_IMAGES; if more, the Layer-2 V1 strategy is to
  // sample the first N. Future iteration: chunk + merge verdicts.
  const trimmed = input.images.slice(0, MAX_BATCH_IMAGES);

  // Fetch every image in parallel.
  let payloads: ImagePayload[];
  try {
    payloads = await Promise.all(trimmed.map((img) => fetchImageAsBase64(img.url)));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      overall_approved: false,
      overall_reason: `image fetch failed: ${msg}`,
      per_image: trimmed.map((img, i) => ({
        asset_id: img.asset_id,
        index: i,
        approved: false,
        issue: "fetch failed",
      })),
      cost_cents: 0,
      metrics: { fetch_error: msg },
    };
  }

  const model = input.model ?? DEFAULT_MODEL;
  const client = new Anthropic({
    apiKey: input.api_key,
    maxRetries: 3,
    timeout: 20_000, // larger timeout — multi-image input takes longer
  });

  const labels = trimmed
    .map((img, i) => `Image ${i}: ${img.platform} · ${img.slot}`)
    .join("\n");
  const userText =
    "All images follow. Apply the rubric and return JSON only. " +
    "Image labels (ordered, 0-indexed):\n" +
    labels;

  const content: Anthropic.MessageParam["content"] = [];
  for (const p of payloads) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: p.mediaType, data: p.data },
    });
  }
  content.push({ type: "text", text: userText });

  let resp;
  try {
    resp = await client.messages.create({
      model,
      max_tokens: 1500,
      system: [
        {
          type: "text",
          text: BATCH_CONSISTENCY_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Network / quota / model error — fail OPEN (approve) so a flaky
    // judge never tanks an otherwise-clean launch. Layer 1 already
    // approved each image individually, so the per-image floor stands.
    return {
      overall_approved: true,
      overall_reason: `batch judge unavailable: ${msg} — falling back to Layer 1 verdicts`,
      per_image: trimmed.map((img, i) => ({
        asset_id: img.asset_id,
        index: i,
        approved: true,
      })),
      cost_cents: 0,
      metrics: { judge_error: msg },
    };
  }

  const raw = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "";
  const m = raw.match(/\{[\s\S]*\}/);
  let overallApproved = true;
  let overallReason = "judge returned malformed response — defaulting to approve";
  let perImageRaw: Array<{ index?: number; approved?: boolean; issue?: string }> = [];
  if (m) {
    try {
      const parsed = JSON.parse(m[0]) as {
        overall_approved?: boolean;
        overall_reason?: string;
        per_image?: Array<{ index?: number; approved?: boolean; issue?: string }>;
      };
      if (typeof parsed.overall_approved === "boolean") {
        overallApproved = parsed.overall_approved;
      }
      if (typeof parsed.overall_reason === "string") {
        overallReason = parsed.overall_reason.slice(0, 300);
      }
      if (Array.isArray(parsed.per_image)) {
        perImageRaw = parsed.per_image;
      }
    } catch {
      // fall through to defaults
    }
  }

  const per_image: BatchConsistencyJudgment[] = trimmed.map((img, i) => {
    const found = perImageRaw.find((p) => p.index === i);
    return {
      asset_id: img.asset_id,
      index: i,
      approved: found?.approved !== false,
      issue:
        found?.approved === false && typeof found.issue === "string"
          ? found.issue.slice(0, 200)
          : undefined,
    };
  });

  // Cost (Haiku 4.5: ~$1 in / $5 out per Mtoken; cached input ~10%).
  const inputTokens = resp.usage?.input_tokens ?? 0;
  const cachedTokens = resp.usage?.cache_read_input_tokens ?? 0;
  const outputTokens = resp.usage?.output_tokens ?? 0;
  const usd =
    ((inputTokens - cachedTokens) * 1 +
      cachedTokens * 0.1 +
      outputTokens * 5) /
    1_000_000;
  const cost_cents = Math.round(usd * 100 * 100) / 100;

  // Persist per-image judgments. Best-effort.
  if (input.persist) {
    try {
      await input.persist.db.insert(imageQaJudgments).values(
        per_image.map((j) => ({
          tenantId: input.persist!.tenantId,
          assetId: j.asset_id,
          judgeId: "consistency",
          verdict: j.approved ? "approve" : "reject",
          reason: j.issue ?? (j.approved ? "consistent with batch" : "rejected"),
          model,
          // Cost is per-call, not per-image; we attribute it to the
          // first image as a convention so per-asset cost queries
          // sum to the call total without double-counting.
          costCents: j.index === 0 ? cost_cents : 0,
          iteration: 1,
          meta: {
            slot: trimmed[j.index]?.slot,
            platform: trimmed[j.index]?.platform,
            overall_approved: overallApproved,
            overall_reason: overallReason,
          },
        }))
      );
    } catch (persistErr) {
      console.warn(
        "[batch_consistency] persist failed",
        persistErr instanceof Error ? persistErr.message : String(persistErr)
      );
    }
  }

  return {
    overall_approved: overallApproved,
    overall_reason: overallReason,
    per_image,
    cost_cents,
    metrics: {
      model,
      input_tokens: inputTokens,
      cached_tokens: cachedTokens,
      output_tokens: outputTokens,
      images_judged: trimmed.length,
    },
  };
}
