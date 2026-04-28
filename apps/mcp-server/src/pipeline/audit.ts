/**
 * Phase I, Step 5b — Vision adjudication via Anthropic Opus 4.7.
 *
 * Called only when CLIP < threshold (~10% of refines per production
 * calibration). Returns a JSON verdict with per-checklist-item details
 * so iterate.ts can amend the next-iter prompt with the failure reasons.
 *
 * Cost: ~$0.02/call (~1500 input tokens at Opus rates). Capped to one
 * vision call per crop per launch (no recursive audit-of-audit).
 */

import type { PipelineCtx, Verdict } from "./types.js";
import { getDeriver } from "./derivers/index.js";

export const VISION_COST_CENTS = 2;

export async function visionVerdictFromR2(
  env: CloudflareBindings,
  ctx: PipelineCtx,
  referenceR2Key: string,
  generatedR2Key: string
): Promise<{ verdict: Verdict; costCents: number } | { error: string }> {
  if (!env.ANTHROPIC_API_KEY) return { error: "ANTHROPIC_API_KEY missing" };

  const [refObj, genObj] = await Promise.all([
    env.R2.get(referenceR2Key),
    env.R2.get(generatedR2Key),
  ]);
  if (!refObj || !genObj) return { error: "missing R2 object" };

  const [refBytes, genBytes] = await Promise.all([refObj.arrayBuffer(), genObj.arrayBuffer()]);
  const refMime = refObj.httpMetadata?.contentType ?? "image/png";
  const genMime = genObj.httpMetadata?.contentType ?? "image/png";

  const refB64 = arrayBufferToBase64(refBytes);
  const genB64 = arrayBufferToBase64(genBytes);

  const deriver = getDeriver(ctx.kind);
  const checklist = deriver.visionChecklist
    .map((q, i) => `  ${i + 1}. ${q}`)
    .join("\n");

  const systemPrompt = [
    "You are a strict product-photo auditor. Compare the GENERATED image",
    "to the REFERENCE image and answer the checklist with strict yes/no",
    "judgments. The generated image should be visually identical to the",
    "reference in identity (color, pattern, hardware, layout) — only the",
    "framing, crop, or background may differ. Return JSON only.",
  ].join(" ");

  const userText = [
    `Product: ${ctx.productName} (kind=${ctx.kind}, category=${ctx.category}).`,
    `Checklist (each item is yes/no):`,
    checklist,
    "",
    "Return JSON with this shape (no prose, no code fences):",
    `{`,
    `  "verdict": "pass" | "fail",`,
    `  "details": { "1": true|false, "2": true|false, ... },`,
    `  "reasons": ["short failure reason", ...]`,
    `}`,
    "",
    `Verdict is "pass" only if ALL checklist items are true. Reasons should`,
    `cite specific differences (e.g. "stitching pattern shows X-cross instead`,
    `of straight"); avoid vague language like "doesn't look right".`,
  ].join("\n");

  const body = {
    model: "claude-opus-4-7",
    max_tokens: 600,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "REFERENCE:" },
          {
            type: "image",
            source: { type: "base64", media_type: refMime, data: refB64 },
          },
          { type: "text", text: "GENERATED:" },
          {
            type: "image",
            source: { type: "base64", media_type: genMime, data: genB64 },
          },
          { type: "text", text: userText },
        ],
      },
    ],
  };

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { error: `anthropic ${res.status}: ${text.slice(0, 300)}` };
  }

  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const out = json.content?.find((c) => c.type === "text")?.text ?? "";

  // Strip code fences and parse.
  const cleaned = out
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  let parsed: { verdict?: string; details?: Record<string, boolean>; reasons?: string[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Defensive: vision occasionally returns "fail — reason" prose; map to fail.
    return {
      verdict: { verdict: "fail", reasons: [out.slice(0, 200)], details: {} },
      costCents: VISION_COST_CENTS,
    };
  }

  const verdict: Verdict = {
    verdict: parsed.verdict === "pass" ? "pass" : "fail",
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 6) : [],
    details: parsed.details ?? {},
  };
  return { verdict, costCents: VISION_COST_CENTS };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
