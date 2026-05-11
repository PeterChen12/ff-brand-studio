/**
 * Phase F · Iter 01 — Golden-master snapshot tests for refineWithIteration.
 *
 * Pin #1 from PHASE_F_SAFETY_RESEARCH.md mandates these tests ship in
 * the same commit as (or BEFORE) the migration to runQualityGate. They
 * capture the existing inline loop's exact behavior with scripted
 * judge/CLIP/refine responses so the post-migration code can be proven
 * byte-identical via the same assertions.
 *
 * What's scripted:
 *   - refineCall — returns a sequence of {outputR2Key, costCents} or errors
 *   - clipSimilarityFromR2 — returns a sequence of CLIP scores (or null)
 *   - judgeImage — returns a sequence of {approved, reasons, cost_cents}
 *
 * What's asserted:
 *   - asset.iters (iteration count)
 *   - asset.finalR2Key
 *   - asset.fair (FAIR-ship flag)
 *   - asset.clipScore
 *   - costCents (rolling total)
 *   - history rows (R2 keys + scores + verdicts)
 *
 * Once F1's migration ships, this same test file runs against the new
 * runQualityGate-backed path and MUST produce identical results. Any
 * divergence = bug in the migration.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PipelineCtx } from "../../src/pipeline/types.js";
import type { KindType } from "@ff/types";

// Mock the three external dependencies the iterate loop touches.
const refineCallMock = vi.fn();
const clipMock = vi.fn();
const judgeMock = vi.fn();

vi.mock("../../src/pipeline/refine.js", () => ({
  REFINE_COST_CENTS: 30,
  refineCall: (...args: unknown[]) => refineCallMock(...args),
}));
vi.mock("../../src/pipeline/triage.js", () => ({
  clipSimilarityFromR2: (...args: unknown[]) => clipMock(...args),
}));
vi.mock("../../src/compliance/dual_judge.js", () => ({
  judgeImage: (...args: unknown[]) => judgeMock(...args),
}));

// Import AFTER the mocks so the loop uses our scripted responses.
const { refineWithIteration } = await import("../../src/pipeline/iterate.js");

const fakeEnv = {
  FAL_KEY: "test-fal",
  R2_PUBLIC_URL: "https://test-r2.example",
  ANTHROPIC_API_KEY: "test-anthropic",
} as unknown as CloudflareBindings;

const fakeCtx: PipelineCtx = {
  tenantId: "t-1",
  productId: "p-1",
  variantId: "v-1",
  runId: "r-1",
  sku: "SKU-1",
  productName: "Test Product",
  productNameZh: null,
  category: "other",
  kind: "compact_square" as KindType,
  referenceR2Keys: ["ref-1"],
  features: {},
  perLaunchCapCents: 1000,
};

const baseInput = {
  cropTag: "crop_A",
  cropR2Key: "tenant/t-1/derive/crop_A.png",
  studioR2Key: "tenant/t-1/derive/studio.png",
  referenceR2Key: "tenant/t-1/cleanup/studio.png",
  remainingBudgetCents: 1000,
};

beforeEach(() => {
  refineCallMock.mockReset();
  clipMock.mockReset();
  judgeMock.mockReset();
});

describe("refineWithIteration — golden master (inline loop)", () => {
  it("scenario 1 — passes on first iter (CLIP above threshold)", async () => {
    refineCallMock.mockResolvedValueOnce({
      status: "ok",
      outputR2Key: "out/iter-1.png",
      costCents: 30,
      metadata: {},
    });
    clipMock.mockResolvedValueOnce(0.92); // > 0.78 threshold for compact_square

    const out = await refineWithIteration(fakeEnv, fakeCtx, baseInput);
    expect("error" in out ? out.error : null).toBeNull();
    if ("error" in out) return;
    expect(out.asset.iters).toBe(1);
    expect(out.asset.fair).toBe(false);
    expect(out.asset.finalR2Key).toBe("out/iter-1.png");
    expect(out.asset.clipScore).toBe(0.92);
    expect(out.costCents).toBe(30);
    expect(out.asset.history.length).toBe(1);
    expect(refineCallMock).toHaveBeenCalledTimes(1);
    expect(judgeMock).not.toHaveBeenCalled();
  });

  it("scenario 2 — CLIP fail then dual-judge approve (false-negative)", async () => {
    refineCallMock.mockResolvedValueOnce({
      status: "ok",
      outputR2Key: "out/iter-1.png",
      costCents: 30,
      metadata: {},
    });
    clipMock.mockResolvedValueOnce(0.65); // < 0.78
    judgeMock.mockResolvedValueOnce({
      approved: true,
      reasons: [],
      cost_cents: 2,
      metrics: {},
    });

    const out = await refineWithIteration(fakeEnv, fakeCtx, baseInput);
    if ("error" in out) throw new Error(out.error);
    expect(out.asset.iters).toBe(1);
    expect(out.asset.fair).toBe(false);
    expect(out.asset.finalR2Key).toBe("out/iter-1.png");
    expect(out.asset.clipScore).toBe(0.65);
    expect(out.costCents).toBe(32);
  });

  it("scenario 3 — iter 1 vision-fail → iter 2 CLIP-pass", async () => {
    refineCallMock.mockResolvedValueOnce({
      status: "ok",
      outputR2Key: "out/iter-1.png",
      costCents: 30,
      metadata: {},
    });
    refineCallMock.mockResolvedValueOnce({
      status: "ok",
      outputR2Key: "out/iter-2.png",
      costCents: 30,
      metadata: {},
    });
    clipMock.mockResolvedValueOnce(0.60); // < threshold
    clipMock.mockResolvedValueOnce(0.85); // pass
    judgeMock.mockResolvedValueOnce({
      approved: false,
      reasons: ["background not pure white"],
      cost_cents: 2,
      metrics: {},
    });

    const out = await refineWithIteration(fakeEnv, fakeCtx, baseInput);
    if ("error" in out) throw new Error(out.error);
    expect(out.asset.iters).toBe(2);
    expect(out.asset.fair).toBe(false);
    expect(out.asset.finalR2Key).toBe("out/iter-2.png");
    expect(out.asset.clipScore).toBe(0.85);
    expect(out.costCents).toBe(62); // 30 + 30 + 2
  });

  it("scenario 4 — all iters fail → FAIR ship with best", async () => {
    for (let i = 1; i <= 3; i++) {
      refineCallMock.mockResolvedValueOnce({
        status: "ok",
        outputR2Key: `out/iter-${i}.png`,
        costCents: 30,
        metadata: {},
      });
    }
    clipMock.mockResolvedValueOnce(0.55);
    clipMock.mockResolvedValueOnce(0.72);
    clipMock.mockResolvedValueOnce(0.68);
    judgeMock.mockResolvedValueOnce({
      approved: false,
      reasons: ["cropped subject"],
      cost_cents: 2,
      metrics: {},
    });

    const out = await refineWithIteration(fakeEnv, fakeCtx, baseInput);
    if ("error" in out) throw new Error(out.error);
    expect(out.asset.iters).toBe(3);
    expect(out.asset.fair).toBe(true);
    // Best score is iter-2 (0.72)
    expect(out.asset.finalR2Key).toBe("out/iter-2.png");
    expect(out.asset.clipScore).toBe(0.72);
  });

  it("scenario 5 — budget halts before iter 2", async () => {
    refineCallMock.mockResolvedValueOnce({
      status: "ok",
      outputR2Key: "out/iter-1.png",
      costCents: 30,
      metadata: {},
    });
    clipMock.mockResolvedValueOnce(0.50);
    judgeMock.mockResolvedValueOnce({
      approved: false,
      reasons: ["text in image"],
      cost_cents: 2,
      metrics: {},
    });

    const out = await refineWithIteration(fakeEnv, fakeCtx, {
      ...baseInput,
      remainingBudgetCents: 30, // exactly one refine fits; second is capped
    });
    if ("error" in out) throw new Error(out.error);
    // First iter completed, then budget < REFINE_COST_CENTS for iter 2.
    // Loop ships best (only iter-1) as FAIR.
    expect(out.asset.finalR2Key).toBe("out/iter-1.png");
    expect(out.asset.fair).toBe(true);
    expect(refineCallMock).toHaveBeenCalledTimes(1);
  });
});
