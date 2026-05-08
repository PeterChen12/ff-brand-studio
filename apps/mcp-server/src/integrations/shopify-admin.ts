/**
 * Phase B-2 placeholder — Shopify Admin GraphQL adapter.
 *
 * Real implementation requires:
 *   1. Shopify Partner account + a custom app definition
 *   2. OAuth install flow per tenant (write_products scope)
 *   3. productCreate + productUpdate mutations for listings
 *   4. stagedUploadsCreate + productCreateMedia for image uploads
 *
 * Until then this is a stub so the adapter registry shape is real.
 */

import type {
  MarketplaceAdapter,
  PublishContext,
  PublishResult,
} from "./adapter.js";
import { notImplemented } from "../lib/api-error.js";

export const shopifyAdminAdapter: MarketplaceAdapter = {
  provider: "shopify-admin",
  label: "Shopify Admin (GraphQL)",
  enabled: false,
  async publishAssets(_ctx: PublishContext): Promise<PublishResult> {
    throw notImplemented(
      "Shopify Admin publishing — register a Partner app and wire OAuth first"
    );
  },
};
