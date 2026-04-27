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
import { cn } from "@/lib/cn";
import type { AssetRow, PlatformAssetRow } from "@/db/schema";

const PUB_URL = "https://pub-db3f39e3386347d58359ba96517eec84.r2.dev";

interface LibraryResponse {
  legacy: AssetRow[];
  platformAssets: PlatformAssetRow[];
}

type Tab = "skus" | "legacy";

export default function LibraryPage() {
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [tab, setTab] = useState<Tab>("skus");

  useEffect(() => {
    fetch(`${MCP_URL}/api/assets`)
      .then((r) => r.json())
      .then((d: LibraryResponse) =>
        setData({
          legacy: Array.isArray(d.legacy) ? d.legacy : [],
          platformAssets: Array.isArray(d.platformAssets) ? d.platformAssets : [],
        })
      )
      .catch(() => setData({ legacy: [], platformAssets: [] }));
  }, []);

  // Group v2 platform assets by SKU
  const skuGroups = useMemo(() => {
    if (!data) return null;
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
    for (const row of data.platformAssets) {
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
  }, [data]);

  const skuCount = skuGroups?.length ?? 0;
  const legacyCount = data?.legacy.length ?? 0;
  const totalAssets = (data?.platformAssets.length ?? 0) + legacyCount;

  return (
    <>
      <PageHeader
        eyebrow="Library · 资产库"
        title="Every image and listing, by SKU"
        description={`${totalAssets} asset${totalAssets === 1 ? "" : "s"} on file. Live launches roll up by SKU; legacy v1 social heroes live in their own tab.`}
        action={
          <div className="flex gap-2">
            <TabButton active={tab === "skus"} onClick={() => setTab("skus")} count={skuCount}>
              By SKU
            </TabButton>
            <TabButton active={tab === "legacy"} onClick={() => setTab("legacy")} count={legacyCount}>
              Legacy
            </TabButton>
          </div>
        }
      />

      <section className="px-6 md:px-12 py-12 max-w-7xl mx-auto">
        {data === null ? (
          <SkuGroupSkeleton />
        ) : tab === "skus" ? (
          skuGroups && skuGroups.length > 0 ? (
            <div className="space-y-7">
              {skuGroups.map((g, i) => (
                <SkuGroup key={g.sku} group={g} delay={Math.min(i * 70, 280)} />
              ))}
            </div>
          ) : (
            <EmptyState
              eyebrow="No SKU launches yet"
              title="Launch your first SKU"
              hint="The library populates after a launch_product_sku run completes (full or dry)."
              ctaHref="/launch"
              ctaLabel="Open Launch wizard →"
            />
          )
        ) : data.legacy.length > 0 ? (
          <LegacyGrid rows={data.legacy} />
        ) : (
          <EmptyState
            eyebrow="No legacy assets"
            title="Nothing to bucket"
            hint="v1 social-content heroes from the legacy run_campaign workflow would land here."
            ctaHref="/launch"
            ctaLabel="Run a launch instead →"
          />
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

function LegacyGrid({ rows }: { rows: AssetRow[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {rows.map((a, i) => (
        <div
          key={a.id}
          className="md-fade-in"
          style={{ animationDelay: `${Math.min(i * 50, 280)}ms` }}
        >
          <LegacyTile asset={a} />
        </div>
      ))}
    </div>
  );
}

function LegacyTile({ asset }: { asset: AssetRow }) {
  const score = asset.brandScore ?? 0;
  const variant: "passed" | "pending" | "flagged" | "neutral" =
    score >= 85 ? "passed" : score >= 70 ? "pending" : score > 0 ? "flagged" : "neutral";
  const isImage =
    asset.assetType?.includes("image") || asset.assetType?.includes("infographic");
  const url = `${PUB_URL}/${asset.r2Key}`;

  return (
    <Card className="group flex flex-col">
      <div className="relative aspect-[4/3] bg-surface-container/60 border-b ff-hairline overflow-hidden">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={asset.campaign ?? asset.r2Key}
            className="w-full h-full object-cover transition-transform duration-700 ease-m3-emphasized group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center md-typescale-label-small text-on-surface-variant/70">
            {asset.assetType ?? "asset"}
          </div>
        )}
        {score > 0 && (
          <div className="absolute top-3 right-3 animate-stamp-in">
            <Badge variant={variant}>{score}/100</Badge>
          </div>
        )}
      </div>
      <div className="px-4 pt-3 pb-4 flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <CardEyebrow>{asset.assetType ?? "legacy asset"}</CardEyebrow>
          <span className="md-typescale-label-small text-on-surface-variant/70">
            {asset.locale ?? "—"}
          </span>
        </div>
        <div
          className="md-typescale-title-small text-on-surface leading-snug truncate"
          title={asset.r2Key}
        >
          {asset.campaign ?? (
            <span className="text-on-surface-variant/60 italic">untitled campaign</span>
          )}
        </div>
        <div className="md-typescale-body-small text-on-surface-variant/70 font-mono pt-0.5 truncate">
          {asset.platform ?? "—"} · {asset.r2Key.split("/").slice(-1)[0]}
        </div>
      </div>
    </Card>
  );
}

function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-3.5 h-8 rounded-m3-sm",
        "md-typescale-label-medium uppercase tracking-stamp border",
        "transition-colors duration-m3-short4 ease-m3-emphasized",
        active
          ? "bg-on-surface text-surface border-on-surface"
          : "bg-surface-container-low text-on-surface-variant border-outline-variant hover:border-outline hover:text-on-surface"
      )}
    >
      <span>{children}</span>
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function EmptyState({
  eyebrow,
  title,
  hint,
  ctaHref,
  ctaLabel,
}: {
  eyebrow: string;
  title: string;
  hint: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <div className="rounded-m3-lg border border-dashed border-outline-variant py-24 px-8 text-center md-fade-in">
      <div className="ff-stamp-label mb-3">{eyebrow}</div>
      <h3 className="md-typescale-headline-large text-on-surface mb-3">{title}</h3>
      <p className="md-typescale-body-large text-on-surface-variant max-w-md mx-auto">{hint}</p>
      <a
        href={ctaHref}
        className={[
          "inline-flex items-center gap-2 mt-6 px-6 h-10 rounded-m3-full",
          "bg-primary text-primary-on shadow-m3-1 hover:shadow-m3-2",
          "md-typescale-label-large transition-shadow duration-m3-short4 ease-m3-emphasized",
        ].join(" ")}
      >
        {ctaLabel}
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
