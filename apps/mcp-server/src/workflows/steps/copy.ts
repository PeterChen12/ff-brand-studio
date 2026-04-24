import Anthropic from "@anthropic-ai/sdk";
import type { PlannerOutputType } from "@ff/types";
import type Langfuse from "langfuse";

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
}): Promise<CopyOutput> {
  const client = new Anthropic({ apiKey: params.anthropicKey });
  const trace = params.langfuse.trace({ id: params.traceId });
  const span = trace.span({ name: "copy-writer" });

  const systemPrompt = `You are a senior brand copywriter for Faraday Future, a next-generation electric vehicle company.

Write marketing copy with these rules:
- Tone: aspirational, investor-grade, precise. Never "cheap", "affordable", "budget".
- No exclamation marks. No hyperbole. Facts with emotional resonance.
- LinkedIn: 200-280 words, 2-3 paragraphs, end with a thought-provoking question or insight.
- Weibo: 50-60 words max (EN version, will be translated), premium but accessible.

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
