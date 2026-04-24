/* eslint-disable @typescript-eslint/no-explicit-any */
import { fal } from "@fal-ai/client";

export interface HeroImageParams {
  prompt: string;
  aspectRatio: "16:9" | "1:1" | "9:16" | "4:5";
  falKey: string;
}

export interface HeroImageResult {
  url: string;
  seed: number;
}

const ASPECT_TO_SIZE: Record<string, string> = {
  "16:9": "landscape_16_9",
  "1:1": "square",
  "9:16": "portrait_16_9",
  "4:5": "portrait_4_5",
};

export async function generateHeroImage(
  params: HeroImageParams
): Promise<HeroImageResult> {
  fal.config({ credentials: params.falKey });

  // fal SDK input types are overly strict — use any cast to pass image_size
  const input: any = {
    prompt: params.prompt,
    image_size: ASPECT_TO_SIZE[params.aspectRatio] ?? "landscape_16_9",
    safety_tolerance: "2",
    output_format: "jpeg",
  };

  const result = await fal.subscribe("fal-ai/flux-pro/v1.1", { input });

  const data = result.data as {
    images: Array<{ url: string }>;
    seed: number;
  };

  return {
    url: data.images[0]?.url ?? "",
    seed: data.seed ?? 0,
  };
}

export interface VideoParams {
  prompt: string;
  imageUrl?: string;
  falKey: string;
}

export interface VideoJobResult {
  jobId: string;
}

export interface VideoResult {
  url: string;
}

export async function generateVideo(params: VideoParams): Promise<VideoJobResult> {
  fal.config({ credentials: params.falKey });

  const input: any = {
    prompt: params.prompt,
    image_url: params.imageUrl,
    duration: "5",
    aspect_ratio: "16:9",
  };

  const result = await fal.queue.submit("fal-ai/kling-video/v2.1/pro/image-to-video", {
    input,
  });

  return { jobId: result.request_id };
}

export async function pollVideo(
  jobId: string,
  falKey: string
): Promise<VideoResult | null> {
  fal.config({ credentials: falKey });

  const status = await fal.queue.status("fal-ai/kling-video/v2.1/pro/image-to-video", {
    requestId: jobId,
    logs: false,
  });

  if (status.status === "COMPLETED") {
    const result = await fal.queue.result(
      "fal-ai/kling-video/v2.1/pro/image-to-video",
      { requestId: jobId }
    );
    const data = result.data as { video: { url: string } };
    return { url: data.video.url };
  }

  return null;
}
