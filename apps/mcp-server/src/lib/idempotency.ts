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

/**
 * @param options.releaseOnFailure  When true, a non-2xx response (or a thrown
 *   handler) DROPS the reserved key so the client can retry with the same key
 *   instead of being locked out (a cached error / 24h tombstone). ONLY safe on
 *   routes where a non-success provably means NO charge committed — i.e. the
 *   wallet debit is the LAST op inside the insert transaction and nothing can
 *   throw after the transaction commits (POST /v1/products). Do NOT enable it
 *   on charge-before-insert routes (e.g. /v1/products/ingest) — there a 5xx
 *   after the charge would release the key and a retry would double-charge.
 *   Default false = Stripe-style tombstone (cache every response, never
 *   re-charge), which is the safe choice for /launches and /ingest.
 */
export function idempotencyMiddleware(options: { releaseOnFailure?: boolean } = {}) {
  const releaseOnFailure = options.releaseOnFailure === true;
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

    // Drop the reserved key so the client can retry with the SAME key rather
    // than being locked out. Only used when releaseOnFailure is enabled (a
    // money-safe route where a non-success means no charge committed).
    const releaseKey = () =>
      db
        .delete(idempotencyKeys)
        .where(and(eq(idempotencyKeys.tenantId, tenant.id), eq(idempotencyKeys.keyHash, keyHash)))
        .then(() => {})
        .catch((e) => console.warn("[idempotency] key release failed", e));

    try {
      await next();
    } catch (err) {
      // A throw means the handler errored. On a releaseOnFailure route the
      // charge can only commit on the success path, so a throw ⇒ no charge ⇒
      // safe to release for retry. On a default (tombstone) route we leave the
      // in-flight row so a retry can't re-run a possibly-charged handler.
      if (releaseOnFailure) await releaseKey();
      throw err;
    }

    const resp = c.res;
    const is2xx = !!resp && resp.status >= 200 && resp.status < 300;

    if (releaseOnFailure && resp && !is2xx) {
      // Non-2xx on a money-safe route: the handler did NOT commit a charge
      // (debit is the last op in the tx; insufficient-funds rolls back to a
      // 402; nothing throws after commit). Drop the key so the client can
      // retry — including a 402 that becomes payable after a top-up — with
      // zero double-charge risk.
      await releaseKey();
      return;
    }

    // Cache the handler's response so a genuine duplicate (e.g. the auto-retry
    // of a request whose 2xx response was lost in transit) REPLAYS it instead
    // of re-charging. Re-read via clone since c.res is already consumed.
    try {
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
