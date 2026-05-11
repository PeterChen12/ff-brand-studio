/**
 * Phase F · Iter 02 — Unit tests for the BFR adapter.
 *
 * Verifies HMAC signing, envelope shape, and error mapping. fetch is
 * mocked to avoid hitting the real BFR endpoint.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { stageBfrProduct } from "../../src/integrations/buyfishingrod-admin.js";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

const baseEnvelope = {
  external_id: "ext-123",
  external_source: "ff-brand-studio" as const,
  sku: "SKU-A",
  product_id: "p-1",
  variant_id: "v-1",
  name: { en: "Test" },
  images: [
    { slot: "main", r2_url: "https://r2.example/img.jpg", width: 2000, height: 2000, format: "jpg" },
  ],
  staged_at: "2026-05-11T00:00:00.000Z",
};

describe("stageBfrProduct", () => {
  it("POSTs to BFR endpoint with HMAC signature header", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, image_count: 1 }),
    });
    const result = await stageBfrProduct({
      envelope: baseEnvelope,
      signingSecret: "whsec_testtest",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://admin.buyfishingrod.com/api/integrations/ff-brand-studio/stage-product");
    expect(init.method).toBe("POST");
    const sigHeader = (init.headers as Record<string, string>)["x-ff-signature"];
    expect(sigHeader).toMatch(/^t=\d+,v1=[a-f0-9]+$/);
    expect(result.externalListingId).toBe("ext-123");
    expect(result.detail).toEqual({ ok: true, image_count: 1 });
  });

  it("respects baseUrl override", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await stageBfrProduct({
      envelope: baseEnvelope,
      signingSecret: "whsec_a",
      baseUrl: "https://staging.example.com",
    });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://staging.example.com/api/integrations/ff-brand-studio/stage-product");
  });

  it("throws ApiError on BFR 5xx", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => "bad gateway",
    });
    await expect(
      stageBfrProduct({ envelope: baseEnvelope, signingSecret: "whsec_b" })
    ).rejects.toMatchObject({
      status: 502,
      code: "bfr_stage_failed",
    });
  });

  it("succeeds even when BFR returns non-JSON body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error("not json");
      },
    });
    const result = await stageBfrProduct({
      envelope: baseEnvelope,
      signingSecret: "whsec_c",
    });
    expect(result.detail).toEqual({});
  });

  it("computes different signatures for different bodies", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await stageBfrProduct({ envelope: baseEnvelope, signingSecret: "whsec_d" });
    const sig1 = (fetchMock.mock.calls[0][1].headers as Record<string, string>)["x-ff-signature"];
    fetchMock.mockClear();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await stageBfrProduct({
      envelope: { ...baseEnvelope, external_id: "ext-456" },
      signingSecret: "whsec_d",
    });
    const sig2 = (fetchMock.mock.calls[0][1].headers as Record<string, string>)["x-ff-signature"];
    expect(sig1).not.toBe(sig2);
  });
});
