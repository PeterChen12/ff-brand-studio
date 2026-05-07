/**
 * Phase L4 — webhook subscriptions + delivery.
 *
 * Subscriptions are tenant-scoped; each carries its own HMAC-SHA256
 * secret returned exactly once on creation. Delivery payload is JSON
 * with a stable `event` envelope; consumers verify via the
 * `X-FF-Signature: t=<ts>,v1=<hex>` header (Stripe-pattern).
 *
 * Retry policy (per the inbox file): 5 attempts at 1m, 5m, 30m, 2h,
 * 12h. Workers can't run timers across requests, so the retry
 * scheduler is implemented as a "due now" pull from `webhook_deliveries`
 * fired by Phase M's queue trigger. For Phase L, deliveries fire
 * fire-and-forget with one immediate attempt; failed deliveries land
 * in webhook_deliveries with next_attempt_at populated for the future
 * scheduler to pick up.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import {
  webhookSubscriptions,
  webhookDeliveries,
  type WebhookSubscription,
} from "../db/schema.js";
import type { DbClient } from "../db/client.js";

const ATTEMPT_DELAYS_SECONDS = [60, 300, 1800, 7200, 43200];
const MAX_ATTEMPTS = ATTEMPT_DELAYS_SECONDS.length;

function genSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return `whsec_${hex}`;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

export interface CreateSubscriptionInput {
  tenantId: string;
  url: string;
  events: string[];
}

export async function createSubscription(
  db: DbClient,
  input: CreateSubscriptionInput
): Promise<{ subscription: WebhookSubscription; secret: string }> {
  const secret = genSecret();
  const [row] = await db
    .insert(webhookSubscriptions)
    .values({
      tenantId: input.tenantId,
      url: input.url,
      events: input.events,
      secret,
    })
    .returning();
  return { subscription: row, secret };
}

export async function listSubscriptions(
  db: DbClient,
  tenantId: string
): Promise<Array<Omit<WebhookSubscription, "secret">>> {
  return db
    .select({
      id: webhookSubscriptions.id,
      tenantId: webhookSubscriptions.tenantId,
      url: webhookSubscriptions.url,
      events: webhookSubscriptions.events,
      createdAt: webhookSubscriptions.createdAt,
      disabledAt: webhookSubscriptions.disabledAt,
    })
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.tenantId, tenantId))
    .orderBy(desc(webhookSubscriptions.createdAt));
}

export async function disableSubscription(
  db: DbClient,
  tenantId: string,
  id: string
): Promise<boolean> {
  const [row] = await db
    .update(webhookSubscriptions)
    .set({ disabledAt: new Date() })
    .where(and(eq(webhookSubscriptions.id, id), eq(webhookSubscriptions.tenantId, tenantId)))
    .returning();
  return !!row;
}

export interface DeliveryEvent {
  /** UUID — consumers use this for idempotency (per resolved Q2). */
  id: string;
  type: string;
  tenant_id: string;
  /** ISO-8601. */
  created_at: string;
  /** Event-specific payload. */
  data: Record<string, unknown>;
  /** Schema version for the payload — bumped only when a breaking change ships. */
  version: 1;
}

/**
 * Fire delivery for an event to all matching subscriptions for the
 * tenant. Best-effort: failures are written to webhook_deliveries with
 * next_attempt_at populated; success rows have delivered_at set.
 */
export async function deliverEvent(
  db: DbClient,
  event: DeliveryEvent
): Promise<{ attempted: number; succeeded: number; failed: number }> {
  const subs = await db
    .select()
    .from(webhookSubscriptions)
    .where(
      and(
        eq(webhookSubscriptions.tenantId, event.tenant_id),
        isNull(webhookSubscriptions.disabledAt)
      )
    );

  const matching = subs.filter((s) => s.events.includes(event.type) || s.events.includes("*"));
  let succeeded = 0;
  let failed = 0;

  for (const sub of matching) {
    const result = await deliverOne(sub, event, 1);
    if (result.delivered) {
      succeeded++;
      await db.insert(webhookDeliveries).values({
        subscriptionId: sub.id,
        eventId: event.id,
        eventType: event.type,
        payload: event,
        statusCode: result.status,
        responseBody: result.responseBody?.slice(0, 600) ?? null,
        attempt: 1,
        deliveredAt: new Date(),
      });
    } else {
      failed++;
      const nextAt = new Date(Date.now() + ATTEMPT_DELAYS_SECONDS[1] * 1000);
      await db.insert(webhookDeliveries).values({
        subscriptionId: sub.id,
        eventId: event.id,
        eventType: event.type,
        payload: event,
        statusCode: result.status,
        responseBody: result.responseBody?.slice(0, 600) ?? null,
        attempt: 1,
        nextAttemptAt: nextAt,
      });
    }
  }

  return { attempted: matching.length, succeeded, failed };
}

