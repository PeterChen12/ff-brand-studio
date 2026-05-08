/**
 * Phase B (B4 server-side counterpart) — adapter for buyfishingrod-admin.
 *
 * BFR's admin already has /api/products/[id]/images (single-asset
 * insert) and we don't want to spam N requests for N assets, so this
 * adapter posts a single envelope to a new POST /api/integrations/ff-brand-studio/webhook
 * endpoint on BFR's side (defined in buyfishingrod-admin/app/api/integrations/...).
 *
 * The webhook listener on BFR's side does the actual ProductImage + Product
 * row updates; our job here is just to deliver the envelope with HMAC.
 *
 * Credentials live in integration_credentials with provider='buyfishingrod-admin-webhook':
 *   - base_url: e.g. "https://admin.buyfishingrod.com"
 *   - signing_secret: HMAC shared secret (same shape as webhook subscriptions)
 *
 * The existing webhook delivery path in lib/webhooks.ts is the simpler
 * path here — we let the operator subscribe to asset.approved via
 * /v1/webhooks pointing at BFR's listener URL. This adapter is only
 * needed if the customer requires a synchronous push at approval time
 * instead of the async webhook fan-out. v1 leaves it as a stub.
 */

import type {
  MarketplaceAdapter,
  PublishContext,
  PublishResult,
} from "./adapter.js";
import { notImplemented } from "../lib/api-error.js";

export const buyfishingrodAdminAdapter: MarketplaceAdapter = {
  provider: "buyfishingrod-admin",
  label: "buyfishingrod-admin (webhook)",
  enabled: false,
  async publishAssets(_ctx: PublishContext): Promise<PublishResult> {
    // v1 — customer admins receive assets via the standard webhook
    // fan-out (asset.approved event). This synchronous adapter path
    // is only worth implementing if a customer needs ack-on-approval
    // semantics; nothing requires it today.
    throw notImplemented(
      "Direct publish to buyfishingrod-admin (use the asset.approved webhook subscription instead)"
    );
  },
};
