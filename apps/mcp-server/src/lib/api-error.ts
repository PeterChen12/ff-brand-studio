import type { Context } from "hono";
import { nanoid } from "nanoid";

/**
 * P0-3 + P2-1 — single error response shape across the worker.
 *
 * Every handler should either:
 *   - return JSON with the standard shape: `{ error: { code, message, detail? } }`
 *   - throw an ApiError (preferred — keeps handlers concise) and let
 *     `app.onError` format it
 *   - throw any other Error and let `app.onError` log + return a generic
 *     `internal_error` response with a request_id the client can quote
 *     to support
 *
 * Goal: stop leaking raw Error.message (DB connection strings, stack
 * fragments, model API quotas) to the dashboard. The frontend
 * ErrorState already special-cases `code` to render friendly copy.
 */

export interface ApiErrorBody {
  code: string;
  message: string;
  detail?: unknown;
}

export class ApiError extends Error {
  status: number;
  code: string;
  detail?: unknown;
  constructor(
    status: number,
    code: string,
    message: string,
    detail?: unknown
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export function jsonError(
  c: Context,
  status: 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 | 501 | 503,
  code: string,
  message: string,
  detail?: unknown
) {
  return c.json(
    { error: { code, message, ...(detail !== undefined && { detail }) } },
    status
  );
}

/**
 * Wire as `app.onError(handleAppError)` on the Hono app. Logs the full
 * error server-side and returns a sanitized response — the request_id
 * is in both the log line and the JSON so support can correlate.
 */
export function handleAppError(err: Error, c: Context): Response {
  const requestId = c.get("requestId") ?? nanoid(10);
  if (err instanceof ApiError) {
    // Known shape — pass through, log at warn level
    console.warn(
      `[api-error] ${requestId} ${err.status} ${err.code} — ${err.message}`,
      err.detail ?? ""
    );
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          ...(err.detail !== undefined && { detail: err.detail }),
        },
        request_id: requestId,
      },
      err.status as 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 | 501 | 503
    );
  }
  // Anything else is unexpected — log full stack, return opaque 500.
  console.error(`[api-error] ${requestId} unhandled`, err);
  return c.json(
    {
      error: {
        code: "internal_error",
        message:
          "Something went wrong on our end. Quote the request_id when contacting support.",
      },
      request_id: requestId,
    },
    500
  );
}

/**
 * Tiny middleware — assigns a request_id to every request so handlers
 * + the onError formatter can reference the same id. Cheap (nanoid),
 * safe (per-request), useful (correlatable across logs).
 */
export async function requestIdMiddleware(c: Context, next: () => Promise<void>) {
  c.set("requestId", nanoid(10));
  await next();
}

// ─── Phase B (B7) — canonical error code taxonomy ──────────────────
//
// Stripe-style stable string codes that customer integrations can
// branch on. Adding a new code = additive change; removing one is a
// breaking change to API consumers, so don't.
//
// Documented at /docs/api/errors (hand-edited markdown, not generated).

export const ApiErrorCode = {
  // Auth & rate
  AUTH_MISSING: "auth_missing",
  AUTH_INVALID: "auth_invalid",
  RATE_LIMITED: "rate_limited",

  // Validation & shape
  VALIDATION_ERROR: "validation_error",
  PRODUCT_NOT_FOUND: "product_not_found",
  ASSET_NOT_FOUND: "asset_not_found",
  RUN_NOT_FOUND: "run_not_found",

  // Idempotency
  IDEMPOTENCY_CONFLICT: "idempotency_conflict",
  IDEMPOTENCY_IN_FLIGHT: "idempotency_in_flight",

  // Wallet & billing
  WALLET_INSUFFICIENT: "wallet_insufficient",
  WALLET_DEBIT_FAILED: "wallet_debit_failed",

  // Ingestion (B1)
  EXTERNAL_ID_CONFLICT: "external_id_conflict",
  REFERENCE_UNREACHABLE: "reference_unreachable",
  REFERENCE_TOO_LARGE: "reference_too_large",
  REFERENCE_BAD_CONTENT_TYPE: "reference_bad_content_type",

  // Marketplace (B2/B6)
  MARKETPLACE_CREDENTIAL_MISSING: "marketplace_credential_missing",
  MARKETPLACE_TOKEN_EXPIRED: "marketplace_token_expired",
  MARKETPLACE_PUBLISH_FAILED: "marketplace_publish_failed",

  // Catch-all
  INTERNAL_ERROR: "internal_error",
  NOT_IMPLEMENTED: "not_implemented",
} as const;

export type ApiErrorCodeType =
  (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/**
 * Convenience throwers for the most common error shapes. These keep
 * handler code dense + readable: `throw walletInsufficient(50, 30)`
 * vs. a multi-line `new ApiError(...)`.
 */
export function walletInsufficient(
  requiredCents: number,
  balanceCents: number
): ApiError {
  return new ApiError(
    402,
    ApiErrorCode.WALLET_INSUFFICIENT,
    `Wallet balance (${balanceCents}¢) is below required (${requiredCents}¢). Top up at /billing.`,
    { required_cents: requiredCents, balance_cents: balanceCents }
  );
}

export function validationError(
  message: string,
  param?: string,
  detail?: unknown
): ApiError {
  return new ApiError(
    422,
    ApiErrorCode.VALIDATION_ERROR,
    message,
    param ? { param, ...(detail as object | undefined) } : detail
  );
}

export function externalIdConflict(
  externalSource: string,
  externalId: string,
  existingProductId: string
): ApiError {
  return new ApiError(
    409,
    ApiErrorCode.EXTERNAL_ID_CONFLICT,
    `external_id '${externalId}' from source '${externalSource}' already maps to product ${existingProductId}.`,
    { external_source: externalSource, external_id: externalId, product_id: existingProductId }
  );
}

export function referenceUnreachable(url: string, status?: number): ApiError {
  return new ApiError(
    422,
    ApiErrorCode.REFERENCE_UNREACHABLE,
    `Could not fetch reference image: ${url}${status ? ` (HTTP ${status})` : ""}.`,
    { url, status }
  );
}

export function notImplemented(feature: string): ApiError {
  return new ApiError(
    501,
    ApiErrorCode.NOT_IMPLEMENTED,
    `${feature} is not implemented yet. See PHASE_B_ITERATION.md for status.`
  );
}
