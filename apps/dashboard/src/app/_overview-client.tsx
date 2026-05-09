"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useApiQuery } from "@/lib/api-query";
import {
  formatCents,
  formatDurationMs,
  formatTimestamp,
  friendlyStatus,
} from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardEyebrow,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

interface LaunchRow {
  id: string;
  productId: string;
  sku: string | null;
  productNameEn: string | null;
  productNameZh: string | null;
  category: string | null;
  status: string | null;
  totalCostCents: number | null;
  durationMs: number | null;
  hitlInterventions: number | null;
  createdAt: string | null;
}

export default function OverviewPage() {
  const now = useNow();

  const launchesQ = useApiQuery<{ launches: LaunchRow[] }>("/api/launches");
  const assetsQ = useApiQuery<{
    platformAssets?: Array<{ sku?: string | null }>;
  }>("/api/assets");

  const launches = launchesQ.data?.launches ?? null;
  const v2Assets = assetsQ.data?.platformAssets ?? null;
  const isLoading = launchesQ.isLoading || assetsQ.isLoading;
  const fetchError = launchesQ.error ?? assetsQ.error ?? null;

  const stats = useMemo(() => {
    if (launches === null || v2Assets === null) return null;
    // Phase C · Iter 07 — KPI ribbon scoped to last 30 days so a marketer
    // doesn't read "Total spend $42.50" as this-month when it's all-time.
    const cutoffMs = Date.now() - 30 * 86_400_000;
    const recent = launches.filter((x) => {
      if (!x.createdAt) return false;
      const t = Date.parse(x.createdAt);
      return Number.isFinite(t) && t >= cutoffMs;
    });
    const totalCents = recent.reduce(
      (s, x) => s + (x.totalCostCents ?? 0),
      0
    );
    const skus = new Set(v2Assets.map((x) => x.sku).filter(Boolean));
    return {
      totalSpend: totalCents / 100,
      launchCount: recent.length,
      succeeded: recent.filter((x) => x.status === "succeeded").length,
      hitl: launches.filter(
        (x) =>
          (x.hitlInterventions ?? 0) > 0 || x.status === "hitl_blocked"
      ).length,
      assetCount: v2Assets.length,
      skuCount: skus.size,
    };
  }, [launches, v2Assets]);

  function refetch() {
    launchesQ.mutate();
    assetsQ.mutate();
  }

  return (
    <>
      <PageHeader
        eyebrow="Overview · 总览"
        title="Product images and listings, at scale"
        description="High-quality product images and bilingual descriptions for Amazon US and Shopify DTC. Built for marketing agencies launching Chinese-seller catalogs into American marketplaces."
        action={
          <Link href="/launch">
            <Button variant="accent" size="lg">
              Launch a SKU →
            </Button>
          </Link>
        }
      />

      <section className="px-6 md:px-12 py-12 max-w-7xl mx-auto">
        {fetchError && (
          <div className="mb-8">
            <ErrorState
              title="Couldn't load your dashboard"
              error={fetchError}
              onRetry={refetch}
            />
          </div>
        )}

        {/* ── Hero — recent launches, the most actionable surface ─────────── */}
        <div className="mb-12 md-fade-in">
          <div className="flex items-baseline justify-between gap-4 mb-5 flex-wrap">
            <div>
              <div className="ff-stamp-label mb-2">Recent launches · 最近上线</div>
              <h2 className="md-typescale-headline-large text-on-surface">
                {isLoading
                  ? "Loading launches…"
                  : launches === null || launches.length === 0
                    ? "No launches yet"
                    : `Last ${launches.length} launch${launches.length === 1 ? "" : "es"}`}
              </h2>
            </div>
            {launches !== null && launches.length > 0 && (
              <Link
                href="/library"
                className="md-typescale-label-small text-ff-vermilion-deep hover:text-primary transition-colors"
              >
                See all in library →
              </Link>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {["s1", "s2", "s3"].map((id) => (
                <Skeleton key={id} className="h-16 w-full" />
              ))}
            </div>
          ) : launches === null || launches.length === 0 ? (
            <EmptyState
              eyebrow="Get started · 三步上手"
              title="Three steps to your first SKU"
              body="Each step is reversible. Preview-only runs are free. Sample products are visible until you onboard your own."
              steps={[
                {
                  index: "01",
                  title: "Add a product",
                  sub: "Drop reference images + product name",
                  href: "/products/new",
                  cta: "Add product →",
                },
                {
                  index: "02",
                  title: "Create your first listing",
                  sub: "Pick marketplaces, see live cost preview",
                  href: "/launch",
                  cta: "Open wizard →",
                },
                {
                  index: "03",
                  title: "Review and download",
                  sub: "Approve assets, edit copy, export ZIP",
                  href: "/library",
                  cta: "Open library →",
                },
              ]}
            />
          ) : (
            <div className="md-surface-container-low border ff-hairline rounded-m3-lg overflow-hidden">
              {launches.slice(0, 5).map((l, i) => (
                <LaunchRowItem
                  key={l.id}
                  launch={l}
                  isLast={i === Math.min(launches.length, 5) - 1}
                  now={now}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── KPI ribbon — small, secondary, single line on desktop ────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px md-surface-container border ff-hairline rounded-m3-md overflow-hidden mb-14">
          <KpiCell
            label="Spend (last 30 days)"
            value={
              stats === null ? null : `$${stats.totalSpend.toFixed(2)}`
            }
            tone="primary"
          />
          <KpiCell
            label="Listings (last 30 days)"
            value={stats === null ? null : stats.launchCount.toString()}
            sub={stats ? `${stats.succeeded} succeeded` : undefined}
          />
          <KpiCell
            label="SKUs"
            value={stats === null ? null : stats.skuCount.toString()}
            sub={stats ? `${stats.assetCount} assets` : undefined}
          />
          <KpiCell
            label="Needs review"
            value={stats === null ? null : stats.hitl.toString()}
            sub="awaiting approval"
            tone={stats && stats.hitl > 0 ? "amber" : "tertiary"}
          />
        </div>

        {/* ── Operator console — two cards side by side, asymmetric weight ─ */}
        <div className="grid grid-cols-12 gap-6">
          <Card
            className="col-span-12 md:col-span-8 md-fade-in"
            style={{ animationDelay: "200ms" }}
          >
            <CardHeader>
              <div>
                <CardEyebrow>Get started · 快速开始</CardEyebrow>
                <CardTitle className="mt-1.5">What would you like to do?</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              <ActionRow
                href="/launch"
                index="01"
                title="Create a listing"
                hint="Pick a product → get per-marketplace images + bilingual copy + quality grades · ~$0.10–$0.50"
              />
              <ActionRow
                href="/library"
                index="02"
                title="Browse the library"
                hint="Every asset shipped, grouped by product + marketplace slot"
              />
              <ActionRow
                href="/costs"
                index="03"
                title="Review costs"
                hint="Per-run breakdowns across image generation, listing copy, and quality checks"
              />
            </CardContent>
            <CardFooter>
              <span className="md-typescale-label-small">Quick actions</span>
              <Link
                href="/launch"
                className="md-typescale-label-small text-ff-vermilion-deep hover:text-primary transition-colors"
              >
                start —→
              </Link>
            </CardFooter>
          </Card>

          <Card
            className="col-span-12 md:col-span-4 md-fade-in"
            style={{ animationDelay: "280ms" }}
            variant="outlined"
          >
            <CardHeader>
              <div>
                <CardEyebrow>Reference · 参考</CardEyebrow>
                <CardTitle className="mt-1.5">Quality grades</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="md-typescale-body-small text-on-surface-variant leading-relaxed">
                Each generated asset gets a grade:{" "}
                <span className="text-tertiary">EXCELLENT</span> / GOOD (publish-ready),{" "}
                <span className="text-ff-amber">FAIR</span> (needs your review), and{" "}
                <span className="text-error">POOR</span> (regenerate). We retry up to 3× before
                routing to your inbox for human review.
              </p>
            </CardContent>
            <CardFooter>
              <span>Includes AI quality double-check · ~$0.02/asset</span>
            </CardFooter>
          </Card>
        </div>
      </section>
    </>
  );
}

function ActionRow({
  href,
  index,
  title,
  hint,
}: {
  href: string;
  index: string;
  title: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className={[
        "group flex items-baseline gap-4 px-4 py-4 -mx-2",
        "rounded-m3-md transition-colors duration-m3-short4 ease-m3-emphasized",
        "hover:bg-surface-container-low border-b ff-hairline last:border-0",
      ].join(" ")}
    >
      <span className="font-mono text-[0.6875rem] text-ff-vermilion-deep tracking-stamp shrink-0">
        {index}
      </span>
      <div className="flex-1 min-w-0">
        <div className="md-typescale-title-medium text-on-surface group-hover:text-primary transition-colors">
          {title}
        </div>
        <div className="md-typescale-body-small text-on-surface-variant/80 font-mono mt-0.5">
          {hint}
        </div>
      </div>
      <span className="font-mono text-[0.75rem] text-on-surface-variant/60 group-hover:text-primary group-hover:translate-x-1 transition-all duration-m3-short4 ease-m3-emphasized shrink-0">
        →
      </span>
    </Link>
  );
}

function LaunchRowItem({
  launch,
  isLast,
  now,
}: {
  launch: LaunchRow;
  isLast: boolean;
  now: number;
}) {
  const status = launch.status ?? "pending";
  const statusVariant: "passed" | "pending" | "flagged" =
    status === "succeeded"
      ? "passed"
      : status === "hitl_blocked" || status === "cost_capped"
        ? "pending"
        : "flagged";
  const ago = formatTimestamp(launch.createdAt, "relative", now);
  const fullName =
    launch.productNameEn ?? launch.sku ?? "(unknown product)";
  return (
    <Link
      href={`/library`}
      className={cn(
        "group flex items-center gap-4 px-5 py-4",
        "transition-colors duration-m3-short3 hover:bg-surface-container",
        !isLast && "border-b ff-hairline"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span
            className="md-typescale-title-medium text-on-surface group-hover:text-primary transition-colors truncate max-w-[40ch]"
            title={fullName}
          >
            {fullName}
          </span>
          {launch.sku && (
            <span
              className="md-typescale-label-small text-on-surface-variant/70 font-mono"
              title={launch.sku}
            >
              {launch.sku}
            </span>
          )}
        </div>
        <div className="md-typescale-body-small text-on-surface-variant/80 mt-0.5 flex items-center gap-2.5 flex-wrap font-mono">
          <span>{ago}</span>
          {launch.durationMs !== null && (
            <>
              <span className="text-outline-variant">·</span>
              <span>{formatDurationMs(launch.durationMs)}</span>
            </>
          )}
          {launch.totalCostCents !== null && (
            <>
              <span className="text-outline-variant">·</span>
              <span>{formatCents(launch.totalCostCents)}</span>
            </>
          )}
          {launch.hitlInterventions !== null && launch.hitlInterventions > 0 && (
            <>
              <span className="text-outline-variant">·</span>
              <span className="text-ff-amber">{launch.hitlInterventions} HITL</span>
            </>
          )}
        </div>
      </div>
      <Badge variant={statusVariant} size="sm">
        {friendlyStatus(status)}
      </Badge>
    </Link>
  );
}

function KpiCell({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | null;
  sub?: string;
  tone?: "primary" | "tertiary" | "amber";
}) {
  const valueClass =
    tone === "primary"
      ? "text-ff-vermilion-deep"
      : tone === "tertiary"
        ? "text-ff-jade-deep"
        : tone === "amber"
          ? "text-ff-amber"
          : "text-on-surface";
  return (
    <div className="md-surface-container-lowest px-5 py-4">
      <div className="ff-stamp-label">{label}</div>
      <div
        className={cn(
          "md-typescale-headline-small tabular-nums font-brand mt-1",
          valueClass
        )}
      >
        {value === null ? <Skeleton className="h-5 w-16" /> : value}
      </div>
      {sub && (
        <div className="md-typescale-body-small text-on-surface-variant/70 font-mono mt-0.5">
          {sub}
        </div>
      )}
    </div>
  );
}
