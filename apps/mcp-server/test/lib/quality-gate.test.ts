/**
 * Phase F · Iter 01 — Unit tests for runQualityGate.
 *
 * Independent of the iterate.ts + grounding migrations — these prove the
 * abstraction itself is correct. The golden-master tests in
 * test/pipeline/iterate-snapshot.test.ts and test/orchestrator/
 * grounding-snapshot.test.ts prove the migrations don't regress.
 */
import { describe, it, expect, vi } from "vitest";
import { runQualityGate } from "../../src/lib/quality-gate.js";

describe("runQualityGate", () => {
  it("passes on first try — no fix call", async () => {
    const judge = vi.fn().mockResolvedValueOnce({
      pass: true,
      reasons: [],
      cost_cents: 5,
    });
    const fix = vi.fn();
    const result = await runQualityGate({
      initial: "candidate-A",
      judge,
      fix,
    });
    expect(result.passed).toBe(true);
    expect(result.final).toBe("candidate-A");
    expect(result.attempts).toBe(1);
    expect(result.total_cost_cents).toBe(5);
    expect(result.history).toHaveLength(1);
    expect(fix).not.toHaveBeenCalled();
  });

  it("passes after one fix attempt", async () => {
    const judge = vi
      .fn()
      .mockResolvedValueOnce({ pass: false, reasons: ["bad"], cost_cents: 5 })
      .mockResolvedValueOnce({ pass: true, reasons: [], cost_cents: 5 });
    const fix = vi.fn().mockResolvedValueOnce("candidate-B");
    const result = await runQualityGate({
      initial: "candidate-A",
      judge,
      fix,
      maxAttempts: 1,
    });
    expect(result.passed).toBe(true);
    expect(result.final).toBe("candidate-B");
    expect(result.attempts).toBe(2);
    expect(result.total_cost_cents).toBe(10);
    expect(fix).toHaveBeenCalledWith("candidate-A", ["bad"]);
    expect(result.history[1].fixed).toBe("candidate-B");
  });

  it("returns last candidate with passed=false when all attempts fail", async () => {
    const judge = vi
      .fn()
      .mockResolvedValue({ pass: false, reasons: ["bad"], cost_cents: 5 });
    const fix = vi
      .fn()
      .mockResolvedValueOnce("candidate-B")
      .mockResolvedValueOnce("candidate-C");
    const result = await runQualityGate({
      initial: "candidate-A",
      judge,
      fix,
      maxAttempts: 2,
    });
    expect(result.passed).toBe(false);
    expect(result.final).toBe("candidate-C"); // last fix attempt
    expect(result.attempts).toBe(3); // initial + 2 fixes
    expect(result.total_cost_cents).toBe(15);
    expect(result.history).toHaveLength(3);
  });

  it("judge-only mode (no fix) returns original on fail", async () => {
    const judge = vi.fn().mockResolvedValueOnce({
      pass: false,
      reasons: ["nope"],
      cost_cents: 0,
    });
    const result = await runQualityGate({
      initial: "candidate-A",
      judge,
    });
    expect(result.passed).toBe(false);
    expect(result.final).toBe("candidate-A");
    expect(result.attempts).toBe(1);
  });

  it("stops when fix returns null", async () => {
    const judge = vi
      .fn()
      .mockResolvedValue({ pass: false, reasons: ["bad"], cost_cents: 1 });
    const fix = vi.fn().mockResolvedValueOnce(null);
    const result = await runQualityGate({
      initial: "candidate-A",
      judge,
      fix,
      maxAttempts: 5, // many allowed, but fix opts out
    });
    expect(result.passed).toBe(false);
    expect(result.final).toBe("candidate-A");
    expect(result.attempts).toBe(1); // judge called once, fix returned null, no re-judge
  });

  it("halts when budget reached mid-loop", async () => {
    const judge = vi
      .fn()
      .mockResolvedValue({ pass: false, reasons: ["bad"], cost_cents: 5 });
    const fix = vi
      .fn()
      .mockResolvedValueOnce("candidate-B")
      .mockResolvedValueOnce("candidate-C");
    const result = await runQualityGate({
      initial: "candidate-A",
      judge,
      fix,
      maxAttempts: 5,
      budgetCents: 8, // first judge=5; running=5, next iter check: 5<8, fix→re-judge=10 over budget
    });
    // The check is `totalCost >= budget` BEFORE the next fix+judge. After first judge (5),
    // we proceed to second (running=5, budget=8, 5<8). After second judge (10), we check
    // again: 10 >= 8, halt. So we get 2 judges total.
    expect(result.budget_capped).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.passed).toBe(false);
  });

  it("history captures all attempts with judges and fixed values", async () => {
    const judge = vi
      .fn()
      .mockResolvedValueOnce({ pass: false, reasons: ["r1"], cost_cents: 1 })
      .mockResolvedValueOnce({ pass: false, reasons: ["r2"], cost_cents: 1 })
      .mockResolvedValueOnce({ pass: true, reasons: [], cost_cents: 1 });
    const fix = vi
      .fn()
      .mockResolvedValueOnce("v2")
      .mockResolvedValueOnce("v3");
    const result = await runQualityGate({
      initial: "v1",
      judge,
      fix,
      maxAttempts: 2,
    });
    expect(result.passed).toBe(true);
    expect(result.final).toBe("v3");
    expect(result.history).toEqual([
      {
        attempt: 1,
        judge: { pass: false, reasons: ["r1"], cost_cents: 1 },
        fixed: null,
      },
      {
        attempt: 2,
        judge: { pass: false, reasons: ["r2"], cost_cents: 1 },
        fixed: "v2",
      },
      {
        attempt: 3,
        judge: { pass: true, reasons: [], cost_cents: 1 },
        fixed: "v3",
      },
    ]);
  });
});
