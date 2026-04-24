import { generateHeroImage } from "@ff/media-clients/fal";
import { generateBilingualInfographic } from "@ff/media-clients/openai";
import { uploadToR2, uploadBase64ToR2 } from "@ff/media-clients/r2";
import type { GeneratedAssetType, PlannerOutputType } from "@ff/types";
import type Langfuse from "langfuse";

export interface ImageStepOutput {
  assets: GeneratedAssetType[];
}

export async function imageStep(params: {
  plannerOutput: PlannerOutputType;
  includeInfographic: boolean;
  r2Bucket: R2Bucket;
  r2PublicUrl: string;
  falKey: string;
  openaiKey: string;
  langfuse: Langfuse;
  traceId: string;
}): Promise<ImageStepOutput> {
  const trace = params.langfuse.trace({ id: params.traceId });
  const span = trace.span({ name: "image-generator" });
  const assets: GeneratedAssetType[] = [];

  // Hero image — use first key point's visual brief
  const heroBrief = params.plannerOutput.key_points[0]?.visual_brief ?? "Faraday Future FF91 luxury electric vehicle";
  const heroPrompt = `Faraday Future electric vehicle. ${heroBrief}. Ultra-luxury automotive photography, cinematic lighting, dark moody atmosphere, deep navy #1C3FAA color story. Photorealistic, 8K quality, no text overlay, professional automotive photography.`;

  try {
    const hero = await generateHeroImage({
      prompt: heroPrompt,
      aspectRatio: "16:9",
      falKey: params.falKey,
    });

    const heroResponse = await fetch(hero.url);
    const heroBuffer = await heroResponse.arrayBuffer();
    const heroKey = `heroes/${Date.now()}-${hero.seed}.jpg`;
    const { publicUrl: heroPublicUrl } = await uploadToR2(
      params.r2Bucket,
      heroKey,
      heroBuffer,
      "image/jpeg",
      params.r2PublicUrl
    );

    assets.push({
      r2_key: heroKey,
      image_url: heroPublicUrl,
      asset_type: "hero_image",
    });
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
    console.error("[imageStep] Hero image failed:", msg);
    span.end({ output: `Hero image failed: ${msg}` });
  }

  // Bilingual infographic
  if (params.includeInfographic && params.plannerOutput.key_points.length >= 3) {
    const points = params.plannerOutput.key_points.slice(0, 3).map((p) => ({
      en: p.headline_en,
      zh: p.headline_zh,
    }));

    const infographicPrompt = `Create a professional corporate infographic.
BACKGROUND: Deep navy gradient from #0A0A0A to #1C3FAA.
TITLE: English "Key Insights" in bold white 48px, Chinese "核心要点" in #00A8E8 32px below.
CONTENT BLOCKS:
${points.map((p, i) => `Point ${i + 1}: English: "${p.en}" | Chinese: "${p.zh}"`).join("\n")}
Each block: numbered badge, white English text, #00A8E8 Chinese below.
FOOTER: Gold accent line #C9A84C, "FARADAY FUTURE" wordmark in small white caps.
Clean corporate layout, no stock imagery, all text legible.`;

    try {
      const infographic = await generateBilingualInfographic({
        prompt: infographicPrompt,
        size: "1024x1024",
        apiKey: params.openaiKey,
      });

      const infoKey = `infographics/${Date.now()}.png`;
      const { publicUrl: infoPublicUrl } = await uploadBase64ToR2(
        params.r2Bucket,
        infoKey,
        infographic.b64,
        "image/png",
        params.r2PublicUrl
      );

      assets.push({
        r2_key: infoKey,
        image_url: infoPublicUrl,
        asset_type: "infographic",
      });
    } catch (err) {
      const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
      console.error("[imageStep] Infographic failed:", msg);
      span.end({ output: `Infographic failed: ${msg}` });
    }
  }

  span.end({ output: `Generated ${assets.length} assets` });
  return { assets };
}
