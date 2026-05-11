/**
 * Phase F · Iter 01 — Golden-master tests for the claims-grounding +
 * auto-rewrite chain.
 *
 * The chain currently lives inline in launch_pipeline.ts (added in
 * phase-e/05). It calls checkClaimsGrounding → if non-GROUNDED, calls
 * rewriteUngroundedCopy → re-grades. F1's migration will replace the
 * inline logic with runQualityGate; these tests pin the contract so the
 * migration can be proven byte-identical.
 *
 * Tests target the lib functions checkClaimsGrounding +
 * rewriteUngroundedCopy directly with the Anthropic SDK mocked. The
 * orchestration around them in launch_pipeline.ts (Promise.all over
 * surfaces, audit-note emission) is mechanical and not snapshot-tested
 * separately.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Anthropic SDK so we can script the judge + rewrite responses.
const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create: createMock };
  },
}));

const { checkClaimsGrounding, rewriteUngroundedCopy } = await import(
  "../../src/lib/claims-grounding.js"
);

const sourceProduct = {
  name: "Cotton T-Shirt",
  description: "100% cotton, machine washable",
  category: "apparel",
};

const groundedCopy = {
  title: "Soft 100% Cotton Tee",
  bullets: ["Machine washable", "Soft hand feel", "Breathable cotton"],
};

const ungroundedCopy = {
  title: "Waterproof Cotton Tee",
  bullets: ["Waterproof to 50m", "Soft hand feel", "Made in USA"],
};

function jsonResponse(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

beforeEach(() => {
  createMock.mockReset();
});

describe("checkClaimsGrounding — golden master", () => {
  it("returns GROUNDED for inferrable claims", async () => {
    createMock.mockResolvedValueOnce(
      jsonResponse({
        rating: "GROUNDED",
        ungrounded_claims: [],
        confidence: 0.95,
      })
    );
    const result = await checkClaimsGrounding({
      source: sourceProduct,
      generated: { surface: "amazon-us", language: "en", copy: groundedCopy },
      anthropicKey: "test",
    });
    expect(result.rating).toBe("GROUNDED");
    expect(result.ungroundedClaims).toEqual([]);
    expect(result.source).toBe("ai");
    expect(result.costCents).toBe(1);
  });

  it("returns UNGROUNDED with flagged claims for fabricated specs", async () => {
    createMock.mockResolvedValueOnce(
      jsonResponse({
        rating: "UNGROUNDED",
        ungrounded_claims: ["waterproof to 50m", "Made in USA"],
        confidence: 0.9,
      })
    );
    const result = await checkClaimsGrounding({
      source: sourceProduct,
      generated: { surface: "amazon-us", language: "en", copy: ungroundedCopy },
      anthropicKey: "test",
    });
    expect(result.rating).toBe("UNGROUNDED");
    expect(result.ungroundedClaims).toEqual(["waterproof to 50m", "Made in USA"]);
  });

  it("falls back to PARTIALLY_GROUNDED with zero cost when no key", async () => {
    const result = await checkClaimsGrounding({
      source: sourceProduct,
      generated: { surface: "amazon-us", language: "en", copy: groundedCopy },
      anthropicKey: undefined,
    });
    expect(result.source).toBe("fallback");
    expect(result.rating).toBe("PARTIALLY_GROUNDED");
    expect(result.costCents).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("falls back when the model returns malformed JSON", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "not json" }],
    });
    const result = await checkClaimsGrounding({
      source: sourceProduct,
      generated: { surface: "amazon-us", language: "en", copy: groundedCopy },
      anthropicKey: "test",
    });
    expect(result.source).toBe("fallback");
    expect(result.rating).toBe("PARTIALLY_GROUNDED");
  });
});

describe("rewriteUngroundedCopy — golden master", () => {
  it("returns a rewritten copy when the model responds with valid JSON", async () => {
    const rewritten = {
      title: "Soft 100% Cotton Tee",
      bullets: ["Machine washable", "Soft hand feel", "Cotton construction"],
    };
    createMock.mockResolvedValueOnce(
      jsonResponse({ copy: rewritten })
    );
    const result = await rewriteUngroundedCopy({
      source: sourceProduct,
      surface: "amazon-us",
      language: "en",
      currentCopy: ungroundedCopy,
      ungroundedClaims: ["waterproof to 50m", "Made in USA"],
      anthropicKey: "test",
    });
    expect(result.source).toBe("ai");
    expect(result.copy).toEqual(rewritten);
    expect(result.costCents).toBe(2);
  });

  it("returns null when no ungrounded claims to fix", async () => {
    const result = await rewriteUngroundedCopy({
      source: sourceProduct,
      surface: "amazon-us",
      language: "en",
      currentCopy: groundedCopy,
      ungroundedClaims: [],
      anthropicKey: "test",
    });
    expect(result.copy).toBeNull();
    expect(result.costCents).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("falls back when no anthropic key", async () => {
    const result = await rewriteUngroundedCopy({
      source: sourceProduct,
      surface: "amazon-us",
      language: "en",
      currentCopy: ungroundedCopy,
      ungroundedClaims: ["waterproof to 50m"],
      anthropicKey: undefined,
    });
    expect(result.copy).toBeNull();
    expect(result.source).toBe("fallback");
    expect(result.costCents).toBe(0);
  });

  it("falls back when model returns invalid copy shape", async () => {
    createMock.mockResolvedValueOnce(
      jsonResponse({ copy: "not an object" })
    );
    const result = await rewriteUngroundedCopy({
      source: sourceProduct,
      surface: "amazon-us",
      language: "en",
      currentCopy: ungroundedCopy,
      ungroundedClaims: ["waterproof to 50m"],
      anthropicKey: "test",
    });
    expect(result.copy).toBeNull();
    expect(result.source).toBe("fallback");
    expect(result.costCents).toBe(2); // cost still incurred — the call was made
  });
});
