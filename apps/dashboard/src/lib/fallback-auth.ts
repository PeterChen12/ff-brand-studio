"use client";

/**
 * Fallback auth — bypasses Clerk entirely.
 *
 * When Clerk is unreachable / rate-limited / mis-keyed and the dashboard
 * can't mint a session JWT, an operator can hand the user a URL like
 *     https://ff-brand-studio.pages.dev/?ff_api_key=ff_live_XXXX
 * which:
 *   1. Persists the key to localStorage under FALLBACK_KEY_STORAGE_KEY.
 *   2. Strips the param from the URL so it doesn't leak via referrer.
 *   3. Causes useApiFetch + Shell auth gate to ignore Clerk and use the
 *      key as the Bearer token instead. Worker's verifyApiKey already
 *      accepts ff_live_* tokens (apps/mcp-server/src/lib/api-keys.ts).
 *
 * The key bypasses the Clerk-side org/user model entirely — the worker
 * resolves the tenant directly from api_keys.tenant_id. So an org_id
 * claim is not required on a fallback request.
 *
 * Clear with ?ff_logout=1 or by calling clearFallbackKey().
 */

import { useSyncExternalStore } from "react";

const FALLBACK_KEY_STORAGE_KEY = "ff_fallback_api_key";
const URL_PARAM = "ff_api_key";
const URL_LOGOUT_PARAM = "ff_logout";

const listeners = new Set<() => void>();
function notify() {
  for (const fn of listeners) fn();
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function readKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(FALLBACK_KEY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getFallbackKey(): string | null {
  return readKey();
}

export function setFallbackKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FALLBACK_KEY_STORAGE_KEY, key);
    notify();
  } catch {
    /* storage disabled */
  }
}

export function clearFallbackKey(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(FALLBACK_KEY_STORAGE_KEY);
    notify();
  } catch {
    /* storage disabled */
  }
}

/**
 * React hook — returns current fallback key (or null), reactive to
 * changes from URL capture, manual set/clear, and cross-tab storage
 * events.
 */
export function useFallbackKey(): string | null {
  return useSyncExternalStore(
    (cb) => {
      const unsub = subscribe(cb);
      const onStorage = (e: StorageEvent) => {
        if (e.key === FALLBACK_KEY_STORAGE_KEY) cb();
      };
      if (typeof window !== "undefined") {
        window.addEventListener("storage", onStorage);
      }
      return () => {
        unsub();
        if (typeof window !== "undefined") {
          window.removeEventListener("storage", onStorage);
        }
      };
    },
    () => readKey(),
    () => null
  );
}

/**
 * Run once on app mount. Captures ?ff_api_key=... / ?ff_logout=1 from
 * the URL, applies the side-effect, and strips the param so the URL
 * doesn't leak the key via Referer or browser history sharing.
 *
 * Safe to call multiple times — subsequent calls without the param
 * are no-ops.
 */
export function captureFallbackKeyFromUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  let changed = false;
  const logoutParam = url.searchParams.get(URL_LOGOUT_PARAM);
  if (logoutParam !== null) {
    clearFallbackKey();
    url.searchParams.delete(URL_LOGOUT_PARAM);
    changed = true;
  }
  const keyParam = url.searchParams.get(URL_PARAM);
  if (keyParam && keyParam.startsWith("ff_live_")) {
    setFallbackKey(keyParam);
    url.searchParams.delete(URL_PARAM);
    changed = true;
  }
  if (changed) {
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }
}
