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

      const res = await fetch(`${MCP_URL}${path}`, { ...init, headers });
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      if (!res.ok) {
        const b = body as { code?: string; detail?: string } | null;
        const codePart = b?.code ? ` · ${b.code}` : "";
        const detailPart = b?.detail ? ` (${b.detail})` : "";
        const msg = `${res.status} ${res.statusText}${codePart}${detailPart} — ${path}`;
        throw new ApiError(res.status, body, msg);
      }
      return body as T;
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
