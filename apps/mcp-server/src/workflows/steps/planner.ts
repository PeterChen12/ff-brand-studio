import Anthropic from "@anthropic-ai/sdk";
import type { PlannerOutputType } from "@ff/types";
import { PlannerOutput } from "@ff/types";
import type Langfuse from "langfuse";

// Inline prompt — Cloudflare Workers has no filesystem access
const SYSTEM_PROMPT = `You are the FF Brand Strategist. Given raw source text (investor update, press release, or creative brief), extract exactly three key points suitable for a bilingual marketing campaign targeting investors and luxury EV buyers.

For each key point, output a JSON object with these exact fields:
- "headline_en": ≤8 words, active voice, no exclamation marks
- "headline_zh": ≤12 characters, concise and impactful
- "body_en": ≤40 words, investor-grade tone, precise facts
- "body_zh": ≤60 characters, natural Chinese marketing voice
- "visual_brief": one sentence describing the ideal hero image for this point

Also output:
- "linkedin_draft_en": ≤280 words, 2-3 paragraphs, investor-grade, professional, no exclamation marks, up to 3 hashtags
- "weibo_draft_en": ≤60 words (will be translated to ZH), conversational but premium, no exclamation marks

Return ONLY a valid JSON object with this exact structure:
{
  "key_points": [
    { "headline_en": "...", "headline_zh": "...", "body_en": "...", "body_zh": "...", "visual_brief": "..." },
    { "headline_en": "...", "headline_zh": "...", "body_en": "...", "body_zh": "...", "visual_brief": "..." },
    { "headline_en": "...", "headline_zh": "...", "body_en": "...", "body_zh": "...", "visual_brief": "..." }
  ],
  "linkedin_draft_en": "...",
  "weibo_draft_en": "..."
}

No prose outside the JSON. No markdown code blocks. Pure JSON only.`;

export async function plannerStep(params: {
  sourceText: string;
  anthropicKey: string;
  langfuse: Langfuse;
  traceId: string;
}): Promise<PlannerOutputType> {
  const client = new Anthropic({ apiKey: params.anthropicKey });
  const trace = params.langfuse.trace({ id: params.traceId, name: "campaign" });
  const span = trace.span({ name: "planner" });

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Extract 3 key points and draft posts from this content:\n\n${params.sourceText}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text.trim() : "{}";

  span.end({ output: text.slice(0, 500) });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Planner did not return valid JSON");
  }

  return PlannerOutput.parse(JSON.parse(jsonMatch[0]));
}
