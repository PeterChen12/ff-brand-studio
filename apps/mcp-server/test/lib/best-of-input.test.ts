/**
 * Phase F · Iter 03 — Unit tests for best-of-input scoring + thresholds.
 *
 * Focuses on the pure-function contract:
 *  - threshold predicates (isPublishReadyReference)
 *  - reason string formatting (failureReasons)
 *  - slot allowlist (passthroughAllowedForSlot)
 *
 * The sharp-pixel scoreReference() function is intentionally not unit-
 * tested here — it'd require fixture image buffers and adds little
 * coverage value over the integration smoke test (which runs the
 * function against a synthetic 2000×2000 white-bg buffer).
 */
import { describe, it, expect } from "vitest";
import {
  isPublishReadyReference,
  failureReasons,
  passthroughAllowedForSlot,
  isAbortQuality,
  PASSTHROUGH_FILL_MIN,
  PASSTHROUGH_FILL_MAX,
  PASSTHROUGH_WHITENESS_MIN,
  PASSTHROUGH_LONGEST_SIDE_MIN,
  ABORT_LONGEST_SIDE_MIN,
  ABORT_FILL_MIN,
  ABORT_WHITENESS_MIN,
} from "../../src/lib/best-of-input.js";

describe("isPublishReadyReference", () => {
  it("accepts a clean studio shot within all thresholds", () => {
    expect(
      isPublishReadyReference({ longestSide: 3000, fillRatio: 0.65, whiteness: 0.97 })
    ).toBe(true);
  });

  it("rejects a low-resolution input", () => {
    expect(
      isPublishReadyReference({ longestSide: 1200, fillRatio: 0.65, whiteness: 0.97 })
    ).toBe(false);
  });

  it("rejects an over-tight product (fill too high)", () => {
    expect(
      isPublishReadyReference({ longestSide: 3000, fillRatio: 0.85, whiteness: 0.97 })
    ).toBe(false);
  });

  it("rejects a too-loose product (fill too low)", () => {
    expect(
      isPublishReadyReference({ longestSide: 3000, fillRatio: 0.40, whiteness: 0.97 })
    ).toBe(false);
  });

  it("rejects a non-white background", () => {
    expect(
      isPublishReadyReference({ longestSide: 3000, fillRatio: 0.65, whiteness: 0.80 })
    ).toBe(false);
  });

  it("uses exclusive thresholds correctly at the boundaries", () => {
    expect(
      isPublishReadyReference({
        longestSide: PASSTHROUGH_LONGEST_SIDE_MIN,
        fillRatio: PASSTHROUGH_FILL_MIN,
        whiteness: PASSTHROUGH_WHITENESS_MIN,
      })
    ).toBe(true);
    expect(
      isPublishReadyReference({
        longestSide: PASSTHROUGH_LONGEST_SIDE_MIN,
        fillRatio: PASSTHROUGH_FILL_MAX,
        whiteness: PASSTHROUGH_WHITENESS_MIN,
      })
    ).toBe(true);
  });
});

describe("failureReasons", () => {
  it("returns empty array when all thresholds pass", () => {
    expect(failureReasons({ longestSide: 3000, fillRatio: 0.65, whiteness: 0.97 })).toEqual([]);
  });

  it("lists all failing checks", () => {
    const reasons = failureReasons({ longestSide: 1200, fillRatio: 0.40, whiteness: 0.80 });
    expect(reasons).toHaveLength(3);
    expect(reasons[0]).toMatch(/resolution too low/);
    expect(reasons[1]).toMatch(/fill too low/);
    expect(reasons[2]).toMatch(/background not white/);
  });

  it("uses correct reason for over-tight fill", () => {
    const reasons = failureReasons({ longestSide: 3000, fillRatio: 0.90, whiteness: 0.97 });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/fill too high/);
  });
});

describe("isAbortQuality (Phase G · G05)", () => {
  it("does not abort on a clean reference", () => {
    const v = isAbortQuality({ longestSide: 3000, fillRatio: 0.65, whiteness: 0.97 });
    expect(v.abort).toBe(false);
    expect(v.reasons).toHaveLength(0);
  });

  it("does not abort on a borderline-passthrough reference", () => {
    // Below passthrough thresholds but still well above abort thresholds —
    // pipeline should run, not refuse.
    const v = isAbortQuality({ longestSide: 1200, fillRatio: 0.40, whiteness: 0.65 });
    expect(v.abort).toBe(false);
  });

  it("aborts when resolution is below the floor", () => {
    const v = isAbortQuality({
      longestSide: ABORT_LONGEST_SIDE_MIN - 1,
      fillRatio: 0.5,
      whiteness: 0.9,
    });
    expect(v.abort).toBe(true);
    expect(v.reasons[0]).toMatch(/too small/);
  });

  it("aborts when no product is detectable", () => {
    const v = isAbortQuality({ longestSide: 3000, fillRatio: 0.01, whiteness: 0.95 });
    expect(v.abort).toBe(true);
    expect(v.reasons.some((r) => /no detectable product/.test(r))).toBe(true);
  });

  it("aborts when the background is heavily non-white", () => {
    const v = isAbortQuality({
      longestSide: 3000,
      fillRatio: 0.5,
      whiteness: ABORT_WHITENESS_MIN - 0.05,
    });
    expect(v.abort).toBe(true);
    expect(v.reasons.some((r) => /background is heavily non-white/.test(r))).toBe(true);
  });

  it("accumulates multiple reasons for combined failures", () => {
    const v = isAbortQuality({ longestSide: 200, fillRatio: 0.0, whiteness: 0.1 });
    expect(v.abort).toBe(true);
    expect(v.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("ABORT_FILL_MIN is strictly below PASSTHROUGH_FILL_MIN", () => {
    // Invariant: the abort threshold MUST be below the passthrough threshold,
    // otherwise we'd abort runs that should have passthrough'd. Cheap guard
    // against accidentally reordering the constants.
    expect(ABORT_FILL_MIN).toBeLessThan(PASSTHROUGH_FILL_MIN);
  });
});

describe("passthroughAllowedForSlot", () => {
  it("allows white-bg / main-hero slots", () => {
    expect(passthroughAllowedForSlot("studio")).toBe(true);
    expect(passthroughAllowedForSlot("refine_studio")).toBe(true);
    expect(passthroughAllowedForSlot("amazon-main")).toBe(true);
    expect(passthroughAllowedForSlot("shopify-main")).toBe(true);
  });

  it("denies lifestyle / banner / composite slots", () => {
    expect(passthroughAllowedForSlot("lifestyle")).toBe(false);
    expect(passthroughAllowedForSlot("banner")).toBe(false);
    expect(passthroughAllowedForSlot("composite_detail_1")).toBe(false);
    expect(passthroughAllowedForSlot("a_plus_feature_1")).toBe(false);
  });

  it("denies unknown slot strings (safe default)", () => {
    expect(passthroughAllowedForSlot("totally-new-slot")).toBe(false);
  });
});
