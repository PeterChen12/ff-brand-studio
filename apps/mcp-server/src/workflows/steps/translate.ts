import Anthropic from "@anthropic-ai/sdk";
import type { CopyOutput } from "./copy.js";
import type Langfuse from "langfuse";

export interface TranslateOutput {
  linkedin_post_zh: string;
  weibo_post_zh: string;
}

const ZH_SYSTEM_PROMPT = `你是法拉第未来品牌的双语营销文案专家。将英文营销内容转译为高质量中文，如同母语为中文的资深营销人。

规则：
- 绝对禁止：便宜、实惠、折扣、优惠等词汇
- 不使用感叹号
- 保留技术术语原文：FF91、FF81、FF71、FFID、FARADAY FUTURE、aiHyper
- 领英帖子：正式书面语，面向投资者，结构完整
- 微博帖子：精炼有力，不超过140字，保留品质感

返回 JSON 格式：{ "linkedin_post_zh": "...", "weibo_post_zh": "..." }
不添加任何解释，只输出 JSON。`;

export async function translateStep(params: {
  copyOutput: CopyOutput;
  anthropicKey: string;
  langfuse: Langfuse;
  traceId: string;
}): Promise<TranslateOutput> {
  const client = new Anthropic({ apiKey: params.anthropicKey });
  const trace = params.langfuse.trace({ id: params.traceId });
  const span = trace.span({ name: "zh-translator" });

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: ZH_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `LinkedIn帖子（英文）:\n${params.copyOutput.linkedin_post_en}\n\n微博帖子（英文）:\n${params.copyOutput.weibo_post_en}\n\n请翻译两个帖子，返回JSON。`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text.trim() : "{}";

  span.end({ output: text.slice(0, 300) });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      linkedin_post_zh: "[Translation pending — JSON parse failed]",
      weibo_post_zh: "[Translation pending]",
    };
  }

  const parsed = JSON.parse(jsonMatch[0]) as TranslateOutput;
  return {
    linkedin_post_zh: parsed.linkedin_post_zh ?? "",
    weibo_post_zh: parsed.weibo_post_zh ?? "",
  };
}
