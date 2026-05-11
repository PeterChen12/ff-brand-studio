/**
 * Phase B (B4) + Phase F · Iter 02 — adapter for buyfishingrod-admin.
 *
 * Previous version (Phase B B4) was a stub throwing notImplemented; the
 * Stage Product workflow in Phase E iter 02 worked around it by using
 * the per-asset webhook fan-out via bulk-approve.
 *
 * F2 fills in the real publishAssets impl: POSTs a single product-level
 * envelope to BFR's /api/integrations/ff-brand-studio/stage-product
 * endpoint with HMAC signature. The BFR-side endpoint is owned by
 * another agent and MUST ship dormant (receive + 200 OK, no caller)
 * before this adapter is allowed to go live. See PHASE_F_SAFETY_RESEARCH.md
 * "F2 safety" section.
 *
 * Feature-flag gated by `tenant.features.adapter_stage_enabled` so we
 * can ship the studio code and turn it on per-tenant only after the
 * BFR-side receiver is confirmed deployed.
 */

import type {
  MarketplaceAdapter,
  PublishContext,
  PublishResult,
} from "./adapter.js";
import { ApiError } from "../lib/api-error.js";

/** Default BFR base URL; overridable via integration_credentials row. */
const DEFAULT_BFR_BASE_URL = "https://admin.buyfishingrod.com";

const ENDPOINT_PATH = "/api/integrations/ff-brand-studio/stage-product";

/** Envelope sent to BFR. Shape is the contract — changes need BFR-side
 *  coordination. */
interface StageEnvelope {
  external_id: string | null;
  external_source: "ff-brand-studio";
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

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

/**
 * Public entry point — accepts a webhook secret + base URL override
 * so the adapter can be tested with arbitrary endpoints. Production
 * call site reads these from worker env (`FF_STUDIO_WEBHOOK_SECRET`)
 * and the tenant's integration_credentials row.
 */
export async function stageBfrProduct(args: {
  envelope: StageEnvelope;
  baseUrl?: string;
  signingSecret: string;
}): Promise<PublishResult> {
  const url = `${(args.baseUrl ?? DEFAULT_BFR_BASE_URL).replace(/\/$/, "")}${ENDPOINT_PATH}`;
  const body = JSON.stringify(args.envelope);
  const t = Math.floor(Date.now() / 1000);
  const sig = await hmacHex(args.signingSecret, `${t}.${body}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ff-signature": `t=${t},v1=${sig}`,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(
      502,
      "bfr_stage_failed",
      `BFR /stage-product returned ${res.status}: ${text.slice(0, 400)}`
    );
  }
  let detail: Record<string, unknown> = {};
  try {
    detail = (await res.json()) as Record<string, unknown>;
  } catch {
    // BFR returned non-JSON; treat as success-with-no-detail.
  }
  return {
    externalListingId: args.envelope.external_id ?? undefined,
    detail,
  };
}

export const buyfishingrodAdminAdapter: MarketplaceAdapter = {
  provider: "buyfishingrod-admin",
  label: "buyfishingrod-admin (stage)",
  enabled: true,
  async publishAssets(ctx: PublishContext): Promise<PublishResult> {
    const features = (ctx.tenant.features ?? {}) as Record<string, unknown>;
    if (features.adapter_stage_enabled !== true) {
      throw new ApiError(
        503,
        "adapter_stage_disabled",
        "Set tenant.features.adapter_stage_enabled=true to use the BFR adapter. " +
          "Use the bulk-approve + webhook fan-out path otherwise."
      );
    }
    // Read signing secret from the worker env via globalThis (the registry
    // doesn't pass env down today). In production this comes from
    // FF_STUDIO_WEBHOOK_SECRET (same secret as the existing webhook
    // subscription). The receiver verifies with the same shared secret.
    const env = (globalThis as { ENV?: Record<string, string | undefined> }).ENV;
    const signingSecret =
      env?.FF_STUDIO_WEBHOOK_SECRET ??
      env?.BFR_STAGE_SIGNING_SECRET ??
      "";
    if (!signingSecret) {
      throw new ApiError(
        500,
        "missing_signing_secret",
        "FF_STUDIO_WEBHOOK_SECRET not bound to the worker — set it via `wrangler secret put`."
      );
    }
    const envelope: StageEnvelope = {
      external_id: ctx.externalId,
      external_source: "ff-brand-studio",
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
    return stageBfrProduct({ envelope, signingSecret });
  },
};
