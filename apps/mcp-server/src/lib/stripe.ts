/**
 * Stripe wrapper — Phase H3.
 *
 * Lazy-instantiated (per request) so cold starts don't pay the Stripe
 * SDK construction cost when Stripe isn't being touched. The Worker
 * runtime keeps the SDK module cached across requests on warm
 * isolates anyway.
 *
 * The 4 top-up tiers map to Stripe Price IDs stored as env vars. We
 * look them up by amount; custom amounts go through `price_data` in
 * Checkout Session create instead.
 */

import Stripe from "stripe";

let cached: Stripe | null = null;

export function getStripe(env: CloudflareBindings): Stripe {
  if (cached) return cached;
  cached = new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });
  return cached;
}

export function priceIdForAmount(
  env: CloudflareBindings,
  amountCents: number
): string | null {
  switch (amountCents) {
    case 1000:
      return env.STRIPE_PRICE_TOPUP_10 || null;
    case 2500:
      return env.STRIPE_PRICE_TOPUP_25 || null;
    case 5000:
      return env.STRIPE_PRICE_TOPUP_50 || null;
    case 10000:
      return env.STRIPE_PRICE_TOPUP_100 || null;
    default:
      return null;
  }
}

/** Webhook idempotency — reject duplicates within a 24h window. */
export async function checkWebhookIdempotency(
  env: CloudflareBindings,
  eventId: string
): Promise<boolean> {
  const key = `stripe_webhook:${eventId}`;
  const seen = await env.SESSION_KV.get(key);
  if (seen) return false;
  await env.SESSION_KV.put(key, "1", { expirationTtl: 86_400 });
  return true;
}
