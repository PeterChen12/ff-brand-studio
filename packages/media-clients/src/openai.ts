import OpenAI from "openai";

export interface BilingualInfographicParams {
  prompt: string;
  size: "1024x1024" | "1536x1024" | "1024x1536";
  apiKey: string;
}

export interface BilingualInfographicResult {
  b64: string;
}

export async function generateBilingualInfographic(
  params: BilingualInfographicParams
): Promise<BilingualInfographicResult> {
  const client = new OpenAI({ apiKey: params.apiKey });

  const response = await client.images.generate({
    model: "gpt-image-2",
    prompt: params.prompt,
    size: params.size,
    quality: "high",
    response_format: "b64_json",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("GPT Image 2 returned no image data");
  }

  return { b64 };
}
