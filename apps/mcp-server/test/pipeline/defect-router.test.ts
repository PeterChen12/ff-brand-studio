/**
 * Phase F · Iter 04 — Unit tests for defect-router.
 *
 * Targets the pure-function contract — classification, priority order,
 * specialist prompt construction. No I/O, no mocks needed.
 */
import { describe, it, expect } from "vitest";
import {
  classifyReason,
  pickPrimaryDefect,
  buildSpecialistPrompt,
  type DefectCategory,
} from "../../src/pipeline/defect-router.js";

describe("classifyReason", () => {
  const cases: Array<[string, DefectCategory]> = [
    ["unintended text overlay 'PREMIUM' appears in bottom-right", "text_in_image"],
    ["hallucinated brand logo on product body", "text_in_image"],
    ["garbled text characters with scanline artifact", "text_in_image"],
    ["white background has visible vertical color banding", "bg_not_white"],
    ["halo of pixels around the product from poor masking", "bg_not_white"],
    ["bg has gradient seams", "bg_not_white"],
    ["rod tip cropped — only the lower half visible", "cropped_subject"],
    ["product cut off at the right edge", "cropped_subject"],
    ["wrong color on the handle — should be matte black", "wrong_color"],
    ["hue is off versus the reference", "wrong_color"],
    ["melted geometry on the reel handle", "melted_geometry"],
    ["duplicated guides on the rod blank", "melted_geometry"],
    ["product silhouette looks correct but lighting is harsh", "generic"],
    ["", "generic"],
  ];

  for (const [reason, expected] of cases) {
    it(`classifies "${reason.slice(0, 50)}..." as ${expected}`, () => {
      expect(classifyReason(reason)).toBe(expected);
    });
  }
});

describe("pickPrimaryDefect", () => {
  it("returns generic for empty reasons", () => {
    expect(pickPrimaryDefect([])).toBe("generic");
  });

  it("returns the single match when one reason hits one category", () => {
    expect(pickPrimaryDefect(["white bg has color banding"])).toBe("bg_not_white");
  });

  it("prioritizes text_in_image over other categories", () => {
    expect(
      pickPrimaryDefect([
        "white bg has banding",
        "unintended watermark in corner",
        "rod tip cropped",
      ])
    ).toBe("text_in_image");
  });

  it("prioritizes bg_not_white over cropped + geometry", () => {
    expect(
      pickPrimaryDefect([
        "rod tip cropped",
        "bg has gradient seams",
        "melted reel handle",
      ])
    ).toBe("bg_not_white");
  });

  it("falls through to generic when no patterns hit", () => {
    expect(pickPrimaryDefect(["lighting is too harsh"])).toBe("generic");
  });
});

describe("buildSpecialistPrompt", () => {
  it("prepends specialist directive + appends reasons", () => {
    const { prompt, category } = buildSpecialistPrompt(
      "BASE: render the product on white",
      ["unintended text appeared in corner"]
    );
    expect(category).toBe("text_in_image");
    expect(prompt).toMatch(/ABSOLUTE PRIORITY.*ZERO text/);
    expect(prompt).toMatch(/BASE: render the product on white/);
    expect(prompt).toMatch(/Prior attempt was rejected.*unintended text appeared/s);
  });

  it("uses empty directive + reason-append for generic", () => {
    const { prompt, category } = buildSpecialistPrompt(
      "BASE: render the product",
      ["lighting too harsh"]
    );
    expect(category).toBe("generic");
    expect(prompt).not.toMatch(/ABSOLUTE PRIORITY/);
    expect(prompt).toMatch(/BASE: render the product/);
    expect(prompt).toMatch(/Prior attempt was rejected.*lighting too harsh/s);
  });

  it("handles zero reasons (no append block)", () => {
    const { prompt, category } = buildSpecialistPrompt("BASE", []);
    expect(category).toBe("generic");
    expect(prompt).toBe("BASE");
  });

  it("picks primary category when multiple defects present", () => {
    const { category } = buildSpecialistPrompt("BASE", [
      "rod tip cropped",
      "unintended text in corner",
    ]);
    expect(category).toBe("text_in_image");
  });
});
