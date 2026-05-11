/**
 * Phase F · Iter 06 — Unit tests for checkClaimsGroundingDual.
 *
 * Verifies the three consensus outcomes (unanimous_pass, unanimous_fail,
 * disagreement) and the combined-claims merge.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create: createMock };
  },
}));

const { checkClaimsGroundingDual } = await import(
  "../../src/lib/claims-grounding.js"
);

function jsonResponse(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

const baseArgs = {
  source: { name: "Cotton T-Shirt", description: "100% cotton, machine washable", category: "apparel" },
  generated: {
    surface: "amazon-us",
    language: "en",
    copy: { title: "Cotton Tee", bullets: ["Soft", "Washable"] },
  },
  anthropicKey: "test",
};

beforeEach(() => createMock.mockReset());

describe("checkClaimsGroundingDual", () => {
  it("unanimous_pass when both judges return GROUNDED", async () => {
    createMock
      .mockResolvedValueOnce(jsonResponse({ rating: "GROUNDED", ungrounded_claims: [], confidence: 0.9 }))
      .mockResolvedValueOnce(jsonResponse({ rating: "GROUNDED", ungrounded_claims: [], confidence: 0.95 }));
    const result = await checkClaimsGroundingDual(baseArgs);
    expect(result.outcome).toBe("unanimous_pass");
    expect(result.combinedUngroundedClaims).toEqual([]);
    expect(result.costCents).toBe(2); // 1¢ × 2 judges
  });

  it("unanimous_fail when both judges return UNGROUNDED", async () => {
    createMock
      .mockResolvedValueOnce(
        jsonResponse({ rating: "UNGROUNDED", ungrounded_claims: ["waterproof"], confidence: 0.9 })
      )
      .mockResolvedValueOnce(
        jsonResponse({ rating: "UNGROUNDED", ungrounded_claims: ["FDA approved"], confidence: 0.9 })
      );
    const result = await checkClaimsGroundingDual(baseArgs);
    expect(result.outcome).toBe("unanimous_fail");
    expect(result.combinedUngroundedClaims).toEqual(
      expect.arrayContaining(["waterproof", "FDA approved"])
    );
  });

  it("disagreement when one passes and one rejects", async () => {
    createMock
      .mockResolvedValueOnce(jsonResponse({ rating: "GROUNDED", ungrounded_claims: [], confidence: 0.85 }))
      .mockResolvedValueOnce(
        jsonResponse({ rating: "UNGROUNDED", ungrounded_claims: ["soft hand feel"], confidence: 0.8 })
      );
    const result = await checkClaimsGroundingDual(baseArgs);
    expect(result.outcome).toBe("disagreement");
    expect(result.combinedUngroundedClaims).toEqual(["soft hand feel"]);
    // Both judges' costs counted regardless of outcome.
    expect(result.costCents).toBe(2);
  });

  it("dedups claims across both judges", async () => {
    createMock
      .mockResolvedValueOnce(
        jsonResponse({ rating: "UNGROUNDED", ungrounded_claims: ["waterproof", "shared-claim"], confidence: 0.9 })
      )
      .mockResolvedValueOnce(
        jsonResponse({ rating: "UNGROUNDED", ungrounded_claims: ["FDA approved", "shared-claim"], confidence: 0.9 })
      );
    const result = await checkClaimsGroundingDual(baseArgs);
    expect(result.combinedUngroundedClaims).toHaveLength(3);
    expect(result.combinedUngroundedClaims).toEqual(
      expect.arrayContaining(["waterproof", "FDA approved", "shared-claim"])
    );
  });

  it("falls back gracefully when no anthropic key", async () => {
    const result = await checkClaimsGroundingDual({
      ...baseArgs,
      anthropicKey: undefined,
    });
    // Both fall back to PARTIALLY_GROUNDED with cost 0; outcome = unanimous_fail.
    expect(result.permissive.source).toBe("fallback");
    expect(result.skeptical.source).toBe("fallback");
    expect(result.outcome).toBe("unanimous_fail");
    expect(result.costCents).toBe(0);
  });
});
