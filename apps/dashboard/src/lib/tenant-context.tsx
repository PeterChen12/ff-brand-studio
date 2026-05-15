"use client";

/**
 * TenantContext — exposes the current tenant snapshot (features,
 * onboarding state) to any descendant of <TenantProvider>.
 *
 * The Shell already polls /v1/me/state for the wallet pill; this
 * context piggybacks on the same poll so the launch wizard can read
 * `default_platforms` (and any other tenant feature flag) without
 * duplicating the network call. Consumers that don't care about
 * tenant data simply don't call useTenant().
 *
 * Returns null until the first poll resolves — consumers must handle
 * the null state with a sensible fallback (don't gate critical UI
 * on tenant data loading; auth-edge cases would block the dashboard).
 */

import { createContext, useContext } from "react";
import type { TenantFeatures } from "@ff/types";

// Phase G · G01 — single source of truth lives in @ff/types now.
// Re-export so existing `import { TenantFeatures } from "@/lib/tenant-context"`
// call sites keep working without a sweep.
export type { TenantFeatures } from "@ff/types";

export interface TenantSnapshot {
  id: string;
  name: string;
  plan: string;
  features: TenantFeatures;
}

const TenantContext = createContext<TenantSnapshot | null>(null);

export function useTenant(): TenantSnapshot | null {
  return useContext(TenantContext);
}

export function TenantProvider({
  value,
  children,
}: {
  value: TenantSnapshot | null;
  children: React.ReactNode;
}) {
  return (
    <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
  );
}
