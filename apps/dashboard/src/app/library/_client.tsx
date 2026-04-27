"use client";

import { useEffect, useMemo, useState } from "react";
import { useApiFetch } from "@/lib/api";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardEyebrow,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { PlatformAssetRow } from "@/db/schema";
import {
  AssetLightbox,
  type AssetSlide,
} from "@/components/library/asset-lightbox";
import { ZoomTile } from "@/components/library/zoom-tile";
import { isImageFormat, type SkuGroupShape } from "@/components/library/types";

interface LibraryResponse {
  platformAssets: PlatformAssetRow[];
}

export default function LibraryPage() {
  const apiFetch = useApiFetch();
  const [items, setItems] = useState<PlatformAssetRow[] | null>(null);
  const [lightbox, setLightbox] = useState<{
    open: boolean;
    slides: AssetSlide[];
    index: number;
  }>({ open: false, slides: [], index: 0 });

  useEffect(() => {
    apiFetch<LibraryResponse>("/api/assets")
      .then((d) =>
        setItems(Array.isArray(d.platformAssets) ? d.platformAssets : [])
      )
      .catch(() => setItems([]));
  }, [apiFetch]);

  const skuGroups = useMemo<SkuGroupShape[] | null>(() => {
    if (!items) return null;
    const map = new Map<string, SkuGroupShape>();
    for (const row of items) {
      const key = row.sku ?? row.productId ?? "unattributed";
      const existing = map.get(key);
      if (existing) {
        existing.items.push(row);
      } else {
        map.set(key, {
          sku: row.sku ?? "(no sku)",
          nameEn: row.productNameEn ?? "(unattributed asset)",
          nameZh: row.productNameZh,
          category: row.category ?? "—",
          sellerName: row.sellerNameEn,
          items: [row],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const aLatest = a.items[0]?.createdAt ?? "";
      const bLatest = b.items[0]?.createdAt ?? "";
      return bLatest.localeCompare(aLatest);
    });
  }, [items]);

  const skuCount = skuGroups?.length ?? 0;
  const totalAssets = items?.length ?? 0;

  function openLightbox(group: SkuGroupShape, startIdx: number) {
    const slides: AssetSlide[] = group.items
      .filter((it) => isImageFormat(it.format))
      .map((it) => ({
        src: it.r2Url,
        width: it.width ?? undefined,
        height: it.height ?? undefined,
        title: `${group.sku} · ${it.platform} · ${it.slot}`,
        description: group.nameEn,
      }));
    const visibleIndex = group.items
      .slice(0, startIdx + 1)
      .filter((it) => isImageFormat(it.format)).length - 1;
    setLightbox({
      open: true,
      slides,
      index: Math.max(0, visibleIndex),
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="Library · 资产库"
        title="Every image and listing, by SKU"
        description={`${totalAssets} asset${totalAssets === 1 ? "" : "s"} across ${skuCount} SKU${skuCount === 1 ? "" : "s"}. Latest launches first.`}
      />

      <section className="px-6 md:px-12 py-12 max-w-7xl mx-auto">
        {items === null ? (
          <SkuGroupSkeleton />
        ) : skuGroups && skuGroups.length > 0 ? (
          <div className="space-y-7">
            {skuGroups.map((g, i) => (
              <SkuGroup
                key={g.sku}
                group={g}
                delay={Math.min(i * 70, 280)}
                onOpenAt={(idx) => openLightbox(g, idx)}
              />
            ))}
          </div>
        ) : (
          <EmptyState />
        )}
      </section>

      <AssetLightbox
        open={lightbox.open}
        slides={lightbox.slides}
        index={lightbox.index}
        onClose={() => setLightbox((l) => ({ ...l, open: false }))}
      />
    </>
  );
}

function SkuGroup({
  group,
  delay,
  onOpenAt,
}: {
  group: SkuGroupShape;
  delay: number;
  onOpenAt: (idx: number) => void;
}) {
  return (
    <Card className="md-fade-in" style={{ animationDelay: `${delay}ms` }}>
      <CardHeader>
        <div className="min-w-0">
          <CardEyebrow>
            {group.sku} · {group.category}
            {group.sellerName ? ` · ${group.sellerName}` : ""}
          </CardEyebrow>
          <CardTitle className="mt-1.5">{group.nameEn}</CardTitle>
          {group.nameZh && (
            <div className="md-typescale-body-medium text-on-surface-variant mt-0.5">
              {group.nameZh}
            </div>
          )}
        </div>
        <Badge variant="neutral" size="sm">
          {group.items.length} slot{group.items.length === 1 ? "" : "s"}
        </Badge>
      </CardHeader>
      <div className="px-6 pb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {group.items.map((item, idx) => (
          <PlatformAssetTile
            key={item.id}
            item={item}
            onOpen={() => onOpenAt(idx)}
          />
        ))}
      </div>
    </Card>
  );
}

function PlatformAssetTile({
  item,
  onOpen,
}: {
  item: PlatformAssetRow;
  onOpen: () => void;
}) {
  const isImage = isImageFormat(item.format);
  const ratingVariant = scoreToVariant(item.complianceScore);
  const isReference = item.status === "reference";
  return (
    <div className="md-surface-container-low border ff-hairline rounded-m3-md overflow-hidden flex flex-col group">
      <div className="relative aspect-[4/3] bg-surface-container">
        {isImage ? (
          <ZoomTile src={item.r2Url} alt={`${item.platform} ${item.slot}`} onClick={onOpen} />
        ) : (
          <div className="w-full h-full flex items-center justify-center md-typescale-label-small text-on-surface-variant/70">
            {item.format ?? "asset"}
          </div>
        )}
        {isReference && (
          <div className="absolute top-3 left-3 px-2 py-0.5 rounded-m3-sm bg-surface/90 backdrop-blur-sm border ff-hairline pointer-events-none">
            <span className="ff-stamp-label">reference · 参考</span>
          </div>
        )}
        {item.complianceScore && (
          <div className="absolute top-3 right-3 animate-stamp-in pointer-events-none">
            <Badge variant={ratingVariant} size="sm">
              {item.complianceScore}
            </Badge>
          </div>
        )}
      </div>
      <div className="px-4 py-3 flex flex-col gap-1.5">
        <CardEyebrow>
          {item.platform} · {item.slot}
        </CardEyebrow>
        <div className="flex items-baseline justify-between gap-2">
          <span className="md-typescale-body-small text-on-surface-variant font-mono text-[0.6875rem] truncate">
            {item.modelUsed ?? "—"}
          </span>
          <span className="md-typescale-body-small text-on-surface-variant/70 font-mono text-[0.6875rem] tabular-nums shrink-0">
            {item.costCents !== null ? `${item.costCents}¢` : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

function scoreToVariant(
  s: string | null
): "passed" | "pending" | "flagged" | "neutral" {
  if (!s) return "neutral";
  const u = s.toUpperCase();
  if (u === "EXCELLENT" || u === "GOOD") return "passed";
  if (u === "FAIR") return "pending";
  if (u === "POOR") return "flagged";
  const n = parseInt(s, 10);
  if (Number.isFinite(n)) {
    if (n >= 85) return "passed";
    if (n >= 70) return "pending";
    return "flagged";
  }
  return "neutral";
}

function EmptyState() {
  return (
    <div className="rounded-m3-lg border border-dashed border-outline-variant py-24 px-8 text-center md-fade-in">
      <div className="ff-stamp-label mb-3">No SKU launches yet</div>
      <h3 className="md-typescale-headline-large text-on-surface mb-3">
        Launch your first SKU
      </h3>
      <p className="md-typescale-body-large text-on-surface-variant max-w-md mx-auto">
        The library populates after a launch_product_sku run completes (full
        or dry).
      </p>
      <a
        href="/launch"
        className={[
          "inline-flex items-center gap-2 mt-6 px-6 h-10 rounded-m3-full",
          "bg-primary text-primary-on shadow-m3-1 hover:shadow-m3-2",
          "md-typescale-label-large transition-shadow duration-m3-short4 ease-m3-emphasized",
        ].join(" ")}
      >
        Open Launch wizard →
      </a>
    </div>
  );
}

function SkuGroupSkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 2 }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <div className="space-y-2 flex-1">
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-6 w-72" />
            </div>
          </CardHeader>
          <div className="px-6 pb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((__, j) => (
              <div
                key={j}
                className="rounded-m3-md md-surface-container-low border ff-hairline overflow-hidden"
              >
                <Skeleton className="aspect-[4/3] w-full rounded-none" />
                <div className="p-4 space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
