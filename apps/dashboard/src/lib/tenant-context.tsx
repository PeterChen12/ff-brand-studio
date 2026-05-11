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

export interface TenantFeatures {
  brand_hex?: string;
  default_platforms?: string[];
  amazon_a_plus_grid?: boolean;
  rate_limit_per_min?: number;
  production_pipeline?: boolean;
  feedback_regen?: boolean;
  has_sample_access?: boolean;
  max_regens_per_month?: number;
  // Phase C · Iteration 03 — tenant defaults read by the launch wizard
  // so per-launch radios can hide behind a "Tweak this run" disclosure.
  default_output_langs?: ("en" | "zh")[];
  default_quality_preset?: "budget" | "balanced" | "premium";
  // Phase C · Iteration 05 — folds API keys + Webhooks into one
  // Advanced tab that's always visible; no gating yet.
  developer_mode?: boolean;
  // Phase E · Iter 02 — adapter keys this tenant has configured for
  // one-click "Stage Product" pushes (e.g. ["buyfishingrod-admin"]).
  // Absent or empty array → the Stage Product button routes the
  // operator to /settings?tab=channels instead of POSTing.
  publish_destinations?: string[];
  // Any additional flags surfaced server-side land in this Record bag.
  [key: string]: unknown;
}

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
