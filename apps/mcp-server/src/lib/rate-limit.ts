/**
 * Phase U2 — per-tenant rate limiter on Postgres (replaces the
 * earlier Upstash Redis path; we have plenty of Postgres infra
 * already and don't want a Redis dependency).
 *
 * Fixed-window counter: bucket_key = floor(now_seconds / WINDOW)
 * scopes the count to the current minute. Atomic INSERT...ON
 * CONFLICT upserts the row with count++ in a single round-trip
 * (~10-15ms vs Upstash's 30-50ms over the public REST endpoint —
 * Postgres is on the same VPC as the Worker connection).
 *
 * Plan-aware:
 *   free   →  60 req/min
 *   pro    → 600 req/min
 *   enterprise → 6000 req/min
 *
 * Per-tenant override via tenant.features.rate_limit_per_min.
 * Disable entirely with tenant.features.rate_limit_disabled.
 *
 * Opportunistic 1% cleanup on every increment — bucket rows older
 * than the current window are deleted so the table stays bounded
 * without a cron.
 */

import { sql } from "drizzle-orm";
import type { Context, Next } from "hono";
import { createDbClient } from "../db/client.js";
import type { Tenant } from "../db/schema.js";

const WINDOW_SECONDS = 60;
const CLEANUP_PROBABILITY = 0.01;

const PLAN_LIMITS: Record<string, number> = {
  free: 60,
  starter: 60,
  pro: 600,
  enterprise: 6000,
};

function limitForTenant(tenant: Tenant): number | null {
  const features = (tenant.features ?? {}) as {
    rate_limit_per_min?: number;
    rate_limit_disabled?: boolean;
  };
  if (features.rate_limit_disabled) return null;
  if (typeof features.rate_limit_per_min === "number" && features.rate_limit_per_min > 0) {
    return features.rate_limit_per_min;
  }
  return PLAN_LIMITS[tenant.plan] ?? PLAN_LIMITS.free;
}

interface CounterResult {
  count: number;
  reset: number;
}

/**
 * Atomic upsert + return current count. Uses a single round-trip via
 * INSERT...ON CONFLICT...DO UPDATE...RETURNING.
 *
 * Bucket key: epoch second / WINDOW. Resets at the next bucket
 * boundary. Returns null if the table doesn't exist (migration not
 * applied) so callers fail open.
 */
async function incrementWindow(
  env: CloudflareBindings,
  tenantId: string
): Promise<CounterResult | null> {
  const now = Math.floor(Date.now() / 1000);
  const bucketKey = Math.floor(now / WINDOW_SECONDS);
  const reset = (bucketKey + 1) * WINDOW_SECONDS;

  try {
    const db = createDbClient(env);
    const rows = await db.execute(sql`
      INSERT INTO rate_limit_buckets (tenant_id, bucket_key, count)
      VALUES (${tenantId}::uuid, ${bucketKey}::bigint, 1)
      ON CONFLICT (tenant_id, bucket_key)
      DO UPDATE SET count = rate_limit_buckets.count + 1
      RETURNING count
    `);
    const r = rows as unknown as Array<{ count: number }>;
    const count = r[0]?.count ?? 1;

    // Opportunistic cleanup — 1% chance per request to GC old buckets
    // for this tenant. Bounded table size without a cron.
    if (Math.random() < CLEANUP_PROBABILITY) {
      void db
        .execute(sql`
          DELETE FROM rate_limit_buckets
          WHERE tenant_id = ${tenantId}::uuid
            AND bucket_key < ${bucketKey}::bigint
        `)
        .catch(() => undefined);
    }
    return { count, reset };
  } catch (err) {
    console.warn("[rate-limit] postgres increment failed:", err);
    return null;
  }
}

export async function rateLimitMiddleware(
  c: Context<{ Bindings: CloudflareBindings; Variables: { tenant: Tenant } }>,
  next: Next
): Promise<Response | void> {
  const tenant = c.get("tenant");
  if (!tenant) {
    await next();
    return;
  }
  const limit = limitForTenant(tenant);
  if (limit === null) {
    await next();
    return;
  }

  const counter = await incrementWindow(c.env, tenant.id);
  if (!counter) {
    // DB unreachable or migration missing — fail open. Logging here
    // would spam in dev; the warning above fires once per request.
    await next();
    return;
  }

  const remaining = Math.max(0, limit - counter.count);
  c.header("X-RateLimit-Limit", String(limit));
  c.header("X-RateLimit-Remaining", String(remaining));
  c.header("X-RateLimit-Reset", String(counter.reset));

  if (counter.count > limit) {
    const retryAfter = Math.max(1, counter.reset - Math.floor(Date.now() / 1000));
    c.header("Retry-After", String(retryAfter));
    return c.json(
      {
        error: "rate_limited",
        limit,
        remaining: 0,
        retry_after_seconds: retryAfter,
      },
      429
    );
  }

  await next();
}
