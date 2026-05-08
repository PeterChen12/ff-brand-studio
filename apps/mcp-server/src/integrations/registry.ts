/**
 * Phase B (B2) — adapter registry.
 *
 * Single import surface for the rest of the worker. To add a new
 * marketplace, drop a file in this directory implementing
 * MarketplaceAdapter and add it to ALL_ADAPTERS below.
 */

import type { MarketplaceAdapter } from "./adapter.js";
import { buyfishingrodAdminAdapter } from "./buyfishingrod-admin.js";
import { amazonSpApiAdapter } from "./amazon-sp-api.js";
import { shopifyAdminAdapter } from "./shopify-admin.js";

const ALL_ADAPTERS: MarketplaceAdapter[] = [
  buyfishingrodAdminAdapter,
  amazonSpApiAdapter,
  shopifyAdminAdapter,
];

const BY_PROVIDER = new Map<string, MarketplaceAdapter>(
  ALL_ADAPTERS.map((a) => [a.provider, a])
);

export function getAdapter(provider: string): MarketplaceAdapter | null {
  return BY_PROVIDER.get(provider) ?? null;
}

export function listAdapters(): MarketplaceAdapter[] {
  return ALL_ADAPTERS.slice();
}

export function listEnabledAdapters(): MarketplaceAdapter[] {
  return ALL_ADAPTERS.filter((a) => a.enabled);
}
