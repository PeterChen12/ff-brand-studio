import { eq, sql as drizzleSql } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import { webhookInbox } from "../db/schema.js";

/**
 * Outcome of attempting to claim a webhook event for processing.
 *
 * - `"new"`        — first time we've seen this event_id; the caller
 *                    should now run its business logic AND then call
 *                    `markProcessed()` with the result.
 * - `"duplicate"` — the event was already processed; the caller MUST
 *                    short-circuit and return whatever response the
 *                    upstream expects for a successful delivery.
 */
export type ClaimResult =
  | { status: "new" }
  | { status: "duplicate"; previousResult: string | null };

interface ClaimArgs {
  eventId: string;
  source: string;
  eventType: string;
  tenantId?: string | null;
}

/**
 * Atomically claim an inbound webhook event by `event_id`. Idempotency
 * primitive used by every receiver in the FF Studio worker.
 *
 * Implementation: INSERT ... ON CONFLICT DO NOTHING. If the row was
 * inserted, the event is new; if not, the existing row is fetched and
 * its result returned to the caller.
 */
export async function claimEvent(
  db: DbClient,
  args: ClaimArgs
): Promise<ClaimResult> {
  // Reserve the slot. If we collide on the primary key, this insert
  // is a no-op and `returning()` yields an empty array.
  const inserted = await db
    .insert(webhookInbox)
    .values({
      eventId: args.eventId,
      source: args.source,
      eventType: args.eventType,
      tenantId: args.tenantId ?? null,
    })
    .onConflictDoNothing({ target: webhookInbox.eventId })
    .returning({ eventId: webhookInbox.eventId });

  if (inserted.length === 1) return { status: "new" };

  // Loser: read the row that won the race to find out the prior result.
  const [existing] = await db
    .select({ result: webhookInbox.result })
    .from(webhookInbox)
    .where(eq(webhookInbox.eventId, args.eventId))
    .limit(1);
  return { status: "duplicate", previousResult: existing?.result ?? null };
}

/**
 * Mark a previously-claimed event as fully processed. Call after the
 * business logic succeeds so a follow-up retry hits the duplicate
 * path. The `result` string is free-form telemetry surfaced back to
 * the caller on duplicate detection.
 */
export async function markProcessed(
  db: DbClient,
  eventId: string,
  result: string
): Promise<void> {
  await db
    .update(webhookInbox)
    .set({ processedAt: drizzleSql`now()`, result })
    .where(eq(webhookInbox.eventId, eventId));
}
