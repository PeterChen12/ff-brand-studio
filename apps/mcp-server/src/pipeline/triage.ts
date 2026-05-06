/**
 * Phase I, Step 5a — CLIP triage via Workers AI.
 *
 * Compares the refined output to the studio reference. Cosine similarity
 * of the two CLIP embeddings; ≥0.78 (configurable per-kind via the
 * deriver) is "pass", below escalates to vision adjudication.
 *
 * Workers AI free tier covers expected triage volume comfortably. CLIP
 * embeddings cached in R2 by sha256(image bytes) so the same image
 * triaged twice is one embed call.
 *
 * 2026-05-06 — Workers AI removed `@cf/openai/clip-vit-base-patch16`
 * from the catalog (every call returns AiError 5007). With no drop-in
 * replacement, the LYKAN spike was burning ~18 subrequests on dead
 * AI.run calls per launch and tipping the pipeline past Cloudflare's
 * Bundled-plan 50-subrequest cap. Treat triage as unavailable until
 * Cloudflare ships a replacement (or we wire OpenAI/FAL as a fallback);
 * iterate.ts already handles `null` as "skip CLIP, escalate to vision".
 */

import { sha256Hex } from "./cache.js";

const CLIP_MODEL = "@cf/openai/clip-vit-base-patch16";
const CLIP_DISABLED = true;

interface ClipEmbedResponse {
  embedding?: number[];
  data?: number[];
}

async function embedImage(env: CloudflareBindings, bytes: ArrayBuffer): Promise<number[] | null> {
  // Cache by content hash so we never re-embed identical bytes.
  const hash = await sha256Hex(new Uint8Array(bytes));
  const cacheKey = `pipeline-cache/clip/${hash}.json`;
  const cached = await env.R2.get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(await cached.text()) as { embedding: number[] };
      if (Array.isArray(parsed.embedding)) return parsed.embedding;
    } catch {
      // fall through to re-embed
    }
  }

  // Workers AI accepts the image as a regular Uint8Array.
  const u8 = new Uint8Array(bytes);
  let resp: ClipEmbedResponse;
  try {
    // The Workers AI runtime returns { data: number[] } for embedding tasks.
    resp = (await env.AI.run(CLIP_MODEL, { image: Array.from(u8) })) as ClipEmbedResponse;
  } catch (err) {
    console.warn("[triage] AI.run failed:", err);
    return null;
  }
  const embedding = resp.embedding ?? resp.data;
  if (!Array.isArray(embedding) || embedding.length === 0) return null;

  await env.R2.put(cacheKey, JSON.stringify({ embedding }), {
    httpMetadata: { contentType: "application/json" },
  });
  return embedding;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Returns CLIP cosine similarity between two R2 objects, or null if
 * either embedding step failed (treat null as "skip CLIP, escalate
 * to vision" upstream).
 */
export async function clipSimilarityFromR2(
  env: CloudflareBindings,
  aKey: string,
  bKey: string
): Promise<number | null> {
  if (CLIP_DISABLED) return null;
  const [aObj, bObj] = await Promise.all([env.R2.get(aKey), env.R2.get(bKey)]);
  if (!aObj || !bObj) return null;
  const [aBytes, bBytes] = await Promise.all([aObj.arrayBuffer(), bObj.arrayBuffer()]);
  const [aEmbed, bEmbed] = await Promise.all([embedImage(env, aBytes), embedImage(env, bBytes)]);
  if (!aEmbed || !bEmbed) return null;
  return cosineSimilarity(aEmbed, bEmbed);
}
