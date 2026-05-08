"use client";

/**
 * Phase B (F4) — operator HITL inbox.
 *
 * Lists every run currently in `hitl_blocked` across visible tenants
 * so an operator can triage the FAIR-rated assets without hunting
 * through /library + filters. Click into a run, approve / reject each
 * asset; approvals fire `asset.approved` webhooks (which buyfishingrod-
 * admin and other customer admins subscribe to).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useApiFetch } from "@/lib/api";
import { formatCents } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardContent,
  CardEyebrow,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PlatformAssetRow } from "@/db/schema";

interface InboxRun {
  id: string;
  tenantId: string;
  productId: string | null;
  status: string;
  createdAt: string | null;
  durationMs: number | null;
  totalCostCents: number | null;
}

interface InboxResponse {
  runs: InboxRun[];
}

interface AssetsResponse {
  platformAssets: PlatformAssetRow[];
}

export default function InboxClient() {
  const apiFetch = useApiFetch();
  const [runs, setRuns] = useState<InboxRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<InboxRun | null>(null);
  const [assets, setAssets] = useState<PlatformAssetRow[] | null>(null);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);

  const loadRuns = useCallback(() => {
    setError(null);
    apiFetch<InboxResponse>("/v1/inbox")
      .then((r) => setRuns(r.runs))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [apiFetch]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const openRun = useCallback(
    (run: InboxRun) => {
      setSelected(run);
      setAssets(null);
      // Reuse existing /api/assets endpoint (legacy) for filtered fetch.
      // Filter client-side by variant → product → run association is
      // brittle; instead pull all assets for this tenant and filter by
      // status='draft' + low compliance. Simple and adequate for v1.
      apiFetch<AssetsResponse>("/api/assets")
        .then((r) => {
          const inReview = r.platformAssets.filter(
            (a) => a.status !== "approved" && a.status !== "rejected"
          );
          setAssets(inReview);
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    },
    [apiFetch]
  );

  const approveAsset = useCallback(
    async (assetId: string) => {
      setBusyAssetId(assetId);
      try {
        await apiFetch(`/v1/assets/${assetId}/approve`, { method: "POST" });
        setAssets((prev) =>
          prev ? prev.filter((a) => a.id !== assetId) : prev
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyAssetId(null);
      }
    },
    [apiFetch]
  );

  const rejectAsset = useCallback(
    async (assetId: string) => {
      const reason = window.prompt("Reject reason (optional):") ?? "";
      setBusyAssetId(assetId);
      try {
        await apiFetch(`/v1/assets/${assetId}/reject`, {
          method: "POST",
          body: JSON.stringify({ reason }),
          headers: { "content-type": "application/json" },
        });
        setAssets((prev) =>
          prev ? prev.filter((a) => a.id !== assetId) : prev
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyAssetId(null);
      }
    },
    [apiFetch]
  );

  const headerCount = useMemo(
    () => (runs ? `${runs.length} run${runs.length === 1 ? "" : "s"} pending review` : "—"),
    [runs]
  );

  return (
    <main className="container mx-auto px-6 py-8 space-y-6">
      <PageHeader
        eyebrow="Operator inbox · 审核队列"
        title="HITL Review"
        description={headerCount}
      />

      {error && (
        <Card>
          <CardContent>
            <p className="md-typescale-body-medium text-error">Error: {error}</p>
          </CardContent>
        </Card>
      )}

      {!runs && !error && (
        <div className="grid gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {runs && runs.length === 0 && (
        <Card>
          <CardContent>
            <p className="md-typescale-body-medium text-on-surface-variant">
              No runs awaiting review. New `hitl_blocked` runs land here as soon as the pipeline finalizes.
            </p>
          </CardContent>
        </Card>
      )}

      {runs && runs.length > 0 && !selected && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {runs.map((run) => (
            <Card key={run.id}>
              <CardHeader>
                <div>
                  <CardEyebrow>Run · {run.id.slice(0, 8)}</CardEyebrow>
                  <CardTitle className="mt-1.5 font-mono text-sm">
                    {run.productId?.slice(0, 8) ?? "(no product)"}
                  </CardTitle>
                </div>
                <Badge variant="neutral" size="sm">
                  hitl_blocked
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="grid grid-cols-2 gap-2 md-typescale-body-small text-on-surface-variant">
                  <dt>Created</dt>
                  <dd className="font-mono">
                    {run.createdAt ? new Date(run.createdAt).toLocaleString() : "—"}
                  </dd>
                  <dt>Duration</dt>
                  <dd className="font-mono">
                    {run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}
                  </dd>
                  <dt>Cost</dt>
                  <dd className="font-mono">
                    {run.totalCostCents != null ? formatCents(run.totalCostCents) : "—"}
                  </dd>
                </dl>
                <Button onClick={() => openRun(run)} variant="primary" size="sm">
                  Review →
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Button onClick={() => setSelected(null)} variant="outline" size="sm">
              ← Back to queue
            </Button>
            <span className="md-typescale-body-small text-on-surface-variant font-mono">
              run {selected.id.slice(0, 12)} · {selected.productId?.slice(0, 8) ?? "—"}
            </span>
          </div>

          {!assets && <Skeleton className="h-40 w-full" />}

          {assets && assets.length === 0 && (
            <Card>
              <CardContent>
                <p className="md-typescale-body-medium text-on-surface-variant">
                  No assets pending review for this run.
                </p>
              </CardContent>
            </Card>
          )}

          {assets && assets.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {assets.map((asset) => (
                <Card key={asset.id}>
                  <CardHeader>
                    <div>
                      <CardEyebrow>
                        {asset.platform} · {asset.slot}
                      </CardEyebrow>
                      <CardTitle className="mt-1.5 text-sm">
                        {asset.complianceScore ?? "—"}
                      </CardTitle>
                    </div>
                    <Badge variant="neutral" size="sm">
                      {asset.status}
                    </Badge>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {asset.r2Url && (
                      <a
                        href={asset.r2Url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block aspect-square overflow-hidden rounded-m3-md bg-surface-container"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={asset.r2Url}
                          alt=""
                          className="object-cover w-full h-full"
                        />
                      </a>
                    )}
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => approveAsset(asset.id)}
                        disabled={busyAssetId === asset.id}
                        variant="primary"
                        size="sm"
                      >
                        {busyAssetId === asset.id ? "…" : "Approve"}
                      </Button>
                      <Button
                        onClick={() => rejectAsset(asset.id)}
                        disabled={busyAssetId === asset.id}
                        variant="outline"
                        size="sm"
                      >
                        Reject
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
