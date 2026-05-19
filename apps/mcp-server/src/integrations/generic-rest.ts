/**
 * The "any company" adapter.
 *
 * Customers who don't have a bespoke FF Studio integration plug in by
 * implementing three documented endpoints (see public/tenant-api.yaml)
 * on their own backend. They paste the base URL + a generated HMAC
 * shared secret into the FF Studio dashboard; this adapter is what
 * actually makes the calls.
 *
 * The buyfishingrod-admin adapter is a thin wrapper around this — it
 * exists only to keep the "buyfishingrod-admin" provider label for
 * dashboard UX and existing audit-log compatibility.
 */

import type {
  MarketplaceAdapter,
  PublishContext,
  PublishResult,
} from "./adapter.js";
import { requireString } from "./credentials.js";
import { ApiError } from "../lib/api-error.js";

const STAGE_PATH = "/api/integrations/ff-brand-studio/stage-product";
const STATUS_UPDATE_PATH = "/api/integrations/ff-brand-studio/status-update";
const PRODUCT_FETCH_PATH = "/api/integrations/ff-brand-studio/products"; // GET .../{external_id}

interface StageEnvelope {
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
  test?: boolean;
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
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Sign + POST a JSON body to {baseUrl}{path}.
 *
 * Public so the bulk-approve callsite + the future reconciler can use
 * the exact same transport. The signature format is the contract: any
 * change here ripples to every customer's receiver.
 */
export async function signedPost(args: {
  baseUrl: string;
  path: string;
  signingSecret: string;
  body: unknown;
  eventId: string;
  timeoutMs?: number;
}): Promise<Response> {
  const url = `${args.baseUrl.replace(/\/$/, "")}${args.path}`;
  const body = JSON.stringify(args.body);
  const t = Math.floor(Date.now() / 1000);
  const sig = await hmacHex(args.signingSecret, `${t}.${body}`);
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ff-signature": `t=${t},v1=${sig}`,
      "x-ff-event-id": args.eventId,
    },
    body,
    signal: AbortSignal.timeout(args.timeoutMs ?? 15_000),
  });
}

export async function signedGet(args: {
  baseUrl: string;
  path: string;
  signingSecret: string;
  timeoutMs?: number;
}): Promise<Response> {
  const url = `${args.baseUrl.replace(/\/$/, "")}${args.path}`;
  const t = Math.floor(Date.now() / 1000);
  // For GET there's no body — sign just the timestamp + path so the
  // receiver knows the request hasn't been replayed.
  const sig = await hmacHex(args.signingSecret, `${t}.GET ${args.path}`);
  return fetch(url, {
    method: "GET",
    headers: {
      "x-ff-signature": `t=${t},v1=${sig}`,
    },
    signal: AbortSignal.timeout(args.timeoutMs ?? 10_000),
  });
}

/** Stage a product against any tenant-API-compliant receiver. */
export async function stageProductGeneric(args: {
  baseUrl: string;
  signingSecret: string;
  envelope: StageEnvelope;
}): Promise<PublishResult> {
  const res = await signedPost({
    baseUrl: args.baseUrl,
    path: STAGE_PATH,
    signingSecret: args.signingSecret,
    body: args.envelope,
    eventId: args.envelope.event_id,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(
      502,
      "tenant_stage_failed",
      `${res.status}: ${text.slice(0, 400)}`
    );
  }
  let detail: Record<string, unknown> = {};
  try {
    detail = (await res.json()) as Record<string, unknown>;
  } catch {
    // Receiver returned non-JSON — still success.
  }
  return {
    externalListingId: args.envelope.external_id ?? undefined,
    detail,
  };
}

/** Fetch the current state of a tenant-side product (P3 reconciler). */
export async function fetchProductStateGeneric(args: {
  baseUrl: string;
  signingSecret: string;
  externalId: string;
}): Promise<{
  status: string;
  url?: string;
  lastModifiedAt?: string;
} | null> {
  const res = await signedGet({
    baseUrl: args.baseUrl,
    path: `${PRODUCT_FETCH_PATH}/${encodeURIComponent(args.externalId)}`,
    signingSecret: args.signingSecret,
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new ApiError(
      502,
      "tenant_fetch_failed",
      `${res.status} fetching product state`
    );
  }
  const data = (await res.json()) as {
    status?: string;
    url?: string;
    last_modified_at?: string;
  };
  if (!data.status) return null;
  return {
    status: data.status,
    url: data.url,
    lastModifiedAt: data.last_modified_at,
  };
}

/**
 * `MarketplaceAdapter` impl. Selected from the registry when a tenant
 * picks the "generic-rest" provider from the integrations dashboard.
 * The BFR-specific adapter delegates to this same shape — only
 * difference is the `provider` label, which lets us keep a clean
 * audit trail of which integration produced which event.
 */
export const genericRestAdapter: MarketplaceAdapter = {
  provider: "generic-rest",
  label: "Generic REST (tenant-api.yaml)",
  enabled: true,
  async publishAssets(ctx: PublishContext): Promise<PublishResult> {
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
