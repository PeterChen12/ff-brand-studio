import { generateVideo, pollVideo } from "@ff/media-clients/fal";
import type { GeneratedAssetType } from "@ff/types";
import type Langfuse from "langfuse";

export interface VideoStepOutput {
  videoAsset: GeneratedAssetType | null;
  timedOut: boolean;
}

const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 18; // 90 seconds total

export async function videoStep(params: {
  visualBrief: string;
  heroImageUrl?: string;
  r2PublicUrl: string;
  falKey: string;
  langfuse: Langfuse;
  traceId: string;
}): Promise<VideoStepOutput> {
  const trace = params.langfuse.trace({ id: params.traceId });
  const span = trace.span({ name: "video-generator" });

  const videoPrompt = `Cinematic reveal of a Faraday Future electric vehicle. ${params.visualBrief}. Luxury automotive advertisement, slow motion, dramatic lighting, no text overlays.`;

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

    // Timeout
    return { videoAsset: null, timedOut: true };
  } catch (err) {
    span.end({ output: `Video failed: ${String(err)}` });
    return { videoAsset: null, timedOut: false };
  }
}
