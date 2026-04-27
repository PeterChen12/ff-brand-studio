"use client";

import { useEffect, useState } from "react";
import { AssetCard } from "@/components/asset-card";
import { MCP_URL } from "@/lib/config";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { AssetRow } from "@/db/schema";

type FilterState = "all" | "passed" | "review" | "flagged";

export default function AssetsPage() {
  const [assetList, setAssetList] = useState<AssetRow[] | null>(null);
  const [filter, setFilter] = useState<FilterState>("all");

  useEffect(() => {
    fetch(`${MCP_URL}/api/assets`)
      .then((r) => r.json())
      .then((data: { assets: AssetRow[] }) => setAssetList(data.assets))
      .catch(() => setAssetList([]));
  }, []);

  const filtered = (assetList ?? []).filter((a) => {
    if (filter === "all") return true;
    const s = a.brandScore ?? 0;
    if (filter === "passed") return s >= 85;
    if (filter === "review") return s >= 70 && s < 85;
    if (filter === "flagged") return s > 0 && s < 70;
    return true;
  });

  const counts = {
    all: assetList?.length ?? 0,
    passed: (assetList ?? []).filter((a) => (a.brandScore ?? 0) >= 85).length,
    review: (assetList ?? []).filter(
      (a) => (a.brandScore ?? 0) >= 70 && (a.brandScore ?? 0) < 85
    ).length,
    flagged: (assetList ?? []).filter(
      (a) => (a.brandScore ?? 0) > 0 && (a.brandScore ?? 0) < 70
    ).length,
  };

  return (
    <>
      <PageHeader
        eyebrow="Asset Manifest · 资产清单"
        title="What crossed the bench"
        description={`${counts.all} asset${counts.all === 1 ? "" : "s"} stamped, scored, and shelved — most recent first.`}
        action={
          <div className="flex flex-wrap gap-2">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")} count={counts.all}>
              All
            </FilterChip>
            <FilterChip
              active={filter === "passed"}
              onClick={() => setFilter("passed")}
              count={counts.passed}
              variant="passed"
            >
              Auto-approved
            </FilterChip>
            <FilterChip
              active={filter === "review"}
              onClick={() => setFilter("review")}
              count={counts.review}
              variant="pending"
            >
              In review
            </FilterChip>
            <FilterChip
              active={filter === "flagged"}
              onClick={() => setFilter("flagged")}
              count={counts.flagged}
              variant="flagged"
            >
              HITL flagged
            </FilterChip>
          </div>
        }
      />

      <section className="px-6 md:px-12 py-12 max-w-7xl mx-auto">
        {assetList === null ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="border border-mist bg-paper-deep/40">
                <Skeleton className="aspect-[4/3] w-full" />
                <div className="p-4 space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState filter={filter} totalAll={counts.all} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((asset, i) => (
              <div
                key={asset.id}
                className="animate-fade-up"
                style={{ animationDelay: `${Math.min(i * 50, 400)}ms` }}
              >
                <AssetCard asset={asset} />
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function FilterChip({
  active,
  onClick,
  count,
  variant,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  variant?: "passed" | "pending" | "flagged";
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "inline-flex items-center gap-2 px-3 py-1.5 transition-colors",
        "font-mono text-2xs uppercase tracking-stamp border",
        active
          ? "bg-ink text-paper border-ink"
          : "bg-paper-deep/50 text-ink-soft border-mist hover:border-ink hover:text-ink",
      ].join(" ")}
    >
      {variant && (
        <span
          className={[
            "inline-block h-1.5 w-1.5",
            variant === "passed" && "bg-jade",
            variant === "pending" && "bg-amber",
            variant === "flagged" && "bg-vermilion",
          ]
            .filter(Boolean)
            .join(" ")}
        />
      )}
      <span>{children}</span>
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function EmptyState({ filter, totalAll }: { filter: FilterState; totalAll: number }) {
  if (totalAll === 0) {
    return (
      <div className="border border-dashed border-mist py-24 px-8 text-center">
        <div className="stamp-label text-vermilion-deep mb-3">Manifest empty</div>
        <h3 className="font-display text-display-3 font-medium text-ink mb-3">
          No assets crossed the bench yet
        </h3>
        <p className="text-ink-soft text-sm max-w-md mx-auto">
          Run a campaign via the orchestrator and the resulting heroes, infographics, and videos will land here.
        </p>
        <a
          href="/campaigns/new"
          className="inline-flex items-center gap-2 mt-6 px-5 h-10 bg-vermilion text-paper font-mono text-2xs uppercase tracking-stamp hover:bg-vermilion-deep transition-colors"
        >
          Run a campaign →
        </a>
      </div>
    );
  }
  return (
    <div className="border border-dashed border-mist py-16 px-8 text-center">
      <Badge variant="outline" className="mb-4">
        Filter: {filter}
      </Badge>
      <p className="text-ink-soft text-sm">No assets match this filter. Try a wider band.</p>
    </div>
  );
}
