"use client";

import { useEffect, useMemo, useState } from "react";
import { useApiFetch } from "@/lib/api";
import { Card, CardEyebrow, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface AuditEvent {
  id: string;
  tenantId: string;
  actor: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  at: string | null;
}

interface AuditResponse {
  events: AuditEvent[];
  hasMore: boolean;
  nextOffset: number | null;
}

const ALL_ACTIONS = [
  "tenant.created",
  "launch.start",
  "launch.complete",
  "launch.failed",
  "listing.edit",
  "listing.publish",
  "product.create",
  "wallet.debit",
  "wallet.credit",
  "wallet.refund",
  "billing.stripe_topup",
];

export function AuditTab() {
  const apiFetch = useApiFetch();
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [actions, setActions] = useState<string[]>([]);
  const [actor, setActor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", "100");
    p.set("offset", String(offset));
    if (actions.length > 0) p.set("actions", actions.join(","));
    if (actor.trim()) p.set("actor", actor.trim());
    return p.toString();
  }, [offset, actions, actor]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiFetch<AuditResponse>(`/v1/audit?${params}`)
      .then((d) => {
        setRows((prev) => (offset === 0 ? d.events : [...prev, ...d.events]));
        setHasMore(d.hasMore);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [apiFetch, params, offset]);

  function toggleAction(a: string) {
    setOffset(0);
    setActions((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]
    );
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card className="md-fade-in">
      <CardHeader>
        <div>
          <CardEyebrow>Audit log · 审计日志</CardEyebrow>
          <CardTitle className="mt-1.5">Recent platform activity</CardTitle>
        </div>
        <span className="md-typescale-body-small text-on-surface-variant">
          {rows.length} event{rows.length === 1 ? "" : "s"}
        </span>
      </CardHeader>

      <div className="px-6 pb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={actor}
          onChange={(e) => {
            setOffset(0);
            setActor(e.target.value);
          }}
          placeholder="Filter by actor (Clerk user_id)…"
          className="flex-1 min-w-[220px] h-9 px-3 rounded-m3-full bg-surface-container border ff-hairline md-typescale-body-small focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <details className="relative">
          <summary className="cursor-pointer h-9 px-3 rounded-m3-full bg-surface-container border ff-hairline md-typescale-label-medium inline-flex items-center">
            Actions{actions.length > 0 ? ` (${actions.length})` : ""}
          </summary>
          <div className="absolute right-0 mt-2 z-10 w-72 max-h-72 overflow-auto md-surface-container rounded-m3-md border ff-hairline shadow-m3-2 p-3 grid gap-1">
            {ALL_ACTIONS.map((a) => (
              <label
                key={a}
                className="flex items-center gap-2 md-typescale-body-small cursor-pointer px-2 py-1 rounded-m3-sm hover:bg-surface-container-high"
              >
                <input
                  type="checkbox"
                  checked={actions.includes(a)}
                  onChange={() => toggleAction(a)}
                />
                <span className="font-mono text-[0.75rem]">{a}</span>
              </label>
            ))}
          </div>
        </details>
      </div>

      <div className="px-6 pb-6">
        {error && (
          <div className="md-typescale-body-medium text-error mb-3">{error}</div>
        )}
        {rows.length === 0 && !loading ? (
          <div className="text-center py-12 md-typescale-body-medium text-on-surface-variant">
            No audit events match.
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => toggleExpanded(row.id)}
                className="w-full text-left rounded-m3-md border ff-hairline md-surface-container-low px-4 py-3 hover:bg-surface-container transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Badge variant={actionVariant(row.action)} size="sm">
                      {row.action}
                    </Badge>
                    <span className="md-typescale-body-small text-on-surface-variant truncate">
                      {row.actor ?? "system"}
                    </span>
                  </div>
                  <span className="md-typescale-body-small text-on-surface-variant/70 font-mono text-[0.6875rem] tabular-nums shrink-0">
                    {row.at ? new Date(row.at).toLocaleString() : "—"}
                  </span>
                </div>
                {expanded.has(row.id) && (
                  <pre className="mt-3 p-3 rounded-m3-sm bg-surface-container md-typescale-body-small font-mono text-[0.6875rem] overflow-auto">
                    {JSON.stringify(
                      {
                        targetType: row.targetType,
                        targetId: row.targetId,
                        metadata: row.metadata,
                      },
                      null,
                      2
                    )}
                  </pre>
                )}
              </button>
            ))}
            {loading && (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            )}
            {hasMore && !loading && (
              <button
                type="button"
                onClick={() => setOffset((o) => o + 100)}
                className="w-full mt-3 h-9 rounded-m3-full md-surface-container-low border ff-hairline md-typescale-label-medium hover:bg-surface-container"
              >
                Show 100 more
              </button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function actionVariant(
  action: string
): "passed" | "pending" | "flagged" | "neutral" {
  if (action.startsWith("launch.complete") || action.startsWith("listing.publish"))
    return "passed";
  if (action.startsWith("launch.failed") || action.includes("revoked"))
    return "flagged";
  if (action.startsWith("wallet.")) return "pending";
  return "neutral";
}
