"use client";

import { useEffect, useMemo, useState } from "react";
import { useApiQuery } from "@/lib/api-query";
import { formatCents } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorState } from "@/components/ui/error-state";
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
import {
  BundleSkuButton,
  DownloadAssetButton,
  RegenAssetButton,
} from "@/components/library/asset-actions";
import { StageProductButton } from "@/components/library/stage-product-button";
import {
  FilterBar,
  applyFilters,
  DEFAULT_FILTERS,
  type LibraryFilters,
  type PlatformFilter,
  type DateRangePreset,
} from "@/components/library/filter-bar";
import { AuditTab } from "@/components/library/audit-tab";
import { VirtualSkuList } from "@/components/library/virtual-sku-list";
import { ListingCopy } from "@/components/listings/ListingCopy";

interface LibraryResponse {
  platformAssets: PlatformAssetRow[];
}

interface ListingRow {
  id: string;
  variantId: string;
  surface: string;
  language: string;
  copy: Record<string, unknown> | null;
  rating: string | null;
  iterations: number;
  costCents: number;
  status: string;
  updatedAt: string | null;
  productId: string | null;
  sku: string | null;
  productNameEn: string | null;
  productNameZh: string | null;
  category: string | null;
  isSample?: boolean;
}

type Tab = "assets" | "listings" | "audit";

function readFiltersFromUrl(): { tab: Tab; filters: LibraryFilters } {
  if (typeof window === "undefined") {
    return { tab: "assets", filters: DEFAULT_FILTERS };
  }
  const sp = new URLSearchParams(window.location.search);
  const tabParam = sp.get("tab");
  const tab: Tab =
    tabParam === "audit"
      ? "audit"
      : tabParam === "listings"
        ? "listings"
        : "assets";
  const platform = sp.get("platform");
  const range = sp.get("range");
  return {
    tab,
    filters: {
      q: sp.get("q") ?? "",
      platform:
        platform === "amazon" || platform === "shopify" ? platform : "all",
      slot: sp.get("slot") ?? "all",
      status: sp.get("status") ?? "all",
      range:
        range === "today" || range === "7d" || range === "30d"
          ? (range as DateRangePreset)
          : "all",
    },
  };
}

function writeFiltersToUrl(tab: Tab, f: LibraryFilters) {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams();
  if (tab !== "assets") sp.set("tab", tab);
  if (f.q) sp.set("q", f.q);
  if (f.platform !== "all") sp.set("platform", f.platform);
  if (f.slot !== "all") sp.set("slot", f.slot);
  if (f.status !== "all") sp.set("status", f.status);
  if (f.range !== "all") sp.set("range", f.range);
  const qs = sp.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState({}, "", url);
}

