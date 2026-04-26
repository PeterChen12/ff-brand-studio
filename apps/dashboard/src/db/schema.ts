/**
 * Dashboard re-exports the API contract types from the shared @ff/types
 * package. The schema definitions live in packages/types/src/api.ts and
 * are the single source of truth for the dashboard ↔ Worker boundary.
 *
 * If we ever split this into a separate repo, @ff/types becomes a
 * published npm package and this file is the only consumer that needs
 * to flip its import.
 */
export type { AssetRow, RunCostRow } from "@ff/types";
export {
  AssetRowSchema,
  RunCostRowSchema,
  ApiAssetsResponseSchema,
  ApiRunsResponseSchema,
  ApiCostsResponseSchema,
} from "@ff/types";
export type {
  ApiAssetsResponse,
  ApiRunsResponse,
  ApiCostsResponse,
} from "@ff/types";
