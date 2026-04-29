/**
 * Money + duration formatters — shared across the dashboard.
 *
 * Single source of truth so /launch, /costs, /billing, /library, and
 * the wallet pill never disagree on shape (we used to mix `$X.XX`
 * with raw `¢` strings, which made operators mentally convert).
 */

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  if (cents === 0) return "$0.00";
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms <= 0) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}
