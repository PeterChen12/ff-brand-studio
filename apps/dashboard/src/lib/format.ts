/**
 * Money + duration + timestamp formatters — shared across the dashboard.
 *
 * Single source of truth so /launch, /costs, /billing, /library, and the
 * wallet pill never disagree on shape (we used to mix `$X.XX` with raw
 * `¢` strings, and dates rendered three different ways across pages).
 */
import {
  format,
  formatDistanceToNowStrict,
  isValid,
  parseISO,
} from "date-fns";

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  if (cents === 0) return "$0.00";
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Phase C · Iteration 05 — friendly status labels.
 *
 * The DB stores raw enums (`succeeded`, `hitl_blocked`, `cost_capped`,
 * `failed`, `pending`, `running`) — engineering language a marketer
 * doesn't speak. This helper translates at the rendering boundary so
 * we never leak `hitl_blocked` into a badge.
 */
export function friendlyStatus(status: string | null | undefined): string {
  if (!status) return "—";
  const map: Record<string, string> = {
    succeeded: "Done",
    hitl_blocked: "Needs review",
    cost_capped: "Hit budget cap",
    failed: "Failed",
    pending: "Pending",
    running: "Running",
    queued: "Queued",
    draft: "Draft",
    approved: "Approved",
    rejected: "Rejected",
    pending_review: "Needs review",
  };
  if (map[status]) return map[status];
  return status
    .split(/[_\s]+/)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms <= 0) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Date formatter modes:
 * - relative: "2m ago", "3h ago", "5d ago", then "May 4" past 7d
 * - short:    "May 4, 2026" (locale-stable across rows)
 * - long:     "May 4, 2026, 11:23 AM" (with time)
 *
 * Pass `now` to drive relative renders from a useNow() context tick so
 * stamps stay live without per-component intervals.
 */
export function formatTimestamp(
  iso: string | null | undefined,
  mode: "relative" | "short" | "long" = "relative",
  now: number = Date.now()
): string {
  if (!iso) return "—";
  const d = parseISO(iso);
  if (!isValid(d)) return "—";
  if (mode === "relative") {
    const diff = now - d.getTime();
    if (diff < 60_000) return "just now";
    if (diff < 7 * 86_400_000) {
      return `${formatDistanceToNowStrict(d, { addSuffix: false })} ago`;
    }
    return format(d, "MMM d, yyyy");
  }
  if (mode === "long") return format(d, "MMM d, yyyy · h:mm a");
  return format(d, "MMM d, yyyy");
}
