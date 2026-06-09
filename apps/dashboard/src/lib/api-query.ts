"use client";

/**
 * SWR wrapper that uses the dashboard's auth-aware apiFetch — every
 * page gets the same loading/empty/error contract for free, replacing
 * the buggy `apiFetch().catch(() => setData([]))` pattern that swallowed
 * errors and made fetch failures look like a fresh-tenant empty state
 * (P0-2 in FF_DASHBOARD_FRONTEND_AUDIT.md).
 *
 * Returns `{ data, error, isLoading, mutate }`. Pass `null` as the path
 * to skip a query (SWR's conditional-fetch pattern).
 */
import useSWR, { type SWRConfiguration } from "swr";
import { useCallback } from "react";
import { useApiFetch, type ApiError } from "./api";

export function useApiQuery<T>(
  path: string | null,
  opts?: SWRConfiguration<T, ApiError>
) {
  const apiFetch = useApiFetch();
  const fetcher = useCallback(
    async (p: string): Promise<T> => apiFetch<T>(p),
    [apiFetch]
  );
  const { data, error, isLoading, mutate } = useSWR<T, ApiError>(
    path,
    fetcher,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: (err) => {
        // Don't retry auth errors — user needs to re-sign-in.
        if (err && (err.status === 401 || err.status === 403)) return false;
        return true;
      },
      errorRetryInterval: 5_000,
      errorRetryCount: 2,
      ...opts,
    }
  );
  return { data, error, isLoading, mutate };
}

/**
 * Like useApiQuery, but for offset-paginated list endpoints — transparently
 * fetches EVERY page and returns the fully-accumulated response, so the UI
 * never silently shows a truncated slice. The endpoint must accept
 * `?limit=&offset=` and return `{ [listKey]: [...], hasMore: boolean }`.
 *
 * Added to remediate the silent-cap class (audit 2026-06-09): list endpoints
 * (/api/assets, /api/launches, /v1/inbox, /v1/billing/ledger) were hard-capped
 * with no pagination, so grids/metrics under-reported once a tenant grew.
 *
 * `data` keeps the first page's shape (e.g. balance_cents) with `listKey`
 * replaced by the concatenation of all pages and `hasMore` forced false.
 */
export function useApiQueryAllPages<T>(
  basePath: string | null,
  listKey: Extract<keyof T, string>,
  opts?: { pageSize?: number; maxPages?: number } & SWRConfiguration<T, ApiError>
) {
  const apiFetch = useApiFetch();
  const pageSize = opts?.pageSize ?? 100;
  const maxPages = opts?.maxPages ?? 100;
  const fetcher = useCallback(
    async (p: string): Promise<T> => {
      let offset = 0;
      let first: Record<string, unknown> | null = null;
      const acc: unknown[] = [];
      for (let i = 0; i < maxPages; i++) {
        const sep = p.includes("?") ? "&" : "?";
        const res = (await apiFetch<T>(
          `${p}${sep}limit=${pageSize}&offset=${offset}`
        )) as Record<string, unknown>;
        if (!first) first = res;
        const chunk = Array.isArray(res[listKey]) ? (res[listKey] as unknown[]) : [];
        acc.push(...chunk);
        if (res.hasMore !== true || chunk.length === 0) break;
        offset += chunk.length;
      }
      return { ...(first ?? {}), [listKey]: acc, hasMore: false } as T;
    },
    [apiFetch, listKey, pageSize, maxPages]
  );
  const { data, error, isLoading, mutate } = useSWR<T, ApiError>(
    basePath,
    fetcher,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: (err) => {
        if (err && (err.status === 401 || err.status === 403)) return false;
        return true;
      },
      errorRetryInterval: 5_000,
      errorRetryCount: 2,
      ...opts,
    }
  );
  return { data, error, isLoading, mutate };
}
