/**
 * Phase I — Image sidecar client.
 *
 * The sidecar runs Node + sharp in apps/image-sidecar. We talk to it
 * over HTTPS with an HMAC-SHA256 signature over `{ts}.{body_sha256}`
 * keyed on IMAGE_SIDECAR_SECRET. R2 keys flow as the only payload —
 * image bytes never cross this hop, the sidecar reads/writes R2 itself.
 *
 * Failures are loud — we surface them as PipelineError so the orchestrator
 * can bail (sidecar down ⇒ pipeline returns sidecar_unavailable, not a
 * silent partial result). The production_pipeline feature flag should
 * already gate these calls so a missing sidecar is invisible to tenants
 * who haven't opted in.
 */

import type { PipelineError } from "./types.js";

interface SidecarConfig {
  url: string;
  secret: string;
}

function getConfig(env: CloudflareBindings): SidecarConfig | { error: PipelineError } {
  if (!env.IMAGE_SIDECAR_URL || !env.IMAGE_SIDECAR_SECRET) {
    return {
      error: {
        kind: "config_missing",
        field: !env.IMAGE_SIDECAR_URL ? "IMAGE_SIDECAR_URL" : "IMAGE_SIDECAR_SECRET",
      },
    };
  }
  return {
    url: env.IMAGE_SIDECAR_URL.replace(/\/$/, ""),
    secret: env.IMAGE_SIDECAR_SECRET,
  };
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

async function sha256Hex(message: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message));
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Call a sidecar endpoint. Returns either the parsed JSON or a
 * PipelineError describing what went wrong.
 */
export async function callSidecar<TReq, TRes>(
  env: CloudflareBindings,
  path: string,
  body: TReq
): Promise<{ ok: true; data: TRes } | { ok: false; error: PipelineError }> {
  const cfg = getConfig(env);
  if ("error" in cfg) return { ok: false, error: cfg.error };

  const json = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000).toString();
  const bodyHash = await sha256Hex(json);
  const signature = await hmacSha256Hex(cfg.secret, `${ts}.${bodyHash}`);

  let res: Response;
  try {
    res = await fetch(`${cfg.url}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ff-timestamp": ts,
        "x-ff-signature": signature,
      },
      body: json,
      // Sidecar should respond in <30s for crops; larger composites <60s.
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "sidecar_unavailable",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      error: {
        kind: "provider_error",
        provider: "image-sidecar",
        status: res.status,
        message: text.slice(0, 500),
      },
    };
  }

  try {
    const data = (await res.json()) as TRes;
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "provider_error",
        provider: "image-sidecar",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// ── Endpoint payload contracts (mirrored in apps/image-sidecar) ──

export interface DeriveRequest {
  inputKey: string;
  outputPrefix: string;
  kind: string;
  /** Per-kind padding pct override; defaults to the deriver's setting. */
  paddingPct?: number;
}

export interface DeriveResponse {
  studioKey: string;
  cropAKey: string;
  cropBKey: string;
  cropCKey: string;
  detectedAspect: number;
  millis: number;
}

export interface CompositeTextRequest {
  backgroundKey: string;
  outputKey: string;
  specs: string[];
  brandHex: string;
  watermarkText?: string;
}

export interface CompositeTextResponse {
  outputKey: string;
  millis: number;
}

export interface BannerExtendRequest {
  inputKey: string;
  outputKey: string;
  /** Aspect ratio target, default "16:9". */
  aspect?: string;
  /** Hex background color for the gradient extension. */
  brandHex: string;
}

export interface BannerExtendResponse {
  outputKey: string;
  millis: number;
}

export interface ForceWhiteRequest {
  inputKey: string;
  outputKey: string;
  /** Default 8 — pixels with min(r,g,b) >= 255-tolerance snap to #ffffff. */
  tolerance?: number;
}

export interface ForceWhiteResponse {
  outputKey: string;
  fillPct: number;
  millis: number;
}
