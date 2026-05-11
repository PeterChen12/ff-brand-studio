/**
 * Phase F · Iter 08 — Unit tests for the agentic folder classifier.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create: createMock };
  },
}));

const { classifyFolderContents } = await import(
  "../../src/lib/agentic-folder-classifier.js"
);

function jsonResponse(payload: Record<string, unknown>) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

const sampleFiles = [
  { path: "Batch/sku-001/hero.jpg", kind: "image" as const, r2_key: "stage/001/hero.jpg" },
  { path: "Batch/sku-001/side.jpg", kind: "image" as const, r2_key: "stage/001/side.jpg" },
  { path: "Batch/sku-002/hero.jpg", kind: "image" as const, r2_key: "stage/002/hero.jpg" },
];

beforeEach(() => createMock.mockReset());

describe("classifyFolderContents", () => {
  it("returns parsed manifest on valid Sonnet response", async () => {
    createMock.mockResolvedValueOnce(
      jsonResponse({
        products: [
          {
            name: "SKU 001",
            description: "first product",
            references: ["stage/001/hero.jpg", "stage/001/side.jpg"],
            confidence: 0.9,
          },
          {
            name: "SKU 002",
            references: ["stage/002/hero.jpg"],
            confidence: 0.6,
            reason: "only one image",
          },
        ],
        unassigned: [],
      })
    );
    const result = await classifyFolderContents({
      files: sampleFiles,
      anthropicKey: "test",
    });
    expect(result.products).toHaveLength(2);
    expect(result.products[0].name).toBe("SKU 001");
    expect(result.products[0].references).toHaveLength(2);
    expect(result.products[1].confidence).toBe(0.6);
    expect(result.products[1].reason).toBe("only one image");
    expect(result.cost_cents).toBe(5);
  });

  it("returns empty manifest with all files unassigned when no key", async () => {
    const result = await classifyFolderContents({
      files: sampleFiles,
      anthropicKey: undefined,
    });
    expect(result.products).toEqual([]);
    expect(result.unassigned).toHaveLength(3);
    expect(result.unassigned[0].reason).toMatch(/classifier unavailable/);
    expect(result.cost_cents).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns unassigned on malformed JSON response", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "not json at all" }],
    });
    const result = await classifyFolderContents({
      files: sampleFiles,
      anthropicKey: "test",
    });
    expect(result.products).toEqual([]);
    expect(result.unassigned).toHaveLength(3);
    expect(result.unassigned[0].reason).toMatch(/non-JSON/);
  });

  it("filters out products with zero references", async () => {
    createMock.mockResolvedValueOnce(
      jsonResponse({
        products: [
          { name: "Empty", references: [], confidence: 0.9 },
          { name: "Valid", references: ["stage/001/hero.jpg"], confidence: 0.8 },
        ],
        unassigned: [],
      })
    );
    const result = await classifyFolderContents({
      files: sampleFiles,
      anthropicKey: "test",
    });
    expect(result.products).toHaveLength(1);
    expect(result.products[0].name).toBe("Valid");
  });

  it("clamps confidence to [0,1] and falls back to 0.5 on bad value", async () => {
    createMock.mockResolvedValueOnce(
      jsonResponse({
        products: [
          {
            name: "Out-of-range",
            references: ["stage/001/hero.jpg"],
            confidence: 2.5,
          },
        ],
        unassigned: [],
      })
    );
    const result = await classifyFolderContents({
      files: sampleFiles,
      anthropicKey: "test",
    });
    expect(result.products[0].confidence).toBe(0.5);
  });

  it("returns empty result when files list is empty", async () => {
    const result = await classifyFolderContents({
      files: [],
      anthropicKey: "test",
    });
    expect(result.products).toEqual([]);
    expect(result.unassigned).toEqual([]);
    expect(createMock).not.toHaveBeenCalled();
  });
});
