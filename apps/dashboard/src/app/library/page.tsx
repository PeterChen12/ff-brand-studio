"use client";

import { useEffect, useMemo, useState } from "react";
import { MCP_URL } from "@/lib/config";
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

interface LibraryResponse {
  platformAssets: PlatformAssetRow[];
}

export default function LibraryPage() {
  const [items, setItems] = useState<PlatformAssetRow[] | null>(null);

  useEffect(() => {
    fetch(`${MCP_URL}/api/assets`)
      .then((r) => r.json())
      .then((d: LibraryResponse) =>
        setItems(Array.isArray(d.platformAssets) ? d.platformAssets : [])
      )
      .catch(() => setItems([]));
  }, []);

  // Group v2 platform assets by SKU
  const skuGroups = useMemo(() => {
    if (!items) return null;
    const map = new Map<
      string,
      {
        sku: string;
        nameEn: string;
        nameZh: string | null;
        category: string;
        sellerName: string | null;
        items: PlatformAssetRow[];
      }
    >();
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
              <SkuGroup key={g.sku} group={g} delay={Math.min(i * 70, 280)} />
            ))}
          </div>
        ) : (
          <EmptyState />
        )}
      </section>
    </>
  );
}

function SkuGroup({
  group,
  delay,
}: {
  group: {
    sku: string;
    nameEn: string;
    nameZh: string | null;
    category: string;
    sellerName: string | null;
    items: PlatformAssetRow[];
  };
  delay: number;
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
        {group.items.map((item) => (
          <PlatformAssetTile key={item.id} item={item} />
        ))}
      </div>
    </Card>
  );
}

function PlatformAssetTile({ item }: { item: PlatformAssetRow }) {
  const isImage =
    item.format === "jpg" ||
    item.format === "jpeg" ||
    item.format === "png" ||
    item.format === "webp" ||
    item.format === null;
  const ratingVariant = scoreToVariant(item.complianceScore);
  return (
    <div className="md-surface-container-low border ff-hairline rounded-m3-md overflow-hidden flex flex-col group">
      <div className="relative aspect-[4/3] bg-surface-container">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.r2Url}
            alt={`${item.platform} ${item.slot}`}
            className="w-full h-full object-cover transition-transform duration-700 ease-m3-emphasized group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center md-typescale-label-small text-on-surface-variant/70">
            {item.format ?? "asset"}
          </div>
        )}
        {item.complianceScore && (
          <div className="absolute top-3 right-3 animate-stamp-in">
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
