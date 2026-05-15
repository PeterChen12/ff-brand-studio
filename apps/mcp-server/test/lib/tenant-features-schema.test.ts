/**
 * Phase G · G01 — Canonical TenantFeatures schema contract.
 *
 * The schema lives in @ff/types/api.ts so the worker and the dashboard
 * can't drift. This file pins the schema's shape: every known key has
 * an explicit validator, and unknown keys passthrough (so operator-side
 * experiments don't fail parsing in older clients).
 */
import { describe, expect, it } from "vitest";
import { TenantFeaturesSchema } from "@ff/types";

describe("TenantFeaturesSchema (Phase G · G01)", () => {
  it("accepts an empty features bag", () => {
    expect(TenantFeaturesSchema.parse({})).toEqual({});
  });

  it("accepts the canonical operator flags", () => {
    const parsed = TenantFeaturesSchema.parse({
      production_pipeline: true,
      feedback_regen: true,
      has_sample_access: false,
      amazon_a_plus_grid: true,
    });
    expect(parsed.production_pipeline).toBe(true);
    expect(parsed.amazon_a_plus_grid).toBe(true);
  });

  it("validates user-managed preferences", () => {
    const parsed = TenantFeaturesSchema.parse({
      default_platforms: ["amazon", "shopify"],
      default_output_langs: ["en", "zh"],
      default_quality_preset: "balanced",
      language_display: "both",
      brand_hex: "#1C3FAA",
    });
    expect(parsed.default_platforms).toEqual(["amazon", "shopify"]);
    expect(parsed.default_quality_preset).toBe("balanced");
  });

  it("rejects an invalid brand_hex", () => {
    expect(() =>
      TenantFeaturesSchema.parse({ brand_hex: "not-a-hex" })
    ).toThrow();
    expect(() =>
      TenantFeaturesSchema.parse({ brand_hex: "#FFF" }) // 3-digit not allowed
    ).toThrow();
  });

  it("rejects an invalid default_quality_preset", () => {
    expect(() =>
      TenantFeaturesSchema.parse({ default_quality_preset: "extreme" })
    ).toThrow();
  });

  it("rejects an unknown default_platforms value", () => {
    expect(() =>
      TenantFeaturesSchema.parse({ default_platforms: ["amazon", "tiktok"] })
    ).toThrow();
  });

  it("rate_limit_per_min must fit the documented bounds", () => {
    expect(() =>
      TenantFeaturesSchema.parse({ rate_limit_per_min: 5 })
    ).toThrow();
    expect(() =>
      TenantFeaturesSchema.parse({ rate_limit_per_min: 10_000 })
    ).toThrow();
    expect(
      TenantFeaturesSchema.parse({ rate_limit_per_min: 600 }).rate_limit_per_min
    ).toBe(600);
  });

  it("clip_threshold_overrides must be 0–1 floats keyed by kind", () => {
    const parsed = TenantFeaturesSchema.parse({
      clip_threshold_overrides: {
        compact_square: 0.82,
        apparel_flat: 0.74,
      },
    });
    expect(parsed.clip_threshold_overrides?.compact_square).toBe(0.82);
    expect(() =>
      TenantFeaturesSchema.parse({
        clip_threshold_overrides: { jewelry: 1.5 },
      })
    ).toThrow();
  });

  it("passes through unknown keys (forward-compat)", () => {
    const parsed = TenantFeaturesSchema.parse({
      production_pipeline: true,
      // Hypothetical future key that older clients haven't been redeployed
      // for — should NOT throw, should be preserved on the parsed output.
      _experimental_canary_feature: { enabled: true, ratio: 0.1 },
    });
    expect(parsed.production_pipeline).toBe(true);
    // Cast through unknown because the passthrough type widens to a record.
    const bag = parsed as unknown as Record<string, unknown>;
    expect(bag._experimental_canary_feature).toEqual({
      enabled: true,
      ratio: 0.1,
    });
  });
});
