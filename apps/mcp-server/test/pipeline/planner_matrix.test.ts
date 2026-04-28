import { describe, expect, it } from "vitest";
import { planProductionSlots } from "../../src/pipeline/planner_matrix.js";

describe("planProductionSlots", () => {
  it("emits 6 Amazon slots when amazon-only", () => {
    const slots = planProductionSlots({
      platforms: ["amazon"],
      features: {},
    });
    expect(slots).toHaveLength(6);
    expect(slots.every((s) => s.platform === "amazon")).toBe(true);
    expect(slots.map((s) => s.slot)).toEqual([
      "main",
      "lifestyle",
      "a_plus_feature_1",
      "a_plus_feature_2",
      "a_plus_feature_3_grid",
      "close_up",
    ]);
  });

  it("emits 5 Shopify slots when shopify-only", () => {
    const slots = planProductionSlots({
      platforms: ["shopify"],
      features: {},
    });
    expect(slots).toHaveLength(5);
    expect(slots.every((s) => s.platform === "shopify")).toBe(true);
    expect(slots.map((s) => s.slot)).toEqual([
      "main",
      "lifestyle",
      "detail",
      "close_up",
      "banner",
    ]);
  });

  it("emits 11 slots for both platforms (6 Amazon + 5 Shopify)", () => {
    const slots = planProductionSlots({
      platforms: ["amazon", "shopify"],
      features: {},
    });
    expect(slots).toHaveLength(11);
  });

  it("adds comparison_grid when amazon_a_plus_grid feature is on", () => {
    const slots = planProductionSlots({
      platforms: ["amazon"],
      features: { amazon_a_plus_grid: true },
    });
    expect(slots.some((s) => s.slot === "comparison_grid")).toBe(true);
  });

  it("Amazon main maps to refine_studio", () => {
    const slots = planProductionSlots({ platforms: ["amazon"], features: {} });
    const main = slots.find((s) => s.slot === "main");
    expect(main?.source).toBe("refine_studio");
  });

  it("Amazon close_up uses crop_C; Shopify close_up uses crop_B (no dupes)", () => {
    const slots = planProductionSlots({
      platforms: ["amazon", "shopify"],
      features: {},
    });
    const amClose = slots.find((s) => s.platform === "amazon" && s.slot === "close_up");
    const spClose = slots.find((s) => s.platform === "shopify" && s.slot === "close_up");
    expect(amClose?.source).toBe("refine_crop_C");
    expect(spClose?.source).toBe("refine_crop_B");
  });
});
