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
