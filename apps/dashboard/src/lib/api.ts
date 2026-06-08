"use client";

import { useAuth } from "@clerk/react";
import { useCallback } from "react";
import { MCP_URL } from "./config";
import { useFallbackKey } from "./fallback-auth";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
  }
}

/**
 * Auth-aware fetch wrapper.
 *
 * Token precedence:
 *   1. ff_live_* fallback key from `?ff_api_key=` URL param (escape hatch
 *      when Clerk is down / mis-configured).
 *   2. Clerk session JWT via getToken().
 *
 * The Worker resolves the active organization from the JWT's `sub`
 * claim if `org_id` isn't present — so the dashboard no longer depends
 * on a Clerk JWT template being configured with `org_id: {{org.id}}`.
 * When the user is in multiple orgs, we send `X-Org-Id` to
 * disambiguate; the server returns 409 ambiguous_org otherwise.
 */
export function useApiFetch() {
  const { getToken, isSignedIn, orgId } = useAuth();
  const fallbackKey = useFallbackKey();
  return useCallback(
    async <T = unknown>(path: string, init: RequestInit = {}): Promise<T> => {
      let token: string | null = null;
      if (fallbackKey) {
        token = fallbackKey;
      } else if (isSignedIn) {
        try {
          token = await getToken({ skipCache: true, organizationId: orgId ?? undefined });
        } catch (clerkErr) {
          const msg = clerkErr instanceof Error ? clerkErr.message : String(clerkErr);
          throw new ApiError(
            401,
            { code: "clerk_token_unavailable", detail: msg },
            `Auth unavailable — ${msg.slice(0, 120)}`
          );
        }
      }
      const headers = new Headers(init.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      // Forward the active org for server-side resolution. The Worker
      // accepts this for any user authenticated via Clerk JWT and
      // verifies membership before trusting it.
      if (orgId && !fallbackKey) headers.set("X-Org-Id", orgId);
      if (!headers.has("Content-Type") && init.body) {
        headers.set("Content-Type", "application/json");
      }

      // Resilience: Workers cold-start and the network occasionally drop a
      // request ("Failed to fetch"), and the worker can return a transient
      // 5xx/429. Retry those a few times with backoff so a one-off blip
      // doesn't dead-end the user mid-flow. Deterministic 4xx (auth,
      // validation, out-of-stock) are NOT retried — they won't change.
      const MAX_ATTEMPTS = 3;
      const BACKOFF_MS = [400, 1200];
      let lastNetworkErr: unknown = null;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        let res: Response;
        try {
          res = await fetch(`${MCP_URL}${path}`, { ...init, headers });
        } catch (networkErr) {
          // fetch() itself rejected (TypeError "Failed to fetch"): DNS,
          // CORS, connection reset, offline. Retry, then surface a clear
          // network-level ApiError instead of a raw TypeError.
          lastNetworkErr = networkErr;
          if (attempt < MAX_ATTEMPTS - 1) {
            await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
            continue;
          }
          const detail =
            lastNetworkErr instanceof Error ? lastNetworkErr.message : String(lastNetworkErr);
          throw new ApiError(
            0,
            { code: "network_unreachable", detail },
            `Network unreachable — couldn't reach the service (${detail}). Check your connection and retry. — ${path}`
          );
        }

        const text = await res.text();
        let body: unknown = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = text;
        }
        if (!res.ok) {
          // Retry transient server states; fail fast on everything else.
          const transient = res.status === 429 || res.status >= 500;
          if (transient && attempt < MAX_ATTEMPTS - 1) {
            await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
            continue;
          }
          const b = body as { code?: string; detail?: string } | null;
          const codePart = b?.code ? ` · ${b.code}` : "";
          const detailPart = b?.detail ? ` (${b.detail})` : "";
          const msg = `${res.status} ${res.statusText}${codePart}${detailPart} — ${path}`;
          throw new ApiError(res.status, body, msg);
        }
        return body as T;
      }
      // Unreachable — the loop either returns or throws — but TS needs it.
      throw new ApiError(0, { code: "network_unreachable" }, `Network unreachable — ${path}`);
    },
    [getToken, isSignedIn, orgId, fallbackKey]
  );
}

/**
 * Auth-aware download. Streams a blob from the Worker and triggers a
 * browser save with the server's Content-Disposition filename. Use for
 * binary endpoints (e.g. /v1/tenant/export, /v1/audit?format=csv).
 */
export function useApiDownload() {
  const { getToken, isSignedIn, orgId } = useAuth();
  const fallbackKey = useFallbackKey();
  return useCallback(
    async (path: string, fallbackFilename: string): Promise<void> => {
      const token = fallbackKey
        ? fallbackKey
        : isSignedIn
        ? await getToken({ skipCache: true, organizationId: orgId ?? undefined })
        : null;
      const headers = new Headers();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      if (orgId && !fallbackKey) headers.set("X-Org-Id", orgId);
      const res = await fetch(`${MCP_URL}${path}`, { headers });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new ApiError(res.status, text, `${res.status} ${res.statusText}`);
      }
      const cd = res.headers.get("content-disposition") ?? "";
      const m = cd.match(/filename="?([^";]+)"?/);
      const filename = m?.[1] ?? fallbackFilename;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    [getToken, isSignedIn, orgId, fallbackKey]
  );
}
