"use client";

/**
 * Inline error card — replaces the previous `{error.message}` raw render
 * that made every fetch failure look like a Sentry breadcrumb leaked
 * into the UI (P0-1 in FF_DASHBOARD_FRONTEND_AUDIT.md).
 *
 * Behavior:
 * - 401/403 → "Your session expired" + Sign-in CTA
 * - 5xx → "Server is having trouble" + retry
 * - network/unknown → "Couldn't load" + retry
 * - The raw error (Error.message + status) sits behind a <details> for
 *   debugging without polluting the visible surface.
 */
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";

interface ErrorStateProps {
  title?: string;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title,
  error,
  onRetry,
  className,
}: ErrorStateProps) {
  const friendly = friendlyMessage(error);
  const detail = errorDetail(error);
  return (
    <div
      role="alert"
      className={cn(
        "rounded-m3-lg border border-error/40 bg-error-container/30",
        "px-5 py-4 md-fade-in",
        className
      )}
    >
      <div className="flex items-baseline gap-3 mb-1">
        <span className="ff-stamp-label text-error">couldn't load</span>
        <span className="md-typescale-title-small text-error-on-container">
          {title ?? friendly.title}
        </span>
      </div>
      <p className="md-typescale-body-small text-on-surface-variant">
        {friendly.body}
      </p>
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-m3-full md-typescale-label-medium bg-primary text-primary-on shadow-m3-1 hover:shadow-m3-2 transition-shadow"
          >
            ↻ Retry
          </button>
        )}
        {friendly.cta && (
          <a
            href={friendly.cta.href}
            className="md-typescale-label-medium text-primary hover:underline"
          >
            {friendly.cta.label}
          </a>
        )}
        {detail && (
          <details className="ml-auto">
            <summary className="md-typescale-label-small text-on-surface-variant/70 cursor-pointer hover:text-on-surface-variant">
              technical detail
            </summary>
            <pre className="mt-2 md-typescale-body-small font-mono text-on-surface-variant/80 whitespace-pre-wrap break-all">
              {detail}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

function friendlyMessage(error: unknown): {
  title: string;
  body: string;
  cta?: { label: string; href: string };
} {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return {
        title: "Your session expired",
        body: "Sign back in and we'll reload this view.",
        cta: { label: "Sign in →", href: "/sign-in" },
      };
    }
    if (error.status === 404) {
      return {
        title: "Not found",
        body: "This resource doesn't exist or was deleted.",
      };
    }
    if (error.status >= 500) {
      return {
        title: "Server is having trouble",
        body: "This is on us. Try again in a moment.",
      };
    }
    return {
      title: `Request failed (${error.status})`,
      body: "Something went wrong. Try again, or contact support if it persists.",
    };
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      title: "You're offline",
      body: "Reconnect and we'll retry automatically.",
    };
  }
  return {
    title: "Couldn't load this view",
    body: "Refresh, or check the API health pill in the sidebar.",
  };
}

function errorDetail(error: unknown): string | null {
  if (error instanceof ApiError) {
    return `${error.status} ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return String(error);
    }
  }
  return null;
}
