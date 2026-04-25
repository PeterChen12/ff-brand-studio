import { describe, expect, it } from "vitest";
import { MAX_REFINEMENT_ITERATIONS } from "../../src/orchestrator/evaluator_optimizer.js";

/**
 * Unit-level checks of the loop's static behavior. The DB-roundtrip behavior
 * is covered by the integration test; this just confirms the constants and
 * shape are stable.
 */
describe("evaluator-optimizer constants", () => {
  it("MAX_REFINEMENT_ITERATIONS is 3 per plan §4.5", () => {
    expect(MAX_REFINEMENT_ITERATIONS).toBe(3);
  });
});
