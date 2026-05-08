/**
 * Phase B-2 placeholder — Amazon SP-API adapter.
 *
 * Real implementation requires:
 *   1. Amazon Developer registration + SP-API approval (~1-2 weeks lead)
 *   2. Login With Amazon OAuth flow (LWA) for per-seller refresh tokens
 *   3. Feeds API integration (POST_PRODUCT_IMAGE_DATA_XML for images,
 *      POST_PRODUCT_DATA_XML for listing metadata) OR Listings Items API
 *      v2021-08-01 (REST) for the modern path.
 *
 * Until then this is a stub so the adapter registry shape is real.
 */

import type {
  MarketplaceAdapter,
  PublishContext,
  PublishResult,
} from "./adapter.js";
import { notImplemented } from "../lib/api-error.js";

export const amazonSpApiAdapter: MarketplaceAdapter = {
  provider: "amazon-sp-api",
  label: "Amazon Seller Central (SP-API)",
  enabled: false,
  async publishAssets(_ctx: PublishContext): Promise<PublishResult> {
    throw notImplemented(
      "Amazon SP-API publishing — apply for SP-API access and wire LWA OAuth first"
    );
  },
};