export default function LibraryPage() {
  const [tab, setTab] = useState<Tab>("assets");
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);
  const [lightbox, setLightbox] = useState<{
    open: boolean;
    slides: AssetSlide[];
    index: number;
  }>({ open: false, slides: [], index: 0 });

  // Assets fetch — always-on (cheap; user lands here by default).
  const assetsQ = useApiQuery<LibraryResponse>("/api/assets");
  const items = assetsQ.data?.platformAssets ?? null;
  const itemsError = assetsQ.error;

  // Issue C — lazy-load listings the first time the tab is opened by
  // passing `null` to useApiQuery as the SWR conditional-fetch pattern.
  const listingsQ = useApiQuery<{ listings: ListingRow[] }>(
    tab === "listings" ? "/v1/listings" : null
  );
  const listings = listingsQ.data?.listings ?? null;
  const listingsError = listingsQ.error;

  useEffect(() => {
    const init = readFiltersFromUrl();
    setTab(init.tab);
    setFilters(init.filters);
  }, []);

  useEffect(() => {
    writeFiltersToUrl(tab, filters);
  }, [tab, filters]);

  const filteredItems = useMemo(
    () => (items ? applyFilters(items, filters) : null),
    [items, filters]
  );

  const skuGroups = useMemo<SkuGroupShape[] | null>(() => {
    if (!filteredItems) return null;
    const map = new Map<string, SkuGroupShape>();
    for (const row of filteredItems) {
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
          isSample: row.isSample === true,
          items: [row],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const aLatest = a.items[0]?.createdAt ?? "";
      const bLatest = b.items[0]?.createdAt ?? "";
      return bLatest.localeCompare(aLatest);
    });
  }, [filteredItems]);

  const distinctSlots = useMemo(() => {
    if (!items) return [];
    return Array.from(new Set(items.map((r) => r.slot))).sort();
  }, [items]);

  const distinctStatuses = useMemo(() => {
    if (!items) return [];
    return Array.from(new Set(items.map((r) => r.status))).sort();
  }, [items]);

  const skuCount = skuGroups?.length ?? 0;
  const totalAssets = filteredItems?.length ?? 0;

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

      <section className="px-6 md:px-12 pt-8 pb-12 max-w-7xl mx-auto">
        <Tabs tab={tab} setTab={setTab} />

        {tab === "assets" ? (
          <>
            <FilterBar
              value={filters}
              onChange={setFilters}
              slots={distinctSlots}
              statuses={distinctStatuses}
            />

            {itemsError ? (
              <ErrorState
                title="Couldn't load your library"
                error={itemsError}
                onRetry={() => assetsQ.mutate()}
              />
            ) : items === null ? (
              <SkuGroupSkeleton />
            ) : skuGroups && skuGroups.length > 0 ? (
              <VirtualSkuList
                groups={skuGroups}
                renderGroup={(g, i) => (
                  <SkuGroup
                    key={g.sku}
                    group={g}
                    delay={Math.min(i * 70, 280)}
                    onOpenAt={(idx) => openLightbox(g, idx)}
                    onShowListings={(sku) => {
                      setFilters((prev) => ({ ...prev, q: sku }));
                      setTab("listings");
                    }}
                  />
                )}
              />
            ) : items.length === 0 ? (
              <EmptyState />
            ) : (
              <NoMatchState onClear={() => setFilters(DEFAULT_FILTERS)} />
            )}
          </>
        ) : tab === "listings" ? (
          listingsError ? (
            <ErrorState
              title="Couldn't load listings"
              error={listingsError}
              onRetry={() => listingsQ.mutate()}
            />
          ) : (
            <ListingsTab
              listings={listings}
              queryFilter={filters.q}
              onQueryChange={(q) =>
                setFilters((prev) => ({ ...prev, q }))
              }
            />
          )
        ) : (
          <AuditTab />
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

function Tabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <div role="tablist" className="flex items-center gap-1 mb-6 border-b ff-hairline">
      <TabButton active={tab === "assets"} onClick={() => setTab("assets")}>
        Assets
      </TabButton>
      <TabButton active={tab === "listings"} onClick={() => setTab("listings")}>
        Listings
      </TabButton>
      <TabButton active={tab === "audit"} onClick={() => setTab("audit")}>
        Audit log
      </TabButton>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "h-10 px-4 md-typescale-label-large border-b-2 -mb-px transition-colors",
        active
          ? "border-primary text-on-surface"
          : "border-transparent text-on-surface-variant hover:text-on-surface",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// Issue C — Listings tab. Lazy-loads /v1/listings, groups by SKU,
// renders each surface via the shared ListingCopy component (also used
// by ResultPanel). Free-text q filter applies to sku + product names.
function ListingsTab({
  listings,
  queryFilter,
  onQueryChange,
}: {
  listings: ListingRow[] | null;
  queryFilter: string;
  onQueryChange: (q: string) => void;
}) {
  const filtered = useMemo(() => {
    if (!listings) return null;
    const q = queryFilter.trim().toLowerCase();
    if (!q) return listings;
    return listings.filter((r) => {
      const hay = [r.sku ?? "", r.productNameEn ?? "", r.productNameZh ?? ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [listings, queryFilter]);

  const groups = useMemo(() => {
    if (!filtered) return null;
    const map = new Map<
      string,
      {
        sku: string;
        nameEn: string;
        nameZh: string | null;
        category: string;
        isSample: boolean;
        rows: ListingRow[];
      }
    >();
    for (const row of filtered) {
      const key = row.sku ?? row.productId ?? "unattributed";
      const existing = map.get(key);
      if (existing) {
        existing.rows.push(row);
      } else {
        map.set(key, {
          sku: row.sku ?? "(no sku)",
          nameEn: row.productNameEn ?? "(unattributed listing)",
          nameZh: row.productNameZh,
          category: row.category ?? "—",
          isSample: row.isSample === true,
          rows: [row],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const aLatest = a.rows[0]?.updatedAt ?? "";
      const bLatest = b.rows[0]?.updatedAt ?? "";
      return bLatest.localeCompare(aLatest);
    });
  }, [filtered]);

  if (listings === null) {
    return <SkuGroupSkeleton />;
  }
  if (listings.length === 0) {
    return <ListingsEmptyState />;
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-6">
        <input
          type="search"
          value={queryFilter}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Filter by SKU or product name…"
          className="flex-1 max-w-md h-10 px-4 rounded-m3-md border ff-hairline bg-surface-container md-typescale-body-medium focus:outline-none focus:border-primary"
        />
        <span className="md-typescale-body-small text-on-surface-variant font-mono">
          {filtered?.length ?? 0} listing{(filtered?.length ?? 0) === 1 ? "" : "s"}
        </span>
      </div>
      {groups && groups.length > 0 ? (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.sku} className="md-fade-in">
              <CardHeader>
                <div className="min-w-0">
                  <CardEyebrow>
                    {g.sku} · {g.category}
                  </CardEyebrow>
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    <CardTitle>{g.nameEn || g.nameZh || "(unnamed)"}</CardTitle>
                    {g.isSample && (
                      <Badge variant="outline" size="sm">
                        展示样品 · demo
                      </Badge>
                    )}
                  </div>
                  {g.nameZh && g.nameZh !== g.nameEn && (
                    <div className="md-typescale-body-medium text-on-surface-variant mt-0.5">
                      {g.nameZh}
                    </div>
                  )}
                </div>
                <Badge variant="neutral" size="sm">
                  {g.rows.length} listing{g.rows.length === 1 ? "" : "s"}
                </Badge>
              </CardHeader>
              <div className="px-6 pb-6 space-y-3">
                {g.rows.map((row) => (
                  <div
                    key={row.id}
                    className="md-surface-container-low border ff-hairline rounded-m3-md px-4 py-3"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <CardEyebrow>
                        {row.surface} · {row.language}
                      </CardEyebrow>
                      {row.rating && (
                        <Badge
                          variant={
                            row.rating === "EXCELLENT" || row.rating === "GOOD"
                              ? "passed"
                              : row.rating === "FAIR"
                                ? "pending"
                                : "flagged"
                          }
                          size="sm"
                        >
                          {row.rating}
                        </Badge>
                      )}
                    </div>
                    <div className="md-typescale-body-small text-on-surface-variant font-mono">
                      iter {row.iterations} · {formatCents(row.costCents)} ·{" "}
                      {row.status}
                    </div>
                    <ListingCopy
                      surface={row.surface}
                      language={row.language}
                      copy={row.copy}
                    />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <ListingsNoMatchState onClear={() => onQueryChange("")} />
      )}
    </>
  );
}

function ListingsEmptyState() {
  return (
    <div className="rounded-m3-lg border border-dashed border-outline-variant py-16 px-8 text-center md-fade-in">
      <div className="ff-stamp-label mb-3">No listings yet</div>
      <h3 className="md-typescale-headline-medium text-on-surface mb-2">
        Run a launch to generate SEO copy
      </h3>
      <p className="md-typescale-body-medium text-on-surface-variant max-w-md mx-auto">
        Each launch (dry-run or full) produces compliance-shaped listings
        for Amazon US and Shopify DTC. They land here once the run finishes.
      </p>
    </div>
  );
}

function ListingsNoMatchState({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-m3-lg border border-dashed border-outline-variant py-12 px-8 text-center md-fade-in">
      <div className="ff-stamp-label mb-3">No matches</div>
      <p className="md-typescale-body-medium text-on-surface-variant max-w-md mx-auto mb-4">
        No listings match that filter — try clearing the search.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="px-4 h-9 rounded-m3-full bg-surface-container border ff-hairline md-typescale-label-medium hover:bg-surface-container-high"
      >
        Clear filter
      </button>
    </div>
  );
}

function NoMatchState({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-m3-lg border border-dashed border-outline-variant py-16 px-8 text-center md-fade-in">
      <div className="ff-stamp-label mb-3">No matches</div>
      <h3 className="md-typescale-headline-medium text-on-surface mb-2">
        Nothing matches those filters
      </h3>
      <p className="md-typescale-body-medium text-on-surface-variant max-w-md mx-auto mb-4">
        Try clearing one filter or broadening the date range.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="px-4 h-9 rounded-m3-full bg-surface-container border ff-hairline md-typescale-label-medium hover:bg-surface-container-high"
      >
        Clear filters
      </button>
    </div>
  );
}

function SkuGroup({
  group,
  delay,
  onOpenAt,
  onShowListings,
}: {
  group: SkuGroupShape;
  delay: number;
  onOpenAt: (idx: number) => void;
  onShowListings?: (sku: string) => void;
}) {
  return (
    <Card className="md-fade-in" style={{ animationDelay: `${delay}ms` }}>
      <CardHeader>
        <div className="min-w-0">
          <CardEyebrow>
            {group.sku} · {group.category}
            {group.sellerName ? ` · ${group.sellerName}` : ""}
          </CardEyebrow>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            <CardTitle>
              {group.nameEn || group.nameZh || "(unnamed)"}
            </CardTitle>
            {group.isSample && (
              <Badge variant="outline" size="sm">
                展示样品 · demo
              </Badge>
            )}
          </div>
          {group.nameZh && group.nameZh !== group.nameEn && (
            <div className="md-typescale-body-medium text-on-surface-variant mt-0.5">
              {group.nameZh}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Badge variant="neutral" size="sm">
            {group.items.length} slot{group.items.length === 1 ? "" : "s"}
          </Badge>
          {onShowListings && (
            <button
              type="button"
              onClick={() => onShowListings(group.sku)}
              className="md-typescale-label-medium text-primary hover:underline whitespace-nowrap"
            >
              📝 View listings →
            </button>
          )}
          <StageProductButton
            assets={group.items}
            productLabel={group.nameEn || group.sku}
          />
          <BundleSkuButton group={group} />
        </div>
      </CardHeader>
      <div className="px-6 pb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {group.items.map((item, idx) => (
          <PlatformAssetTile
            key={item.id}
            item={item}
            sku={group.sku}
            onOpen={() => onOpenAt(idx)}
          />
        ))}
      </div>
    </Card>
  );
}

function PlatformAssetTile({
  item,
  sku,
  onOpen,
}: {
  item: PlatformAssetRow;
  sku: string;
  onOpen: () => void;
}) {
  const isImage = isImageFormat(item.format);
  const ratingVariant = scoreToVariant(item.complianceScore);
  const isReference = item.status === "reference";
  return (
    <div className="md-surface-container-low border ff-hairline rounded-m3-md overflow-hidden flex flex-col group">
      <div className="relative aspect-[4/3] bg-surface-container">
        {isImage ? (
          <ZoomTile
            src={item.r2Url}
            thumbSrc={item.thumbUrl ?? null}
            alt={`${item.platform} ${item.slot}`}
            onClick={onOpen}
          />
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
      <div className="px-4 py-3 flex flex-col gap-2">
        <CardEyebrow>
          {item.platform} · {item.slot}
        </CardEyebrow>
        <div className="flex items-baseline justify-between gap-2">
          <span className="md-typescale-body-small text-on-surface-variant font-mono text-[0.6875rem] truncate">
            {item.modelUsed ?? "—"}
          </span>
          <span className="md-typescale-body-small text-on-surface-variant/70 font-mono text-[0.6875rem] tabular-nums shrink-0">
            {formatCents(item.costCents)}
          </span>
        </div>
        {isImage && (
          <div className="pt-1 flex gap-2 flex-wrap">
            <DownloadAssetButton item={item} sku={sku} />
            <RegenAssetButton item={item} />
          </div>
        )}
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

// Suppress unused-import warning when PlatformFilter is referenced indirectly.
export type { PlatformFilter };
