"use client";

/**
 * Shared "now" tick — single 60s setInterval at the app root, every
 * relativeTime consumer subscribes via context. Replaces the per-render
 * Date.now() pattern in _overview-client.tsx that made stamps stale
 * until something else re-rendered. SSR-safe: returns a fixed timestamp
 * during render so hydration doesn't mismatch.
 */
import { createContext, useContext, useEffect, useState } from "react";

const NowContext = createContext<number>(0);

export function NowProvider({ children }: { children: React.ReactNode }) {
  // Start at 0 server-side; client effect kicks in real time on mount.
  const [now, setNow] = useState<number>(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return <NowContext.Provider value={now}>{children}</NowContext.Provider>;
}

export function useNow(): number {
  const ctx = useContext(NowContext);
  // Fallback to live Date.now() if a consumer is rendered outside the
  // provider (e.g. tests). The 0 sentinel means "before mount", in
  // which case formatTimestamp's defaults still produce sensible output.
  return ctx === 0 ? Date.now() : ctx;
}
