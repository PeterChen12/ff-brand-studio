import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Anthropic from "@anthropic-ai/sdk";
import { LocalizeToZhInput } from "@ff/types";

const TECHNICAL_TERMS = [
  "FF91",
  "FF81",
  "FF71",
  "FF Super One",
  "FFID",
  "FARADAY FUTURE",
  "aiHyper",
  "Emotion Internet of Vehicle",
  "EIoV",
  "SPS",
  "APF",
];

const PLATFORM_RULES: Record<string, string> = {
  linkedin:
    "领英 (LinkedIn) — 使用正式书面语，专业精准，长度可达280字，适合投资者和商业受众",
  weibo:
    "微博 (Weibo) — 口语化但不失品质感，严格限制140字以内，可适当使用话题标签",
  wechat:
    "微信公众号 (WeChat) — 权威文章风格，结构清晰，适合深度内容",
  xiaohongshu:
    "小红书 (Xiaohongshu) — 真实生活化，略带情感，不过度使用emoji",
};

const SYSTEM_PROMPT = `你是法拉第未来（Faraday Future）品牌的双语营销文案专家。你的任务是将英文营销内容转译为高质量中文，写作风格如同母语为中文的资深营销人，而非机器翻译。

品牌声音：
- 格调高端、精准、具前瞻性，面向投资者和高净值客户
- 绝对禁止使用：便宜、实惠、折扣、优惠、低价等词汇
- 不使用感叹号
- 传达：科技革命、未来愿景、高端奢华

技术术语保留规则（以下词汇保持原文或约定中译）：
${TECHNICAL_TERMS.map((t) => `- "${t}" → 保持英文大写原样`).join("\n")}

平台规则：
${Object.entries(PLATFORM_RULES)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}

输出要求：
- 只输出译文内容，不添加任何解释或说明
- 确保中英文传达完全一致的核心信息
- 语言自然流畅，符合中国高端商业读者的阅读习惯`;

const REVIEW_PROMPT = `你是一位资深的中文营销总监，专注于高端科技品牌。请以母语人士的眼光，审查以下法拉第未来品牌的中文文案：

审查维度：
1. 是否自然流畅，无翻译腔
2. 是否符合目标平台语境
3. 品牌调性是否到位（高端、科技感、前瞻性）
4. 技术术语是否正确保留

如译文通过审查，直接输出最终版本（可做细微优化）。
如有重大问题，输出修订版并在末尾简短说明修改原因（一行）。`;

export function registerLocalizeToZh(
  server: McpServer,
  env: CloudflareBindings
): void {
  server.tool(
    "localize_to_zh",
    "Translate and localize EN marketing copy to ZH using Claude Sonnet with native Chinese marketing voice",
    LocalizeToZhInput.shape,
    async (params) => {
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      const platformRule = PLATFORM_RULES[params.platform] ?? "";

      // Pass 1: Translate
      const translateResponse = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `平台：${params.platform}\n${platformRule}\n\n请将以下内容翻译为中文：\n\n${params.content_en}`,
          },
        ],
      });

      const translation =
        translateResponse.content[0].type === "text"
          ? translateResponse.content[0].text.trim()
          : "";

      // Pass 2: Review with native editor persona
      const reviewResponse = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: REVIEW_PROMPT,
        messages: [
          {
            role: "user",
            content: `平台：${params.platform}\n原文（英文）：${params.content_en}\n\n待审查译文：\n${translation}`,
          },
        ],
      });

      const reviewed =
        reviewResponse.content[0].type === "text"
          ? reviewResponse.content[0].text.trim()
          : translation;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              translation_v1: translation,
              translation_reviewed: reviewed,
              platform: params.platform,
              source_length: params.content_en.length,
              output_length: reviewed.length,
            }),
          },
        ],
      };
    }
  );
}
