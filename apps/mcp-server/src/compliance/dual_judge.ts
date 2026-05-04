/**
 * Image QA Layer 1 — dual-judge consensus on a generated image.
 *
 * Replaces the single Opus 4.7 vision pass with TWO Haiku 4.5 calls
 * in parallel:
 *   - Judge A — Source similarity: does the generated image look like
 *     the SAME product as the operator's reference photos? Distinctive
 *     features (handle color/shape, branding, proportions) must match
 *     >=90%. Catches "wrong handle on lifestyle shot" failures.
 *   - Judge B — Framing & integrity: is the FULL subject visible
 *     (no awkward crops), does the aspect ratio fit the platform slot,
 *     is the background clean (no color banding, halos, photoshop
 *     seams)? Catches "main image only shows a small portion of the
 *     rod" + "white bg has color separation" failures.
 *
 * Consensus rule: BOTH must Approve. Either Reject → overall Reject
 * with concatenated reasons; the regen prompt uses the reasons to
 * steer the next attempt.
 *
 * Cost: ~$0.006 per Haiku call → $0.012 per image — same as the
 * single Opus pass it replaces.
 *
 * Returns a `PlatformComplianceResultType`-compatible shape so the
 * existing amazon_scorer / shopify_scorer call sites don't change
 * structure; rating maps as approve→EXCELLENT, reject→POOR.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  PlatformComplianceRatingType,
  PlatformComplianceResultType,
} from "@ff/types";
import type { DbClient } from "../db/client.js";
import { imageQaJudgments } from "../db/schema.js";

export const SIMILARITY_JUDGE_SYSTEM_PROMPT = `You are a strict image-similarity judge for an e-commerce listing pipeline.

You will see ONE generated image followed by 1-N reference photos of the SAME real product. Your job: decide whether the generated image depicts the SAME product as the references.

CRITERIA — focus on these distinctive features:
- Color of body, handle, grip, branding marks
- Shape and proportions (overall silhouette, length-to-width ratio)
- Material texture (matte vs glossy, woven vs molded, metal vs plastic)
- Hardware details (guides, reels, buttons, fasteners, stitching, logos)
- Component count (segments, parts, sub-assemblies)

REJECT if ANY of these differ visibly between the generated image and the references:
- Handle/grip color or shape mismatched
- Branding text/logo wrong, missing, or hallucinated
- Major component missing or added (e.g. reel present in references but not in render, or vice versa)
- Proportions wrong (e.g. 12ft rod rendered as a 5ft rod)
- Material/finish mismatched (e.g. matte references rendered as glossy)

APPROVE if the generated image clearly depicts the same product within minor styling variation (lighting, angle, background — those are expected to differ for non-main slots).

Return JSON ONLY (no prose):
{
  "verdict": "approve" | "reject",
  "reason": "one sentence; if reject, name the specific feature that differs"
}`;

export const FRAMING_JUDGE_SYSTEM_PROMPT = `You are a strict framing & integrity judge for an e-commerce listing pipeline.

You will see ONE generated image. Your job: decide whether it's well-composed and free of obvious AI/photoshop artifacts.

CRITERIA:
1. Subject framing — the FULL product must be visible end-to-end. No awkward crops where part of the subject is cut off (e.g. tip of a rod missing, handle out of frame). Subject occupies a generous fraction of the canvas.
2. Aspect & composition — appropriate for the slot (square or 4:3 typical). Subject not awkwardly placed in a corner unless intentional.
3. Background integrity — for white-background slots: pure white at all four corners, no visible color banding, no gradient seams, no halo around the subject, no obvious photoshop edges. For lifestyle slots: scene is coherent, no warped horizon, no impossible shadows.
4. AI artifacts — no extra fingers, no melted geometry, no duplicated parts, no impossible reflections, no "uncanny" rendering of fine details (text, fasteners, threads).
5. Detail integrity — fine features (text on the product, threading, hardware) render cleanly, not as smudges.

REJECT if any criterion fails clearly. Examples:
- "rod tip cropped — only the lower half visible"
- "white background has visible vertical color banding behind the subject"
- "halo of pixels around the handle suggests poor masking"
- "grip texture rendered as a smudged blob, not woven leather as expected"

APPROVE if the image is publish-ready as-is.

Return JSON ONLY (no prose):
{
  "verdict": "approve" | "reject",
  "reason": "one sentence; if reject, name the specific failure"
}`;

export interface DualJudgeInput {
  /** Public URL of the generated image to evaluate. */
  generated_image_url: string;
  /**
   * Public URLs of the operator's reference photos for the SAME
   * product (1-4 typical). Used by the similarity judge only.
   */
  reference_image_urls: string[];
  /** Hint passed into both judges (e.g. "amazon-us · main"). */
  slot_label: string;
  /** Optional category hint piped into the framing judge. */
  category?: string;
  /** Anthropic API key from Worker env. */
  api_key: string;
  /** Override default model. Defaults to claude-haiku-4-5-20251001. */
  model?: string;
  /** When set, persists each judgment row to image_qa_judgments. */
  persist?: {
    db: DbClient;
    tenantId: string;
    assetId: string;
    iteration: number;
  };
}

