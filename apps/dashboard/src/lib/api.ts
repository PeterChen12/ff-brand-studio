"use client";

import { useAuth } from "@clerk/clerk-react";
import { useCallback } from "react";
import { MCP_URL } from "./config";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
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
  return useCallback(
    async <T = unknown>(path: string, init: RequestInit = {}): Promise<T> => {
      const token = isSignedIn ? await getToken() : null;
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
        throw new ApiError(res.status, body, `${res.status} ${res.statusText}`);
      }
      return body as T;
    },
    [getToken, isSignedIn]
  );
}
