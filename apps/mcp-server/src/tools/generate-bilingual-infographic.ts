import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GenerateBilingualInfographicInput } from "@ff/types";
import { generateBilingualInfographic } from "@ff/media-clients/openai";
import { uploadBase64ToR2 } from "@ff/media-clients/r2";

export function registerGenerateBilingualInfographic(
  server: McpServer,
  env: CloudflareBindings
): void {
  server.tool(
    "generate_bilingual_infographic",
    "Generate a bilingual EN/ZH infographic using GPT Image 2 with FF brand typography",
    GenerateBilingualInfographicInput.shape,
    async (params) => {
      const pointsText = params.points
        .map(
          (p, i) =>
            `Point ${i + 1}: English: "${p.en}" | Chinese: "${p.zh}"`
        )
        .join("\n");

      const prompt = `Create a professional corporate infographic with this EXACT layout specification:

BACKGROUND: Deep navy gradient from #0A0A0A (top) to #1C3FAA (bottom), covering the full image.

TITLE BLOCK (top 20% of image):
- English title: "${params.title_en}" — bold Inter or Helvetica Neue, 48px, pure white #FFFFFF
- Chinese title: "${params.title_zh}" — Source Han Sans SC or PingFang SC, 32px, electric blue #00A8E8, centered below English

CONTENT BLOCKS (evenly distributed, 20-75% of image height):
${pointsText}
Each block: round numbered badge on left (white circle, navy number), English text white #FFFFFF 16px, Chinese text #00A8E8 13px below.

FOOTER (bottom 8%):
- Thin gold accent line #C9A84C spanning full width, 3px height
- "FARADAY FUTURE" wordmark in small white caps, centered

STYLE RULES:
- NO photographic imagery, NO gradients on text blocks
- Clean corporate layout, generous white space
- All text perfectly legible, high contrast
- Template style: ${params.template}`;

      const { b64 } = await generateBilingualInfographic({
        prompt,
        size: "1024x1024",
        apiKey: env.OPENAI_API_KEY,
      });

      const key = `infographics/${Date.now()}.png`;
      const { publicUrl } = await uploadBase64ToR2(
        env.R2,
        key,
        b64,
        "image/png",
        env.R2_PUBLIC_URL
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              r2_key: key,
              image_url: publicUrl,
              title_en: params.title_en,
              title_zh: params.title_zh,
              points_count: params.points.length,
              prompt_used: prompt.slice(0, 200) + "...",
            }),
          },
        ],
      };
    }
  );
}
