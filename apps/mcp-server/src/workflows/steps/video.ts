import { generateVideo, pollVideo } from "@ff/media-clients/fal";
import type { GeneratedAssetType } from "@ff/types";
import type Langfuse from "langfuse";
import {
  type BrandProfile,
  FF_DEFAULT_PROFILE,
  resolveBrandProfile,
} from "../../lib/brand-profile.js";

export interface VideoStepOutput {
  videoAsset: GeneratedAssetType | null;
  timedOut: boolean;
}

const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 18; // 90 seconds total

// Phase 1 P1.5 — video prompt no longer hardcodes "Faraday Future
// electric vehicle". The brand context comes from the tenant's
// brand_profile so a fishing rod tenant gets a fishing-rod video,
// not a car commercial.

export async function videoStep(params: {
  visualBrief: string;
  heroImageUrl?: string;
  r2PublicUrl: string;
  falKey: string;
  langfuse: Langfuse;
  traceId: string;
  /** Per-tenant brand profile. Falls back to FF default. */
  brandProfile?: BrandProfile | unknown;
}): Promise<VideoStepOutput> {
  const trace = params.langfuse.trace({ id: params.traceId });
  const span = trace.span({ name: "video-generator" });

  const profile: BrandProfile = params.brandProfile
    ? resolveBrandProfile(params.brandProfile)
    : FF_DEFAULT_PROFILE;
  const tone = profile.tone.descriptors.slice(0, 2).join(", ");
  const videoPrompt = `Cinematic reveal of a ${profile.name} product. ${params.visualBrief}. ${tone} brand advertisement, slow motion, dramatic lighting, no text overlays.`;

  try {
    const { jobId } = await generateVideo({
      prompt: videoPrompt,
      imageUrl: params.heroImageUrl,
      falKey: params.falKey,
    });

    span.end({ output: `Job submitted: ${jobId}` });

    // Poll for completion
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const result = await pollVideo(jobId, params.falKey);
      if (result) {
        const key = `videos/${Date.now()}.mp4`;
        return {
          videoAsset: {
            r2_key: key,
            image_url: result.url,
            asset_type: "video",
          },
          timedOut: false,
        };
      }
    }

    // Timeout — Phase 4 P4.6 / I3 — bubble this up as a distinct
    // signal so the orchestrator can mark the asset HITL-required.
    return { videoAsset: null, timedOut: true };
  } catch (err) {
    span.end({ output: `Video failed: ${String(err)}` });
    return { videoAsset: null, timedOut: false };
  }
}
