"use client";

import { useAuth } from "@clerk/react";
import { useCallback } from "react";
import { MCP_URL } from "./config";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "===".slice(0, (4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/**
 * Phase G — auth-aware fetch wrapper.
 *
 * Source of truth for active org is `useAuth().orgId`. Server-side org
 * activation is owned by `OrgGate` (which calls `setActive` once on
 * mount). Do NOT call `session.touch()` here — it gets rate-limited
 * (429) when fired on every request and the touch failure leaves the
 * mint endpoint with stale state, producing tokens with no `org_id`.
 */
export function useApiFetch() {
  const { getToken, isSignedIn, orgId } = useAuth();
  return useCallback(
    async <T = unknown>(path: string, init: RequestInit = {}): Promise<T> => {
      const token = isSignedIn
        ? await getToken({ skipCache: true, organizationId: orgId ?? undefined })
        : null;
      if (token && typeof console !== "undefined") {
        const payload = decodeJwtPayload(token);
        // Use console.warn so the diagnostic survives filters that hide
        // info-level logs. The JWT is a transient bearer with a 60s TTL
        // and is already going to the network anyway — logging the
        // claims has no marginal exposure. Dump full payload so we can
        // see if Clerk is putting org context under a different key
        // (e.g. compact `o.id` instead of `org_id`).
        // eslint-disable-next-line no-console
        console.warn("[jwt]", path, {
          org_id: payload?.org_id,
          sub: payload?.sub,
          orgIdFromUseAuth: orgId,
          allClaims: payload,
        });
      }
      const headers = new Headers(init.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
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
        if (typeof console !== "undefined") {
          // eslint-disable-next-line no-console
          console.warn("[api]", msg, body);
        }
        throw new ApiError(res.status, body, msg);
      }
      return body as T;
    },
    [getToken, isSignedIn, orgId]
  );
}

/**
 * Auth-aware download. Streams a blob from the Worker and triggers a
 * browser save with the server's Content-Disposition filename. Use for
 * binary endpoints (e.g. /v1/tenant/export, /v1/audit?format=csv).
 */
export function useApiDownload() {
  const { getToken, isSignedIn, orgId } = useAuth();
  return useCallback(
    async (path: string, fallbackFilename: string): Promise<void> => {
      const token = isSignedIn
        ? await getToken({ skipCache: true, organizationId: orgId ?? undefined })
        : null;
      const headers = new Headers();
      if (token) headers.set("Authorization", `Bearer ${token}`);
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
    [getToken, isSignedIn, orgId]
  );
}
