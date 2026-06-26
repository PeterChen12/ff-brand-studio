/**
 * Durable launch execution — queue consumer logic.
 *
 * The image pipeline runs 3-5 minutes. It used to run inside the launch
 * request's `executionCtx.waitUntil()`, but Cloudflare cancels waitUntil work
 * shortly after the HTTP response returns ("waitUntil() tasks did not complete
 * within the allowed time after invocation end and have been cancelled"), so
 * EVERY multi-minute generation was killed mid-flight and left stuck 'running'
 * until the zombie-sweeper cron failed + refunded it. POST /v1/launches now
 * enqueues a LaunchQueueMessage; this consumer runs the pipeline in its own
 * invocation, which is not bound by the original request's waitUntil window.
 *
 * Secrets/bindings are read from the consumer's own `env` — the queue message
 * carries only serializable launch params.
 */

import { eq } from "drizzle-orm";
import { createDbClient } from "../db/client.js";
import { launchRuns } from "../db/schema.js";
import { runLaunchPipeline } from "../orchestrator/launch_pipeline.js";
import type { LaunchPlatform } from "../orchestrator/planner.js";
import type { SeoSurfaceSpec } from "../orchestrator/seo_pipeline.js";
import { creditWallet } from "./wallet.js";
import { auditEvent } from "./audit.js";

/** Rebuild the full pipeline input (with env-derived secrets) from a message. */
function buildPipelineInput(env: CloudflareBindings, msg: LaunchQueueMessage) {
  return {
    product_id: msg.productId,
    platforms: msg.platforms as LaunchPlatform[],
    include_video: false,
    dry_run: msg.dryRun,
    include_seo: msg.includeSeo,
    seo_surfaces: msg.seoSurfaces as SeoSurfaceSpec[] | undefined,
    seo_cost_cap_cents: msg.seoCostCapCents,
    cost_cap_cents: msg.costCapCents,
    anthropic_api_key: env.ANTHROPIC_API_KEY,
    openai_api_key: env.OPENAI_API_KEY,
    dataforseo_login: env.DATAFORSEO_LOGIN,
    dataforseo_password: env.DATAFORSEO_PASSWORD,
    env,
    existing_run_id: msg.runId,
  } as const;
}

/**
 * Run one queued launch end-to-end: pipeline → predicted-vs-actual refund →
 * audit. On crash, mark the run failed and refund the FULL up-front charge
 * (the pipeline died before recording real costs), mirroring the synchronous
 * path's crash handling. Never throws — an expensive, non-idempotent pipeline
 * must not be retried by the queue (it would duplicate assets + double-spend),
 * so we always settle and ack.
 */
export async function processLaunchMessage(
  env: CloudflareBindings,
  msg: LaunchQueueMessage
): Promise<void> {
  const db = createDbClient(env);
  try {
    await db
      .update(launchRuns)
      .set({ currentPhase: "creating" })
      .where(eq(launchRuns.id, msg.runId))
      .catch(() => {});

    const result = await runLaunchPipeline(db, buildPipelineInput(env, msg));

    if (!msg.dryRun) {
      const billedDelta = msg.predictedCents - result.total_cost_cents;
      if (billedDelta > 0) {
        await creditWallet(db, {
          tenantId: msg.tenantId,
          cents: billedDelta,
          reason: "refund",
          referenceType: "launch_run",
          referenceId: result.run_id,
        });
      }
    }

    await auditEvent(db, {
      tenantId: msg.tenantId,
      actor: (msg.actor as Parameters<typeof auditEvent>[1]["actor"]) ?? null,
      action: result.status === "succeeded" ? "launch.complete" : "launch.failed",
      targetType: "launch_run",
      targetId: result.run_id,
      metadata: {
        status: result.status,
        actual_cents: result.total_cost_cents,
        duration_ms: result.duration_ms,
        hitl_count: result.hitl_count,
      },
    });
  } catch (err) {
    console.error(
      "[launch:queue] pipeline threw:",
      err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : String(err)
    );
    await db
      .update(launchRuns)
      .set({
        status: "failed",
        durationMs: 0,
        lastError: `Pipeline threw: ${
          err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 1000) : String(err).slice(0, 1000)
        }`,
      })
      .where(eq(launchRuns.id, msg.runId))
      .catch(() => {});

    if (!msg.dryRun) {
      try {
        await creditWallet(db, {
          tenantId: msg.tenantId,
          cents: msg.predictedCents,
          reason: "refund",
          referenceType: "launch_failure",
          referenceId: msg.runId,
        });
      } catch (refundErr) {
        console.error("[launch:queue] refund FAILED — manual reconciliation required", {
          tenantId: msg.tenantId,
          runId: msg.runId,
          cents: msg.predictedCents,
          refundError: refundErr instanceof Error ? refundErr.message : String(refundErr),
        });
        await auditEvent(db, {
          tenantId: msg.tenantId,
          actor: null,
          action: "launch.refund_failed",
          targetType: "launch_run",
          targetId: msg.runId,
          metadata: { predicted_cents: msg.predictedCents },
        }).catch(() => {});
      }
    }
  }
}

/** Cloudflare queue consumer entrypoint. One launch per message. */
export async function handleLaunchQueue(
  batch: MessageBatch<LaunchQueueMessage>,
  env: CloudflareBindings
): Promise<void> {
  for (const message of batch.messages) {
    await processLaunchMessage(env, message.body);
    // Always ack: settle is terminal and the pipeline is non-idempotent, so a
    // retry would duplicate assets + double-charge. Failures are recorded on
    // the run row + audit log, not surfaced as queue retries.
    message.ack();
  }
}
