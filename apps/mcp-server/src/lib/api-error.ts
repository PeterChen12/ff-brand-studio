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
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503,
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
      err.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503
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
