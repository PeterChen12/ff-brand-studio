/**
 * Phase B (B2) — marketplace adapter interface.
 *
 * The pipeline is platform-agnostic: it produces R2 assets + listings
 * tagged with a `platform` string ("amazon" | "shopify" | "buyfishingrod-admin"
 * | etc.). When an asset is approved, the adapter registry (registry.ts)
 * looks up matching adapters per the tenant's `tenants.features.publish_destinations`
 * array and calls publishAssets on each.
 *
 * Adapters can be:
 *   - "true" marketplace pushers (SP-API, Shopify Admin GraphQL) — Phase B-2
 *   - "customer admin" delivery (POST to a customer's webhook listener
 *     with HMAC) — shipping in B4 alongside this file
 *
 * Failures throw; the registry handles retry/audit. Adapters MUST be
 * idempotent — retries are part of normal operation.
 */

import type { Tenant } from "../db/schema.js";

export interface PublishedAsset {
  /** Slot identifier the platform uses internally (e.g. "MAIN", "PT01"). */
  slot: string;
  /** Public R2 URL the marketplace can fetch. */
  r2Url: string;
  width: number | null;
  height: number | null;
  format: string | null;
}

export interface PublishedListing {
  language: string;
  title: string;
  bullets: string[];
  description: string;
}

export interface PublishContext {
  tenant: Tenant;
  productId: string;
  variantId: string;
  externalId: string | null;
  externalSource: string | null;
  sku: string;
  assets: PublishedAsset[];
  listings?: PublishedListing[];
}

export interface PublishResult {
  externalListingUrl?: string;
  externalListingId?: string;
  /** Adapter-specific debug info — surfaced in the audit log. */
  detail?: Record<string, unknown>;
}

export interface MarketplaceAdapter {
  /** Stable provider id; used as the lookup key in the registry. */
  readonly provider: string;
  /** Human label for logs and the audit trail. */
  readonly label: string;
  /** True if the adapter currently has a viable implementation. */
  readonly enabled: boolean;
  publishAssets(ctx: PublishContext): Promise<PublishResult>;
}
