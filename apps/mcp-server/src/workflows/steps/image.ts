import { generateHeroImage } from "@ff/media-clients/fal";
import { generateBilingualInfographic } from "@ff/media-clients/openai";
import { uploadToR2, uploadBase64ToR2 } from "@ff/media-clients/r2";
import type { GeneratedAssetType, PlannerOutputType } from "@ff/types";
import type Langfuse from "langfuse";
import {
  type BrandProfile,
  FF_DEFAULT_PROFILE,
  brandWordmark,
  formatProfileForImagePrompt,
  resolveBrandProfile,
} from "../../lib/brand-profile.js";

export interface ImageStepOutput {
  assets: GeneratedAssetType[];
}

// Phase 1 P1.3 / P1.4 — hero + infographic prompts no longer hardcode
// "Faraday Future FF91 luxury electric vehicle" or the navy/gold
// palette. Both render from the tenant's brand_profile (or FF default
// for legacy callers that don't pass one). See lib/brand-profile.ts.

export async function imageStep(params: {
  plannerOutput: PlannerOutputType;
  includeInfographic: boolean;
  r2Bucket: R2Bucket;
  r2PublicUrl: string;
  falKey: string;
  openaiKey: string;
  langfuse: Langfuse;
  traceId: string;
  /** Per-tenant brand profile. Falls back to FF default if omitted. */
  brandProfile?: BrandProfile | unknown;
}): Promise<ImageStepOutput> {
  const trace = params.langfuse.trace({ id: params.traceId });
  const span = trace.span({ name: "image-generator" });
  const assets: GeneratedAssetType[] = [];

  const profile: BrandProfile = params.brandProfile
    ? resolveBrandProfile(params.brandProfile)
    : FF_DEFAULT_PROFILE;
  const brandContext = formatProfileForImagePrompt(profile);

  // Hero image — use first key point's visual brief. Fallback brief is
  // now derived from the brand name + tone rather than hardcoded to FF.
  const heroBrief =
    params.plannerOutput.key_points[0]?.visual_brief ??
    `${profile.name} hero product photography, ${profile.tone.descriptors.slice(0, 2).join(", ")}`;
  const primaryHex = profile.palette.primary.hex;
  const heroPrompt = `${brandContext} ${heroBrief}. Studio-grade product photography, cinematic lighting, brand-aligned color story (anchor on ${primaryHex}). Photorealistic, 8K quality, no text overlay, professional photography.`;

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

    const neutral = profile.palette.neutrals?.[0]?.hex ?? "#0A0A0A";
    const accent = profile.palette.accent?.hex ?? profile.palette.primary.hex;
    const secondary = profile.palette.secondary?.hex ?? profile.palette.primary.hex;
    const wordmark = brandWordmark(profile);

    const infographicPrompt = `Create a professional corporate infographic.
BACKGROUND: Gradient from ${neutral} to ${primaryHex}.
TITLE: English "Key Insights" in bold white 48px, Chinese "核心要点" in ${secondary} 32px below.
CONTENT BLOCKS:
${points.map((p, i) => `Point ${i + 1}: English: "${p.en}" | Chinese: "${p.zh}"`).join("\n")}
Each block: numbered badge, white English text, ${secondary} Chinese below.
FOOTER: Accent line ${accent}, "${wordmark}" wordmark in small white caps.
Clean corporate layout matching ${profile.name} brand standards. No stock imagery, all text legible.`;

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
