/**
 * Phase A4 — Idempotency-Key middleware (Stripe pattern).
 *
 * Clients send `Idempotency-Key: <opaque>` on POST. The middleware:
 *   1. Hashes the key + tenant for storage
 *   2. SELECTs the cached row; on hit with matching request-hash, replays
 *      the original response (status + body) byte-for-byte
 *   3. On miss, records request_hash, lets the handler run, and stores the
 *      response on the way out
 *
 * Mismatch (same key, different request body) → 409 idempotency_conflict.
 *
 * TTL: rows older than 24h are purged by the scheduled sweeper.
 *
 * Scope: enabled per-route via `idempotencyMiddleware()` factory; the
 * launch endpoint is the obvious first consumer (network retries on a
 * 2-min request are normal).
 */

import type { Context, Next } from "hono";
import { eq, and } from "drizzle-orm";
import { idempotencyKeys, type Tenant } from "../db/schema.js";
import { createDbClient } from "../db/client.js";

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

export function idempotencyMiddleware() {
  return async function (c: Context, next: Next): Promise<Response | void> {
    if (c.req.method !== "POST") {
      await next();
      return;
    }
    const key = c.req.header("idempotency-key") ?? c.req.header("Idempotency-Key");
    if (!key) {
      await next();
      return;
    }

    const tenant = c.get("tenant") as Tenant | undefined;
    if (!tenant) {
      await next();
      return;
    }

    const body = await c.req.text();
    // Re-attach the body so the downstream handler can json() it.
    // Hono's c.req.json() reads from the same source, but only once;
    // we override the request internals so re-reads work.
    (c.req as unknown as { _bodyOverride: string })._bodyOverride = body;
    const origJson = c.req.json.bind(c.req);
    c.req.json = async () => {
      try {
        return JSON.parse(body);
      } catch {
        return origJson();
      }
    };

    const keyHash = await sha256Hex(`${tenant.id}:${key}`);
    const requestHash = await sha256Hex(body);
    const db = createDbClient(c.env);

    const [existing] = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.tenantId, tenant.id), eq(idempotencyKeys.keyHash, keyHash)))
      .limit(1);

    if (existing) {
      if (existing.requestHash !== requestHash) {
        return c.json(
          {
            error: {
              code: "idempotency_conflict",
              message:
                "Idempotency-Key was reused with a different request body — pick a fresh key.",
            },
          },
          409
        );
      }
      if (existing.responseStatus && existing.responseBody) {
        // Replay cached response.
        return c.json(existing.responseBody, existing.responseStatus as 200);
      }
      // In-flight (first request still running). Tell the client to retry.
      return c.json(
        {
          error: {
            code: "idempotency_in_flight",
            message: "An earlier request with this Idempotency-Key is still in progress.",
          },
        },
        409
      );
    }

    // Reserve the key BEFORE the handler runs so concurrent retries see the
    // in-flight row. response_* are nullable; we fill them on the way out.
    try {
      await db.insert(idempotencyKeys).values({
        tenantId: tenant.id,
        keyHash,
        requestHash,
      });
    } catch (err) {
      // Race: a concurrent request inserted first. Fall through to
      // duplicate-key check on the next iteration. Simplest: reject and
      // let client retry.
      return c.json(
        {
          error: {
            code: "idempotency_in_flight",
            message: "Concurrent request with same Idempotency-Key — retry shortly.",
          },
        },
        409
      );
    }

    await next();

    // Cache the handler's response. Re-read via clone since c.res is
    // already consumed by the time we get here.
    try {
      const resp = c.res;
      if (resp) {
        const cloned = resp.clone();
        const respBody = await cloned.json().catch(() => null);
        await db
          .update(idempotencyKeys)
          .set({ responseStatus: resp.status, responseBody: respBody })
          .where(and(eq(idempotencyKeys.tenantId, tenant.id), eq(idempotencyKeys.keyHash, keyHash)));
      }
    } catch (err) {
      console.warn("[idempotency] cache-on-egress failed", err);
    }
    return;
  };
}
