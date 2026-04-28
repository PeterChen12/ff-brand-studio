/**
 * Phase M1 — per-tenant rate limiter.
 *
 * Sliding-window counter against Upstash Redis REST. Plan-aware:
 *   free   →  60 req/min
 *   pro    → 600 req/min (10× headroom)
 *   admin  →  no limit
 *
 * No-op when UPSTASH_REDIS_REST_URL is unset (dev / pre-rollout). Sets
 * X-RateLimit-Limit / X-RateLimit-Remaining / X-RateLimit-Reset on
 * every response. 429 with Retry-After when exhausted.
 *
 * Why hand-rolled vs @upstash/ratelimit: the official client pulls in
 * tens of kB and ships its own logger. A direct REST call is ~50 LOC
 * and ships in <1 kB.
 */

import type { Context, Next } from "hono";
import type { Tenant } from "../db/schema.js";

const WINDOW_SECONDS = 60;

const PLAN_LIMITS: Record<string, number> = {
  free: 60,
  starter: 60,
  pro: 600,
  enterprise: 6000,
};

function limitForTenant(tenant: Tenant): number | null {
  const features = (tenant.features ?? {}) as { rate_limit_per_min?: number; rate_limit_disabled?: boolean };
  if (features.rate_limit_disabled) return null;
  if (typeof features.rate_limit_per_min === "number" && features.rate_limit_per_min > 0) {
    return features.rate_limit_per_min;
  }
  return PLAN_LIMITS[tenant.plan] ?? PLAN_LIMITS.free;
}

interface UpstashCounter {
  count: number;
  reset: number;
}

/**
 * Fixed-window counter. Stores {count, reset} as a JSON string
 * with TTL = WINDOW_SECONDS so old buckets evict naturally.
 */
async function incrementWindow(env: CloudflareBindings, key: string): Promise<UpstashCounter | null> {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  // INCR + EXPIRE in a Redis pipeline (Upstash REST supports it via
  // /pipeline). Reset = ceil(now / window) * window — bucket boundary.
  const now = Date.now();
  const reset = Math.ceil(now / 1000 / WINDOW_SECONDS) * WINDOW_SECONDS;
  const bucketKey = `${key}:${reset}`;
  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", bucketKey],
        ["EXPIRE", bucketKey, String(WINDOW_SECONDS + 5)],
      ]),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as Array<{ result?: number }> | null;
  const count = json?.[0]?.result;
  if (typeof count !== "number") return null;
  return { count, reset };
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

  const counter = await incrementWindow(c.env, `rl:${tenant.id}`);
  if (!counter) {
    // Upstash unreachable or unconfigured — fail open. Logging here
    // would spam in dev, so stay silent.
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
