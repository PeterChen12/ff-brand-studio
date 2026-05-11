/**
 * Phase F · Iter 01 — Quality-gate-with-Auto-Fix abstraction.
 *
 * Extracts the "produce → judge → fix → re-judge → accept-or-escalate"
 * pattern that's currently hand-rolled in three places:
 *   - pipeline/iterate.ts (image refine + dual_judge + reason-amended regen)
 *   - orchestrator/launch_pipeline.ts grounding loop (judge → rewrite → re-grade)
 *   - pipeline/derive.ts (implicit; CLIP triage → re-derive)
 *
 * And about to be hand-rolled in four more deferred iterations:
 *   - E2.1 best-of-input passthrough
 *   - E5.B compliance defect router
 *   - E5.C chained specs-table extraction
 *   - E5.D multi-judge ensemble
 *
 * Generic over T (the candidate type — listing copy, R2 key, specs array,
 * etc.). The contract:
 *   - judge(current, attempt) → JudgeResult: classify the candidate
 *   - fix(current, reasons) → T | null: optional; produce a corrected
 *     candidate. Return null to fall through to history-final without
 *     a fix attempt (used by passthrough-style gates with no fix path).
 *   - maxAttempts: ceiling on FIX attempts; defaults to 1
 *   - budget_cents: optional pre-flight cost ceiling; the loop halts
 *     mid-cycle if the running cost would exceed
 *
 * Cost accumulation is automatic — callers read total_cost_cents from
 * the result.
 */

export interface JudgeResult {
  /** True when the candidate is acceptable as-is. */
  pass: boolean;
  /** Human-readable reasons for failure. Empty when pass=true. Fed to fix() */
  reasons: string[];
  /** Cost of this judge call in cents. Accumulates into total_cost_cents. */
  cost_cents: number;
  /** Optional pass-through metadata the caller may want to keep (e.g.
   *  CLIP score, dual_judge verdict shape, original grounding object). */
  metadata?: Record<string, unknown>;
}

export interface QualityGateInput<T> {
  /** The initial candidate output. */
  initial: T;
  /** Decide whether the candidate is acceptable. */
  judge: (current: T, attempt: number) => Promise<JudgeResult>;
  /** Optional fix function. If omitted, the gate is a "judge only" check
   *  with no auto-correct (used by E2.1 passthrough-style gates). */
  fix?: (current: T, reasons: string[]) => Promise<T | null>;
  /** Max number of fix attempts. Default 1 (one initial judge + one fix
   *  + one re-judge). iterate.ts uses 2 (matching its existing 3-iter cap
   *  = 1 initial + 2 fix-and-re-judge cycles). */
  maxAttempts?: number;
  /** Optional budget ceiling. Stops the loop if the next call would
   *  push running cost past this. Default Infinity (no cap). */
  budgetCents?: number;
}

export interface QualityGateHistoryEntry<T> {
  /** 1-based attempt index. Attempt 1 = initial judge. */
  attempt: number;
  judge: JudgeResult;
  /** The candidate AFTER fix() for this attempt; null if fix wasn't called
   *  (passing first try, or maxAttempts hit). */
  fixed: T | null;
}

export interface QualityGateResult<T> {
  /** The final candidate the gate settled on — either a passing candidate
   *  OR the original/best when all attempts failed. */
  final: T;
  /** True if a judge at any point returned pass=true. */
  passed: boolean;
  /** Total judge calls (initial + post-fix re-judges). */
  attempts: number;
  history: QualityGateHistoryEntry<T>[];
  total_cost_cents: number;
  /** Did the loop halt early due to budget? */
  budget_capped: boolean;
}

/**
 * Run the gate. Algorithm:
 *   1. judge(initial, 1) → if pass, return early
 *   2. for attempt 2..maxAttempts+1:
 *      a. fix(current, lastReasons) → newCandidate (or null → stop)
 *      b. judge(newCandidate, attempt) → if pass, return
 *   3. return final candidate (the last one attempted) with passed=false
 *
 * Cost is accumulated automatically from JudgeResult.cost_cents. The
 * loop halts if the next judge call would push running cost past
 * budgetCents.
 */
export async function runQualityGate<T>(
  input: QualityGateInput<T>
): Promise<QualityGateResult<T>> {
  const maxAttempts = input.maxAttempts ?? 1;
  const budget = input.budgetCents ?? Number.POSITIVE_INFINITY;

  let current = input.initial;
  let totalCost = 0;
  let budgetCapped = false;
  const history: QualityGateHistoryEntry<T>[] = [];

  // Attempt 1 — initial judge.
  const firstJudge = await input.judge(current, 1);
  totalCost += firstJudge.cost_cents;
  history.push({ attempt: 1, judge: firstJudge, fixed: null });
  if (firstJudge.pass) {
    return {
      final: current,
      passed: true,
      attempts: 1,
      history,
      total_cost_cents: totalCost,
      budget_capped: false,
    };
  }

  // No fix function — gate is judge-only. Return the original with passed=false.
  if (!input.fix) {
    return {
      final: current,
      passed: false,
      attempts: 1,
      history,
      total_cost_cents: totalCost,
      budget_capped: false,
    };
  }

  // Fix-and-re-judge attempts.
  let lastReasons = firstJudge.reasons;
  for (let attempt = 2; attempt <= maxAttempts + 1; attempt++) {
    if (totalCost >= budget) {
      budgetCapped = true;
      break;
    }
    const fixed = await input.fix(current, lastReasons);
    if (fixed === null || fixed === undefined) {
      // fix() opted out — stop here, return current with passed=false.
      break;
    }
    current = fixed;
    const reJudge = await input.judge(current, attempt);
    totalCost += reJudge.cost_cents;
    history.push({ attempt, judge: reJudge, fixed });
    if (reJudge.pass) {
      return {
        final: current,
        passed: true,
        attempts: attempt,
        history,
        total_cost_cents: totalCost,
        budget_capped: false,
      };
    }
    lastReasons = reJudge.reasons;
  }

  return {
    final: current,
    passed: false,
    attempts: history.length,
    history,
    total_cost_cents: totalCost,
    budget_capped: budgetCapped,
  };
}
