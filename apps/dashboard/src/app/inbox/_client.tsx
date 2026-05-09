"use client";

/**
 * Phase B (F4) — operator HITL inbox.
 * Phase C · Iter 06 — friendly product names, bulk approve, styled
 * reject modal (replaces native window.prompt).
 *
 * Lists every run currently in `hitl_blocked` across visible tenants
 * so an operator can triage the FAIR-rated assets without hunting
 * through /library + filters. Click into a run, approve / reject each
 * asset; approvals fire `asset.approved` webhooks (which buyfishingrod-
 * admin and other customer admins subscribe to).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useApiFetch } from "@/lib/api";
import { formatCents, friendlyStatus } from "@/lib/format";
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
  productSku?: string | null;
  productNameEn?: string | null;
  productNameZh?: string | null;
}

interface InboxResponse {
  runs: InboxRun[];
}

interface AssetsResponse {
  platformAssets: PlatformAssetRow[];
}

function runDisplayName(run: InboxRun): string {
  const name = run.productNameEn || run.productNameZh;
  if (name && run.productSku) return `${name} (${run.productSku})`;
  if (name) return name;
  if (run.productSku) return run.productSku;
  return run.id.slice(0, 8);
}

export default function InboxClient() {
  const apiFetch = useApiFetch();
  const [runs, setRuns] = useState<InboxRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<InboxRun | null>(null);
  const [assets, setAssets] = useState<PlatformAssetRow[] | null>(null);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  // Phase C · Iter 06 — bulk-select state and reject modal.
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(
    new Set()
  );
  const [bulkBusy, setBulkBusy] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<PlatformAssetRow | null>(
    null
  );
  const [rejectReason, setRejectReason] = useState("");

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
      setSelectedAssetIds(new Set());
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
      const removed =
        assets?.find((a) => a.id === assetId) ?? null;
      try {
        await apiFetch(`/v1/assets/${assetId}/approve`, { method: "POST" });
        setAssets((prev) =>
          prev ? prev.filter((a) => a.id !== assetId) : prev
        );
        setSelectedAssetIds((prev) => {
          const next = new Set(prev);
          next.delete(assetId);
          return next;
        });
        // Phase C · Iter 11 — 5-second Undo toast that calls the
        // un-approve endpoint and re-injects the asset into the list.
        toast.success("Approved.", {
          duration: 5000,
          action: removed
            ? {
                label: "Undo",
                onClick: async () => {
                  try {
                    await apiFetch(`/v1/assets/${assetId}/un-approve`, {
                      method: "POST",
                    });
                    setAssets((prev) =>
                      prev ? [removed, ...prev] : [removed]
                    );
                    toast.message("Undone.");
                  } catch (e) {
                    toast.error(
                      e instanceof Error
                        ? `Undo failed: ${e.message}`
                        : "Undo failed"
                    );
                  }
                },
              }
            : undefined,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyAssetId(null);
      }
    },
    [apiFetch, assets]
  );

  const submitReject = useCallback(async () => {
    if (!rejectTarget) return;
    const id = rejectTarget.id;
    setBusyAssetId(id);
    try {
      await apiFetch(`/v1/assets/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: rejectReason.trim().slice(0, 500) }),
        headers: { "content-type": "application/json" },
      });
      setAssets((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
      setSelectedAssetIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAssetId(null);
      setRejectTarget(null);
      setRejectReason("");
    }
  }, [apiFetch, rejectTarget, rejectReason]);

  const bulkApprove = useCallback(async () => {
    if (selectedAssetIds.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selectedAssetIds);
    try {
      const res = await apiFetch<{ approved: number; failed: number }>(
        "/v1/inbox/bulk-approve",
        {
          method: "POST",
          body: JSON.stringify({ asset_ids: ids }),
        }
      );
      setAssets((prev) =>
        prev ? prev.filter((a) => !selectedAssetIds.has(a.id)) : prev
      );
      setSelectedAssetIds(new Set());
      if (res.failed > 0) {
        setError(`${res.failed} of ${ids.length} approves failed.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkBusy(false);
    }
  }, [apiFetch, selectedAssetIds]);

  const toggleSelect = (id: string) => {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    if (!assets) return;
    if (selectedAssetIds.size === assets.length) {
      setSelectedAssetIds(new Set());
    } else {
      setSelectedAssetIds(new Set(assets.map((a) => a.id)));
    }
  };

  const headerCount = useMemo(
    () =>
      runs
        ? `${runs.length} ${runs.length === 1 ? "run" : "runs"} pending review`
        : "—",
    [runs]
  );

  return (
    <main className="container mx-auto px-6 py-8 space-y-6">
      <PageHeader
        eyebrow="Inbox · 审核队列"
        title="Pending review"
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
              Nothing waiting for review. New flagged listings land here as
              soon as the pipeline finishes.
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
                  <CardTitle className="mt-1.5">
                    {runDisplayName(run)}
                  </CardTitle>
                </div>
                <Badge variant="neutral" size="sm">
                  {friendlyStatus(run.status)}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="grid grid-cols-2 gap-2 md-typescale-body-small text-on-surface-variant">
                  <dt>Created</dt>
                  <dd className="font-mono">
                    {run.createdAt
                      ? new Date(run.createdAt).toLocaleString()
                      : "—"}
                  </dd>
                  <dt>Duration</dt>
                  <dd className="font-mono">
                    {run.durationMs
                      ? `${(run.durationMs / 1000).toFixed(1)}s`
                      : "—"}
                  </dd>
                  <dt>Cost</dt>
                  <dd className="font-mono">
                    {run.totalCostCents != null
                      ? formatCents(run.totalCostCents)
                      : "—"}
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
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Button
              onClick={() => setSelected(null)}
              variant="outline"
              size="sm"
            >
              ← Back to queue
            </Button>
            <span className="md-typescale-body-medium font-mono text-on-surface-variant truncate max-w-[60ch]">
              {runDisplayName(selected)}
            </span>
          </div>

          {/* Phase C · Iter 06 — bulk action bar. Only renders when there
              are reviewable assets so it doesn't take real estate when
              the run has nothing left to triage. */}
          {assets && assets.length > 0 && (
            <div className="flex items-center justify-between gap-3 flex-wrap rounded-m3-md md-surface-container-low border ff-hairline px-4 py-2.5">
              <label className="md-typescale-body-medium text-on-surface-variant flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedAssetIds.size === assets.length}
                  onChange={selectAllVisible}
                  className="h-4 w-4"
                />
                <span>
                  {selectedAssetIds.size === 0
                    ? `Select all (${assets.length})`
                    : `${selectedAssetIds.size} of ${assets.length} selected`}
                </span>
              </label>
              <div className="flex items-center gap-2">
                <Button
                  onClick={bulkApprove}
                  disabled={bulkBusy || selectedAssetIds.size === 0}
                  variant="primary"
                  size="sm"
                >
                  {bulkBusy
                    ? "Approving…"
                    : `Approve ${selectedAssetIds.size || ""}`}
                </Button>
              </div>
            </div>
          )}

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
              {assets.map((asset) => {
                const isSelected = selectedAssetIds.has(asset.id);
                return (
                  <Card key={asset.id}>
                    <CardHeader>
                      <div className="flex items-start gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(asset.id)}
                          className="h-4 w-4 mt-1 shrink-0"
                          aria-label="Select for bulk approve"
                        />
                        <div className="min-w-0">
                          <CardEyebrow>
                            {asset.platform} · {asset.slot}
                          </CardEyebrow>
                          <CardTitle className="mt-1.5 text-sm">
                            {asset.complianceScore ?? "—"}
                          </CardTitle>
                        </div>
                      </div>
                      <Badge variant="neutral" size="sm">
                        {friendlyStatus(asset.status)}
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
                          disabled={busyAssetId === asset.id || bulkBusy}
                          variant="primary"
                          size="sm"
                        >
                          {busyAssetId === asset.id ? "…" : "Approve"}
                        </Button>
                        <Button
                          onClick={() => {
                            setRejectTarget(asset);
                            setRejectReason("");
                          }}
                          disabled={busyAssetId === asset.id || bulkBusy}
                          variant="outline"
                          size="sm"
                        >
                          Reject
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Phase C · Iter 06 — styled reject-reason modal. Replaces the
          native window.prompt that looked broken on a polished dashboard. */}
      {rejectTarget && (
        <div
          className="fixed inset-0 z-30 bg-scrim/40 backdrop-blur-sm flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            if (busyAssetId !== rejectTarget.id) {
              setRejectTarget(null);
              setRejectReason("");
            }
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="md-surface-container border ff-hairline rounded-m3-md w-full max-w-md px-5 py-5 space-y-4 shadow-m3-3"
          >
            <div>
              <div className="ff-stamp-label mb-1">Reject this asset</div>
              <div className="md-typescale-title-small">
                {rejectTarget.platform} · {rejectTarget.slot}
              </div>
            </div>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder="Optional: briefly note why (logo wrong, unsupported claim, off-brand color, …)."
              className="w-full px-3 py-2 rounded-m3-md bg-surface-container-low border ff-hairline md-typescale-body-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary resize-y"
              autoFocus
            />
            <div className="flex items-center justify-between gap-3">
              <span className="md-typescale-body-small text-on-surface-variant/70 font-mono tabular-nums">
                {rejectReason.length} / 500
              </span>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => {
                    setRejectTarget(null);
                    setRejectReason("");
                  }}
                  disabled={busyAssetId === rejectTarget.id}
                  variant="outline"
                  size="sm"
                >
                  Cancel
                </Button>
                <Button
                  onClick={submitReject}
                  disabled={busyAssetId === rejectTarget.id}
                  variant="primary"
                  size="sm"
                >
                  {busyAssetId === rejectTarget.id ? "Rejecting…" : "Reject"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
