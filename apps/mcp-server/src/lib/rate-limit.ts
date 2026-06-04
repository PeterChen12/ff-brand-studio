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

// ── IP-based limiter for unauthenticated routes (e.g. /demo/*) ───────────
//
// Phase 0 P0.6 — the per-tenant `rateLimitMiddleware` above no-ops when
// `c.get("tenant")` is unset (no auth header / no api key), so unauth'd
// endpoints fell through with no ceiling. Demo routes still trigger paid
// pipelines (SEO copy ~$0.10-0.50/call), making them a wallet-drain
// vector even though dry_run defaults to true.
//
// SHA-256(ip) is used as the bucket key to avoid storing raw IPs (PII).
// `scope` parameter lets different unauth'd surfaces have independent
// budgets — e.g. /demo gets 10/hr while a future public health probe
// could have a separate budget.

const IP_WINDOW_SECONDS = 60 * 60; // 1-hour fixed window
const DEFAULT_IP_LIMIT_PER_HOUR = 10;

async function sha256Hex(input: string): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return new Uint8Array(buf);
}

async function incrementIpWindow(
  env: CloudflareBindings,
  ipHash: Uint8Array,
  scope: string
): Promise<CounterResult | null> {
  const now = Math.floor(Date.now() / 1000);
  const bucketKey = Math.floor(now / IP_WINDOW_SECONDS);
  const reset = (bucketKey + 1) * IP_WINDOW_SECONDS;

  try {
    const db = createDbClient(env);
    const rows = await db.execute(sql`
      INSERT INTO rate_limit_ip_buckets (ip_hash, scope, bucket_key, count)
      VALUES (${ipHash}::bytea, ${scope}, ${bucketKey}::bigint, 1)
      ON CONFLICT (ip_hash, scope, bucket_key)
      DO UPDATE SET count = rate_limit_ip_buckets.count + 1
      RETURNING count
    `);
    const r = rows as unknown as Array<{ count: number }>;
    const count = r[0]?.count ?? 1;

    if (Math.random() < CLEANUP_PROBABILITY) {
      void db
        .execute(sql`
          DELETE FROM rate_limit_ip_buckets
          WHERE bucket_key < ${bucketKey}::bigint
        `)
        .catch(() => undefined);
    }
    return { count, reset };
  } catch (err) {
    console.warn("[rate-limit-ip] postgres increment failed:", err);
    return null;
  }
}

export function ipRateLimitMiddleware(
  scope: string,
  limitPerHour: number = DEFAULT_IP_LIMIT_PER_HOUR
) {
  return async (
    c: Context<{ Bindings: CloudflareBindings }>,
    next: Next
  ): Promise<Response | void> => {
    // Cloudflare populates CF-Connecting-IP for every request. Fall back to
    // X-Forwarded-For (first hop) for local/dev contexts, then to a
    // constant so we still apply *some* ceiling rather than failing open
    // to unlimited.
    const ip =
      c.req.header("cf-connecting-ip") ||
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";

    const ipHash = await sha256Hex(ip);
    const counter = await incrementIpWindow(c.env, ipHash, scope);
    if (!counter) {
      // Migration not yet applied or DB unreachable — fail open with a
      // single warning rather than 500ing the demo flow.
      await next();
      return;
    }

    const remaining = Math.max(0, limitPerHour - counter.count);
    c.header("X-RateLimit-Limit", String(limitPerHour));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(counter.reset));
    c.header("X-RateLimit-Scope", scope);

    if (counter.count > limitPerHour) {
      const retryAfter = Math.max(1, counter.reset - Math.floor(Date.now() / 1000));
      c.header("Retry-After", String(retryAfter));
      return c.json(
        {
          error: "rate_limited",
          scope,
          limit: limitPerHour,
          remaining: 0,
          retry_after_seconds: retryAfter,
        },
        429
      );
    }

    await next();
  };
}
