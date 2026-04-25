import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Vision scorer unit tests — never call the real Anthropic API or fetch a real
 * image. Both are stubbed so the test runs in CI for free.
 */

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9AwAAAABJRU5ErkJggg==";

const baseAnthropicResp = {
  content: [
    {
      type: "text",
      text: JSON.stringify({
        rating: "EXCELLENT",
        issues: [],
        suggestions: [],
      }),
    },
  ],
  usage: {
    input_tokens: 1500,
    cache_read_input_tokens: 1300,
    output_tokens: 60,
  },
};

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: vi.fn(async () => baseAnthropicResp),
    };
  },
}));

// Import AFTER mock is registered (hoisting handles ordering, but explicit is clearer)
import { visionScoreAmazonMain } from "../../src/compliance/vision_scorer.js";

function fakeFetchOk(): typeof fetch {
  return (async () =>
    new Response(Buffer.from(tinyPngBase64, "base64"), {
      status: 200,
      headers: { "content-type": "image/png" },
    })) as unknown as typeof fetch;
}

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = fakeFetchOk();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("visionScoreAmazonMain", () => {
  it("returns EXCELLENT when the model rates the image clean", async () => {
    const result = await visionScoreAmazonMain({
      asset_url: "https://example.com/test.png",
      api_key: "sk-fake",
    });
    expect(result.rating).toBe("EXCELLENT");
    expect(result.issues).toEqual([]);
    expect(result.cost_cents).toBeGreaterThanOrEqual(0);
  });

  it("returns POOR with vision_error on fetch failure", async () => {
    globalThis.fetch = (async () =>
      new Response("not found", { status: 404 })) as unknown as typeof fetch;

    const result = await visionScoreAmazonMain({
      asset_url: "https://example.com/missing.png",
      api_key: "sk-fake",
    });
    expect(result.rating).toBe("POOR");
    expect(result.issues.some((i) => i.includes("vision scorer api error"))).toBe(true);
    expect(result.metrics.vision_error).toBeDefined();
  });

  it("emits a non-negative cost estimate based on token usage", async () => {
    const result = await visionScoreAmazonMain({
      asset_url: "https://example.com/test.png",
      api_key: "sk-fake",
    });
    expect(result.cost_cents).toBeGreaterThanOrEqual(0);
    expect(result.cost_cents).toBeLessThan(50); // sanity: <$0.50 per call
  });
});
