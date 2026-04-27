"use client";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * NumberTicker — animates a count from 0 to `value` over `durationMs`.
 * Tabular figures so the digit ladder doesn't shift width as it ticks.
 */
export function NumberTicker({
  value,
  durationMs = 800,
  prefix = "",
  suffix = "",
  decimals = 0,
  className,
}: {
  value: number;
  durationMs?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    startRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const step = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      // ease-out cubic — fast start, gentle settle
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(value * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, durationMs]);

  const formatted = decimals
    ? shown.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    : Math.round(shown).toLocaleString("en-US");

  return (
    <span className={cn("tabular-nums font-mono", className)}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