interface DeliveryResult {
  delivered: boolean;
  status: number | null;
  responseBody: string | null;
}

async function deliverOne(
  sub: WebhookSubscription,
  event: DeliveryEvent,
  attempt: number
): Promise<DeliveryResult> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify(event);
  const sig = await hmacHex(sub.secret, `${ts}.${body}`);
  const header = `t=${ts},v1=${sig}`;

  let res: Response;
  try {
    res = await fetch(sub.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ff-signature": header,
        "x-ff-event": event.type,
        "x-ff-event-id": event.id,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return {
      delivered: false,
      status: null,
      responseBody: err instanceof Error ? err.message : String(err),
    };
  }
  const text = await res.text().catch(() => "");
  return {
    delivered: res.ok,
    status: res.status,
    responseBody: text,
  };
}

/**
 * Phase A3 — implemented. Scheduled handler picks up deliveries whose
 * next_attempt_at is due, replays deliverOne, and either marks
 * delivered_at on success, schedules the next backoff, or marks
 * exhausted (no more next_attempt_at) when MAX_ATTEMPTS hit.
 */
export async function processDuePromise(
  db: DbClient
): Promise<{ scanned: number; delivered: number; failed: number; exhausted: number }> {
  const { lte, and: dAnd, isNull: dIsNull, lt: dLt } = await import("drizzle-orm");
  const due = await db
    .select({
      delivery: webhookDeliveries,
      subscription: webhookSubscriptions,
    })
    .from(webhookDeliveries)
    .innerJoin(
      webhookSubscriptions,
      eq(webhookDeliveries.subscriptionId, webhookSubscriptions.id)
    )
    .where(
      dAnd(
        dIsNull(webhookDeliveries.deliveredAt),
        dLt(webhookDeliveries.attempt, MAX_ATTEMPTS),
        lte(webhookDeliveries.nextAttemptAt, new Date())
      )
    )
    .limit(50);

  let delivered = 0;
  let failed = 0;
  let exhausted = 0;

  for (const row of due) {
    const sub = row.subscription;
    const d = row.delivery;
    if (sub.disabledAt) continue;

    const event = d.payload as DeliveryEvent;
    const nextAttempt = (d.attempt ?? 0) + 1;
    const result = await deliverOne(sub, event, nextAttempt);

    if (result.delivered) {
      await db
        .update(webhookDeliveries)
        .set({
          attempt: nextAttempt,
          statusCode: result.status,
          responseBody: result.responseBody?.slice(0, 600) ?? null,
          deliveredAt: new Date(),
          nextAttemptAt: null,
        })
        .where(eq(webhookDeliveries.id, d.id));
      delivered += 1;
    } else if (nextAttempt >= MAX_ATTEMPTS) {
      await db
        .update(webhookDeliveries)
        .set({
          attempt: nextAttempt,
          statusCode: result.status,
          responseBody: result.responseBody?.slice(0, 600) ?? null,
          nextAttemptAt: null,
        })
        .where(eq(webhookDeliveries.id, d.id));
      exhausted += 1;
    } else {
      const delay = ATTEMPT_DELAYS_SECONDS[nextAttempt] ?? ATTEMPT_DELAYS_SECONDS.at(-1)!;
      const next = new Date(Date.now() + delay * 1000);
      await db
        .update(webhookDeliveries)
        .set({
          attempt: nextAttempt,
          statusCode: result.status,
          responseBody: result.responseBody?.slice(0, 600) ?? null,
          nextAttemptAt: next,
        })
        .where(eq(webhookDeliveries.id, d.id));
      failed += 1;
    }
  }

  return { scanned: due.length, delivered, failed, exhausted };
}

export const WEBHOOK_RETRY_POLICY = {
  maxAttempts: MAX_ATTEMPTS,
  delaysSeconds: ATTEMPT_DELAYS_SECONDS,
};