export interface DualJudgeOutput {
  rating: PlatformComplianceRatingType;
  approved: boolean;
  /** Per-judge breakdown for the regen prompt + observability. */
  judgments: {
    similarity: { verdict: "approve" | "reject"; reason: string };
    framing: { verdict: "approve" | "reject"; reason: string };
  };
  /** Concatenated rejection reasons; empty if approved. */
  reasons: string[];
  cost_cents: number;
  metrics: Record<string, unknown>;
}

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

interface JudgeOneArgs {
  client: Anthropic;
  model: string;
  systemPrompt: string;
  primaryImage: ImagePayload;
  referenceImages?: ImagePayload[];
  userText: string;
}

interface ImagePayload {
  url: string;
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string; // base64
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
  return { url, mediaType, data: buf.toString("base64") };
}

interface JudgeOneResult {
  verdict: "approve" | "reject";
  reason: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

async function judgeOne(args: JudgeOneArgs): Promise<JudgeOneResult> {
  const content: Anthropic.MessageParam["content"] = [];

  // Generated image first
  content.push({
    type: "image",
    source: {
      type: "base64",
      media_type: args.primaryImage.mediaType,
      data: args.primaryImage.data,
    },
  });

  // References (similarity judge only)
  if (args.referenceImages && args.referenceImages.length > 0) {
    content.push({
      type: "text",
      text: "Reference photos of the same product follow:",
    });
    for (const ref of args.referenceImages) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: ref.mediaType,
          data: ref.data,
        },
      });
    }
  }

  content.push({ type: "text", text: args.userText });

  const resp = await args.client.messages.create({
    model: args.model,
    max_tokens: 200,
    system: [
      {
        type: "text",
        text: args.systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content }],
  });

  const raw = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "";
  const m = raw.match(/\{[\s\S]*\}/);
  let verdict: "approve" | "reject" = "reject";
  let reason = "judge returned malformed response";
  if (m) {
    try {
      const parsed = JSON.parse(m[0]) as {
        verdict?: string;
        reason?: string;
      };
      if (parsed.verdict === "approve" || parsed.verdict === "reject") {
        verdict = parsed.verdict;
      }
      if (typeof parsed.reason === "string" && parsed.reason.length > 0) {
        reason = parsed.reason.slice(0, 300);
      } else if (verdict === "approve") {
        reason = "judge approved";
      }
    } catch {
      // keep defaults
    }
  }

  return {
    verdict,
    reason,
    inputTokens: resp.usage?.input_tokens ?? 0,
    cachedTokens: resp.usage?.cache_read_input_tokens ?? 0,
    outputTokens: resp.usage?.output_tokens ?? 0,
  };
}

function tokenCostCents(
  input: number,
  cached: number,
  output: number
): number {
  // Haiku 4.5: ~$1 in / $5 out per Mtoken; cached input is ~10% of fresh.
  const usd =
    ((input - cached) * 1 + cached * 0.1 + output * 5) / 1_000_000;
  return Math.round(usd * 100 * 100) / 100; // tenths of a cent
}

