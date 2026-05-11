import { describe, expect, it } from "vitest";
import { DERIVERS, getDeriver } from "../../src/pipeline/derivers/index.js";

const KINDS = [
  "long_thin_vertical",
  "long_thin_horizontal",
  "compact_square",
  "compact_round",
  "horizontal_thin",
  "multi_component",
  "apparel_flat",
  "accessory_small",
] as const;

describe("DERIVERS registry", () => {
  it("covers all 8 Phase I kinds", () => {
    for (const k of KINDS) {
      expect(DERIVERS[k], `missing deriver for ${k}`).toBeDefined();
      expect(DERIVERS[k].kind).toBe(k);
    }
  });

  it("each deriver has a non-empty refine prompt", () => {
    for (const k of KINDS) {
      const prompt = DERIVERS[k].refinePrompt({
        productName: "Test SKU",
        category: "drinkware",
      });
      expect(prompt.length).toBeGreaterThan(80);
      expect(prompt).toContain("Test SKU");
    }
  });

  it("each deriver has a non-empty lifestyle prompt", () => {
    for (const k of KINDS) {
      const prompt = DERIVERS[k].lifestylePrompt({
        productName: "Test SKU",
        category: "drinkware",
      });
      expect(prompt.length).toBeGreaterThan(40);
      expect(prompt.toLowerCase()).toContain("no text");
    }
  });

  it("each deriver bans the universal negatives in the refine prompt", () => {
    for (const k of KINDS) {
      const prompt = DERIVERS[k].refinePrompt({
        productName: "Test SKU",
        category: "drinkware",
      });
      expect(prompt.toLowerCase()).toContain("no text");
      expect(prompt.toLowerCase()).toContain("no logos");
      expect(prompt.toLowerCase()).toContain("no watermarks");
    }
  });

  it("each deriver has a valid clip threshold in [0.5, 1.0]", () => {
    for (const k of KINDS) {
      const t = DERIVERS[k].clipThreshold;
      expect(t).toBeGreaterThanOrEqual(0.5);
      expect(t).toBeLessThanOrEqual(1.0);
    }
  });

  it("each deriver has at least 4 vision checklist items", () => {
    for (const k of KINDS) {
      expect(DERIVERS[k].visionChecklist.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("getDeriver falls back to compact_square on unknown kind", () => {
    // @ts-expect-error intentional bad kind
    const d = getDeriver("totally_made_up");
    expect(d.kind).toBe("compact_square");
  });

  it("snapshot: compact_square refine prompt for handbag", () => {
    const prompt = DERIVERS.compact_square.refinePrompt({
      productName: "Marlow Crossbody Bag",
      category: "bag",
    });
    expect(prompt).toMatchInlineSnapshot(`
      "Studio product photograph of Marlow Crossbody Bag (bag).
      Match the framing of the second reference (the crop oracle).
      Match the identity of the first reference (the studio source).
      Key features to preserve exactly:
        - hardware metal color and shape
        - stitch pattern visible on the seams
        - leather or fabric grain texture
        - strap or handle attachment hardware
        - logo or monogram pattern only as shown in the reference
      Pure white seamless background (#FFFFFF). Product centered, even fill of the frame.
      ABSOLUTELY NO:
        - no text, no letters, no numbers anywhere in the image
        - no logos that aren't physically printed on the actual product
        - no watermarks
        - no floating captions, callouts, or speech bubbles
        - no dimension labels or spec tags
        - no garbled or partially-rendered text characters
        - no horizontal line/scanline artifacts crossing through text
        - no shadows on background
        - no gradients on background
        - no AI artifacts
        - no halo around the product
        - do not re-shape the silhouette
        - do not invent logos, monograms, or charms not present in the reference
        - do not re-color the leather or fabric"
    `);
  });
});
