/**
 * Plain TS types for the v1 dashboard's read-only views.
 *
 * Was previously inferred from drizzle pgTable definitions; switched to
 * hand-written types so the dashboard package can drop drizzle-orm,
 * postgres, and drizzle-kit (the static-export build never executes them).
 *
 * Shape MUST stay in sync with apps/mcp-server/src/db/schema.ts assets +
 * runCosts. Phase C (API contract) will pin this via shared Zod schemas.
 */

export interface AssetRow {
  id: string;
  r2Key: string;
  assetType: string;
  campaign: string | null;
  platform: string | null;
  locale: string | null;
  brandScore: number | null;
  metadata: unknown;
  createdAt: string | null;
}

export interface RunCostRow {
  id: string;
  campaign: string | null;
  runAt: string | null;
  gptImage2Calls: number | null;
  fluxCalls: number | null;
  klingCalls: number | null;
  claudeInputTokens: number | null;
  claudeOutputTokens: number | null;
  totalCostUsd: string | null;
}