export async function judgeImage(
  input: DualJudgeInput
): Promise<DualJudgeOutput> {
  const model = input.model ?? DEFAULT_MODEL;
  const client = new Anthropic({
    apiKey: input.api_key,
    maxRetries: 3,
    timeout: 15_000,
  });

  // Fetch images once; both judges share the bytes.
  let primary: ImagePayload;
  let refs: ImagePayload[] = [];
  try {
    primary = await fetchImageAsBase64(input.generated_image_url);
    if (input.reference_image_urls.length > 0) {
      // Cap at 4 refs — beyond that the input cost balloons without
      // marginal accuracy gain. Take the first 4.
      const urls = input.reference_image_urls.slice(0, 4);
      refs = await Promise.all(urls.map(fetchImageAsBase64));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      rating: "POOR",
      approved: false,
      judgments: {
        similarity: { verdict: "reject", reason: `image fetch failed: ${msg}` },
        framing: { verdict: "reject", reason: `image fetch failed: ${msg}` },
      },
      reasons: [`image fetch failed: ${msg}`],
      cost_cents: 0,
      metrics: { fetch_error: msg },
    };
  }

  // Both judges in parallel.
  const userText = `Slot: ${input.slot_label}.${input.category ? ` Category: ${input.category}.` : ""} Apply the rubric and return JSON only.`;

  const [simResult, frameResult] = await Promise.allSettled([
    judgeOne({
      client,
      model,
      systemPrompt: SIMILARITY_JUDGE_SYSTEM_PROMPT,
      primaryImage: primary,
      referenceImages: refs.length > 0 ? refs : undefined,
      userText,
    }),
    judgeOne({
      client,
      model,
      systemPrompt: FRAMING_JUDGE_SYSTEM_PROMPT,
      primaryImage: primary,
      userText,
    }),
  ]);

  const sim: JudgeOneResult & { error?: string } =
    simResult.status === "fulfilled"
      ? simResult.value
      : {
          verdict: "reject",
          reason: `similarity judge crashed: ${simResult.reason}`,
          inputTokens: 0,
          cachedTokens: 0,
          outputTokens: 0,
          error: String(simResult.reason),
        };
  const frame: JudgeOneResult & { error?: string } =
    frameResult.status === "fulfilled"
      ? frameResult.value
      : {
          verdict: "reject",
          reason: `framing judge crashed: ${frameResult.reason}`,
          inputTokens: 0,
          cachedTokens: 0,
          outputTokens: 0,
          error: String(frameResult.reason),
        };

  // If similarity had no references, the judge isn't meaningful — treat
  // as auto-approve (do NOT block on missing references).
  if (refs.length === 0) {
    sim.verdict = "approve";
    sim.reason = "no reference images supplied — similarity check skipped";
  }

  const approved = sim.verdict === "approve" && frame.verdict === "approve";
  const reasons: string[] = [];
  if (sim.verdict === "reject") reasons.push(`similarity: ${sim.reason}`);
  if (frame.verdict === "reject") reasons.push(`framing: ${frame.reason}`);

  const simCost = tokenCostCents(sim.inputTokens, sim.cachedTokens, sim.outputTokens);
  const frameCost = tokenCostCents(frame.inputTokens, frame.cachedTokens, frame.outputTokens);
  const cost_cents = simCost + frameCost;

  // Persist if requested. Best-effort; persist failure must not block the
  // pipeline.
  if (input.persist) {
    try {
      await input.persist.db.insert(imageQaJudgments).values([
        {
          tenantId: input.persist.tenantId,
          assetId: input.persist.assetId,
          judgeId: "similarity",
          verdict: sim.verdict,
          reason: sim.reason,
          model,
          costCents: simCost,
          iteration: input.persist.iteration,
          meta: { slot: input.slot_label, ref_count: refs.length },
        },
        {
          tenantId: input.persist.tenantId,
          assetId: input.persist.assetId,
          judgeId: "framing",
          verdict: frame.verdict,
          reason: frame.reason,
          model,
          costCents: frameCost,
          iteration: input.persist.iteration,
          meta: { slot: input.slot_label },
        },
      ]);
    } catch (persistErr) {
      console.warn(
        "[dual_judge] persist failed",
        persistErr instanceof Error ? persistErr.message : String(persistErr)
      );
    }
  }

  // Map to the existing PlatformComplianceResult-compatible shape.
  // approved → EXCELLENT (so it short-circuits the retry loop).
  // rejected → POOR (forces a regen).
  const rating: PlatformComplianceRatingType = approved ? "EXCELLENT" : "POOR";

  return {
    rating,
    approved,
    judgments: {
      similarity: { verdict: sim.verdict, reason: sim.reason },
      framing: { verdict: frame.verdict, reason: frame.reason },
    },
    reasons,
    cost_cents,
    metrics: {
      model,
      similarity_input_tokens: sim.inputTokens,
      similarity_output_tokens: sim.outputTokens,
      similarity_cost_cents: simCost,
      framing_input_tokens: frame.inputTokens,
      framing_output_tokens: frame.outputTokens,
      framing_cost_cents: frameCost,
      reference_image_count: refs.length,
    },
  };
}

/**
 * Adapter so existing call sites that expect a `PlatformComplianceResult`
 * shape don't have to know about `judgments`. The dual-judge reasons
 * land in the standard `issues` field; no caller breakage.
 */
export function dualJudgeToComplianceResult(
  out: DualJudgeOutput
): PlatformComplianceResultType & { cost_cents: number } {
  return {
    rating: out.rating,
    issues: out.reasons,
    suggestions: out.reasons.map((r) => `regenerate to address: ${r}`),
    metrics: out.metrics,
    cost_cents: out.cost_cents,
  };
}
