"use client";

import { useAuth, useOrganization } from "@clerk/react";
import { useCallback } from "react";
import { MCP_URL } from "./config";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
  }
}

// Decode a JWT payload (no signature check — just for logging the
// claims so we can confirm org_id is present).
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
 * Uses Clerk's getToken() to attach a session JWT to every Worker
 * request, so the requireTenant middleware can verify it and resolve
 * to a tenant. The hook returns a stable callback; pages can pass it
 * to useEffect dependency arrays without retriggering on every render.
 *
 * Usage:
 *   const apiFetch = useApiFetch();
 *   useEffect(() => {
 *     apiFetch("/api/products").then(setProducts);
 *   }, [apiFetch]);
 */
export function useApiFetch() {
  const { getToken, isSignedIn } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.id;
  return useCallback(
    async <T = unknown>(path: string, init: RequestInit = {}): Promise<T> => {
      // Explicitly scope the token to the active organization. Without
      // organizationId, getToken returns the session's cached JWT,
      // which can lag behind setActive({ organization }) and arrive at
      // the Worker without org_id → missing_org_context 401. Passing
      // organizationId forces Clerk's API to mint a fresh JWT for THIS
      // org, with org_id set.
      const token = isSignedIn
        ? await getToken({ skipCache: true, organizationId: orgId })
        : null;
      if (token && typeof console !== "undefined") {
        const payload = decodeJwtPayload(token);
        // eslint-disable-next-line no-console
        console.log("[jwt]", path, {
          org_id: payload?.org_id,
          sub: payload?.sub,
          orgIdPassed: orgId,
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
        // Surface the Worker's structured error (code + detail) into the
        // thrown message so the dashboard error UI is diagnostic rather
        // than just "401 Unauthorized". Worker shape:
        // { error: "unauthenticated", code: "missing_org_context", detail?: "..." }
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
  const { getToken, isSignedIn } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.id;
  return useCallback(
    async (path: string, fallbackFilename: string): Promise<void> => {
      // skipCache forces a fresh JWT mint on every call. Without this,
      // Clerk caches the original signed-in token (no org_id) and keeps
      // serving it even after setActive({ organization }) updates the
      // active org client-side — Worker keeps 401-ing with
      // missing_org_context. Cache miss penalty is ~50ms; correctness
      // matters more than the savings here.
      const token = isSignedIn
        ? await getToken({ skipCache: true, organizationId: orgId })
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
