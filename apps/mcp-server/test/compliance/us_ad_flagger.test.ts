import { describe, expect, it } from "vitest";
import { flagUsAdContent } from "../../src/compliance/us_ad_flagger.js";

describe("flagUsAdContent", () => {
  it("returns no flags for clean ecommerce copy", () => {
    const flags = flagUsAdContent(
      "Insulated stainless steel tumbler. 24oz capacity. Dishwasher safe."
    );
    expect(flags).toEqual([]);
  });

  it("flags Amazon ToS superlatives ('best')", () => {
    const flags = flagUsAdContent("The best tumbler you'll ever own.");
    expect(flags.some((f) => f.category === "amazon_tos")).toBe(true);
    expect(flags.some((f) => f.matched.toLowerCase() === "best")).toBe(true);
  });

  it("flags 'guaranteed'", () => {
    const flags = flagUsAdContent("Quality guaranteed for life.");
    expect(flags.some((f) => f.matched.toLowerCase() === "guaranteed")).toBe(true);
  });

  it("flags FTC 'as seen on' and expert endorsement patterns", () => {
    const flags = flagUsAdContent("As seen on TV. Doctor recommended.");
    expect(flags.filter((f) => f.category === "ftc").length).toBeGreaterThanOrEqual(2);
  });

  it("flags health claims", () => {
    const flags = flagUsAdContent("Drink hot water to cure your cold.");
    expect(flags.some((f) => f.category === "health")).toBe(true);
    expect(flags.some((f) => f.matched.toLowerCase() === "cure")).toBe(true);
  });

  it("flags weight-loss claims with specific amounts", () => {
    const flags = flagUsAdContent("Lose 10 lbs in a week!");
    expect(
      flags.some((f) => f.category === "health" && /lose\s+10/i.test(f.matched))
    ).toBe(true);
  });

  it("treats 'eco-friendly' as Amazon ToS violation absent certification context", () => {
    const flags = flagUsAdContent("Eco-friendly bamboo construction.");
    expect(flags.some((f) => f.matched.toLowerCase().startsWith("eco"))).toBe(true);
  });

  it("aggregates multiple categories from one string", () => {
    const flags = flagUsAdContent(
      "The #1 tumbler. Doctor recommended. Cure your thirst, guaranteed!"
    );
    const cats = new Set(flags.map((f) => f.category));
    expect(cats.has("amazon_tos")).toBe(true);
    expect(cats.has("ftc")).toBe(true);
    expect(cats.has("health")).toBe(true);
  });
});
