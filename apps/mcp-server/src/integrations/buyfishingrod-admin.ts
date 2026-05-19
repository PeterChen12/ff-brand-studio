/**
 * BuyFishingRod admin adapter.
 *
 * P2 — after the generic-rest adapter shipped, this file is a thin
 * labelled wrapper. It exists to:
 *   1. Keep `provider="buyfishingrod-admin"` as a stable id for the
 *      audit log + dashboard UX, even though the on-the-wire calls
 *      are identical to generic-rest.
 *   2. Carry the `adapter_stage_enabled` feature-flag gate so the
 *      registry-driven fan-out path (`publishAssets`) can stay opt-in
 *      while bulk-approve uses stageBfrProduct() directly.
 *
 * If you're integrating a new ecommerce admin to FF Studio, do NOT
 * copy this file — implement the tenant-api OpenAPI contract on your
 * side and pick "generic-rest" as your provider in the dashboard.
 */

import type {
  MarketplaceAdapter,
  PublishContext,
  PublishResult,
} from "./adapter.js";
import { ApiError } from "../lib/api-error.js";
import { requireString } from "./credentials.js";
import {
  stageProductGeneric,
  fetchProductStateGeneric,
} from "./generic-rest.js";

/** Envelope sent to BFR. Exported for use by the bulk-approve callsite.
 *  Shape matches the public tenant-api spec — changes need a spec bump. */
export interface StageEnvelope {
  external_id: string | null;
  external_source: "ff-brand-studio";
  event_id: string;
  sku: string;
  product_id: string;
  variant_id: string;
  name: { en?: string; zh?: string };
  copy?: Record<string, unknown>;
  images: Array<{
    slot: string;
    r2_url: string;
    width: number | null;
    height: number | null;
    format: string | null;
  }>;
  staged_at: string;
}

/**
 * Direct stage push — used by bulk-approve which doesn't go through
 * the adapter registry. Thin wrapper over stageProductGeneric so all
 * BFR-bound requests follow the same transport contract.
 */
export async function stageBfrProduct(args: {
  envelope: StageEnvelope;
  baseUrl?: string;
  signingSecret: string;
}): Promise<PublishResult> {
  return stageProductGeneric({
    baseUrl: args.baseUrl ?? "https://admin.buyfishingrod.com",
    signingSecret: args.signingSecret,
    envelope: args.envelope,
  });
}

/**
 * Reconciler helper — used by P3 cron to fetch current BFR state for a
 * product. Defers to the generic implementation.
 */
export async function fetchBfrProductState(args: {
  baseUrl: string;
  signingSecret: string;
  externalId: string;
}) {
  return fetchProductStateGeneric(args);
}

export const buyfishingrodAdminAdapter: MarketplaceAdapter = {
  provider: "buyfishingrod-admin",
  label: "BuyFishingRod admin (BFR dogfood)",
  enabled: true,
  async publishAssets(ctx: PublishContext): Promise<PublishResult> {
    const features = (ctx.tenant.features ?? {}) as Record<string, unknown>;
    if (features.adapter_stage_enabled !== true) {
      throw new ApiError(
        503,
        "adapter_stage_disabled",
        "Set tenant.features.adapter_stage_enabled=true to use the BFR adapter. " +
          "Otherwise bulk-approve drives the BFR push directly."
      );
    }
    const baseUrl = requireString(ctx.credentials.config, "baseUrl");
    const signingSecret = requireString(ctx.credentials.config, "signingSecret");
    const envelope: StageEnvelope = {
      external_id: ctx.externalId,
      external_source: "ff-brand-studio",
      event_id: `stage:${ctx.productId}:${crypto.randomUUID().slice(0, 12)}`,
      sku: ctx.sku,
      product_id: ctx.productId,
      variant_id: ctx.variantId,
      name: {},
      images: ctx.assets.map((a) => ({
        slot: a.slot,
        r2_url: a.r2Url,
        width: a.width,
        height: a.height,
        format: a.format,
      })),
      staged_at: new Date().toISOString(),
    };
    if (ctx.listings && ctx.listings.length > 0) {
      const copy: Record<string, unknown> = {};
      for (const l of ctx.listings) {
        copy[l.language] = {
          title: l.title,
          bullets: l.bullets,
          description: l.description,
        };
      }
      envelope.copy = copy;
    }
    return stageProductGeneric({ baseUrl, signingSecret, envelope });
  },
};
