/**
 * Zombie run sweeper — Phase A2.
 *
 * Cloudflare Workers caps wallclock at 5 min for HTTP requests. The
 * production_pipeline can take ≥ 5 min on full-scope launches; when
 * it does, the worker is killed mid-flight after the orchestrator
 * has flipped status='running' but BEFORE its finalize update. The
 * row sits in 'running' forever, the wallet pre-charge stays
 * frozen, and the operator can't tell whether the run is healthy
 * or dead.
 *
 * This sweeper runs on a cron (every 5 min). For any launch_runs
 * row stuck in 'running' for > 10 min:
 *   1. mark status='failed', durationMs=0
 *   2. refund the recorded predicted_cents to the tenant wallet
 *   3. emit a launch.refund_zombie audit event
 *
 * Idempotent: row already terminal → skip; refund failure logged
 * but doesn't block the sweep loop.
 */

import { and, eq, lt } from "drizzle-orm";
import { launchRuns } from "../db/schema.js";
import type { DbClient } from "../db/client.js";
import { creditWallet } from "../lib/wallet.js";
import { auditEvent } from "../lib/audit.js";

const ZOMBIE_DEADLINE_MS = 10 * 60 * 1000; // 10 minutes

export interface SweepResult {
  scanned: number;
  swept: number;
  refunded_cents: number;
  refund_failures: number;
}

export async function sweepZombieRuns(db: DbClient): Promise<SweepResult> {
  const cutoff = new Date(Date.now() - ZOMBIE_DEADLINE_MS);
  const stuck = await db
    .select()
    .from(launchRuns)
    .where(and(eq(launchRuns.status, "running"), lt(launchRuns.startedAt, cutoff)));

  let refundedCents = 0;
  let refundFailures = 0;

  for (const r of stuck) {
    // Flip terminal first so a concurrent finalize from a still-running
    // worker (unlikely, but possible if our deadline is off) doesn't
    // collide with the refund.
    try {
      await db
        .update(launchRuns)
        .set({ status: "failed", durationMs: 0 })
        .where(eq(launchRuns.id, r.id));
    } catch (err) {
      console.error("[zombie_sweep] update failed for", r.id, err);
      continue;
    }

    const refund = r.predictedCents ?? 0;
    if (refund > 0) {
      try {
        await creditWallet(db, {
          tenantId: r.tenantId,
          cents: refund,
          reason: "refund",
          referenceType: "zombie_sweep",
          referenceId: r.id,
        });
        refundedCents += refund;
      } catch (err) {
        refundFailures += 1;
        console.error("[zombie_sweep] refund failed for", r.id, err);
      }
    }

    try {
      await auditEvent(db, {
        tenantId: r.tenantId,
        actor: null,
        action: "launch.refund_zombie",
        targetType: "launch_run",
        targetId: r.id,
        metadata: {
          predicted_cents: refund,
          stuck_since: r.startedAt?.toISOString() ?? null,
          last_phase: r.currentPhase ?? null,
        },
      });
    } catch (err) {
      console.error("[zombie_sweep] audit failed for", r.id, err);
    }
  }

  return {
    scanned: stuck.length,
    swept: stuck.length - refundFailures,
    refunded_cents: refundedCents,
    refund_failures: refundFailures,
  };
}

const STALE_IDEMPOTENCY_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Idempotency-key TTL purge — older than 24h. Scheduled handler runs
 * this alongside zombie sweep so the table doesn't grow unbounded.
 */
export async function purgeStaleIdempotencyKeys(db: DbClient): Promise<number> {
  const { idempotencyKeys } = await import("../db/schema.js");
  const cutoff = new Date(Date.now() - STALE_IDEMPOTENCY_MS);
  const deleted = await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.createdAt, cutoff))
    .returning({ id: idempotencyKeys.id });
  return deleted.length;
}
