import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GenerateBrandHeroInput } from "@ff/types";
import { generateHeroImage } from "@ff/media-clients/fal";
import { uploadToR2 } from "@ff/media-clients/r2";

export function registerGenerateBrandHero(
  server: McpServer,
  env: CloudflareBindings
): void {
  server.tool(
    "generate_brand_hero",
    "Generate a photoreal hero image for Faraday Future marketing using Flux Pro",
    GenerateBrandHeroInput.shape,
    async (params) => {
      const vehicleContext = params.vehicle_model
        ? `Faraday Future ${params.vehicle_model} electric vehicle, `
        : "Faraday Future electric vehicle, ";

      const moodMap = {
        luxury: "ultra-luxury automotive photography, cinematic lighting, dark moody atmosphere",
        tech: "futuristic technology showcase, blue electric accents, high-tech environment",
        lifestyle: "aspirational lifestyle photography, premium urban setting, dawn golden hour",
        dramatic: "dramatic automotive hero shot, storm clouds, powerful perspective",
      };

      const prompt = [
        vehicleContext,
        params.prompt_en,
        moodMap[params.mood],
        "deep navy #1C3FAA color story",
        "photorealistic, 8K quality, no text overlay, no watermarks",
        "professional automotive photography",
      ].join(". ");

      const { url, seed } = await generateHeroImage({
        prompt,
        aspectRatio: params.aspect_ratio,
        falKey: env.FAL_KEY,
      });

      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const key = `heroes/${Date.now()}-${seed}.jpg`;
      const { publicUrl } = await uploadToR2(
        env.R2,
        key,
        buffer,
        "image/jpeg",
        env.R2_PUBLIC_URL
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              r2_key: key,
              image_url: publicUrl,
              seed,
              prompt,
              vehicle_model: params.vehicle_model ?? "unspecified",
              mood: params.mood,
              aspect_ratio: params.aspect_ratio,
            }),
          },
        ],
      };
    }
  );
}
