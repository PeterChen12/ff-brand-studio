import Anthropic from "@anthropic-ai/sdk";
import type { PlannerOutputType } from "@ff/types";
import type Langfuse from "langfuse";
import {
  type BrandProfile,
  FF_DEFAULT_PROFILE,
  resolveBrandProfile,
} from "../../lib/brand-profile.js";

export interface CopyOutput {
  linkedin_post_en: string;
  weibo_post_en: string;
}

export async function copyStep(params: {
  plannerOutput: PlannerOutputType;
  platforms: string[];
  anthropicKey: string;
  langfuse: Langfuse;
  traceId: string;
  /** Per-tenant brand voice. Falls back to FF default. */
  brandProfile?: BrandProfile | unknown;
}): Promise<CopyOutput> {
  const client = new Anthropic({ apiKey: params.anthropicKey });
  const trace = params.langfuse.trace({ id: params.traceId });
  const span = trace.span({ name: "copy-writer" });

  // Phase 1 P1.6 — copywriter prompt no longer hardcodes "Faraday
  // Future" or "investor-grade" tone. Renders from brand_profile.tone
  // so a fishing-rod tenant gets fishing-rod copy.
  const profile: BrandProfile = params.brandProfile
    ? resolveBrandProfile(params.brandProfile)
    : FF_DEFAULT_PROFILE;
  const toneDescriptors = profile.tone.descriptors.slice(0, 3).join(", ");
  const forbidden = profile.tone.forbidden.join('", "');
  const exclamRule =
    profile.tone.punctuation?.exclamations_allowed === false
      ? "No exclamation marks."
      : "Exclamation marks allowed in moderation.";

  const systemPrompt = `You are a senior brand copywriter for ${profile.name}.

Write marketing copy with these rules:
- Tone: ${toneDescriptors}. Never "${forbidden}".
- ${exclamRule} No hyperbole. Facts with emotional resonance.
- LinkedIn: 200-280 words, 2-3 paragraphs, end with a thought-provoking question or insight.
- Weibo: 50-60 words max (EN version, will be translated), brand-aligned tone but accessible.

Return JSON only:
{ "linkedin_post_en": "...", "weibo_post_en": "..." }`;

  const keyPointsSummary = params.plannerOutput.key_points
    .map((p, i) => `${i + 1}. ${p.headline_en}: ${p.body_en}`)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Key points:\n${keyPointsSummary}\n\nDraft posts:\nLinkedIn (draft): ${params.plannerOutput.linkedin_draft_en}\nWeibo (draft): ${params.plannerOutput.weibo_draft_en}\n\nRefine and finalize both posts. Return JSON only.`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text.trim() : "{}";

  span.end({ output: text.slice(0, 300) });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Fallback to planner drafts if JSON parse fails
    return {
      linkedin_post_en: params.plannerOutput.linkedin_draft_en,
      weibo_post_en: params.plannerOutput.weibo_draft_en,
    };
  }

  const parsed = JSON.parse(jsonMatch[0]) as CopyOutput;
  return {
    linkedin_post_en: parsed.linkedin_post_en ?? params.plannerOutput.linkedin_draft_en,
    weibo_post_en: parsed.weibo_post_en ?? params.plannerOutput.weibo_draft_en,
  };
}
