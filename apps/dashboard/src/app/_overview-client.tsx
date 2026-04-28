"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useApiFetch } from "@/lib/api";
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
import { cn } from "@/lib/cn";

interface Stats {
  totalSpend: number;
  launchCount: number;
  succeeded: number;
  hitl: number;
  assetCount: number;
  skuCount: number;
}

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
  const apiFetch = useApiFetch();
  const [stats, setStats] = useState<Stats | null>(null);
  const [launches, setLaunches] = useState<LaunchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<{ launches: LaunchRow[] }>("/api/launches"),
      apiFetch<{ platformAssets?: Array<{ sku?: string | null }> }>("/api/assets"),
    ])
      .then(([lData, aData]) => {
        const launches_ = lData.launches ?? [];
        const v2Assets = aData.platformAssets ?? [];
        setLaunches(launches_);
        const totalCents = launches_.reduce(
          (s, x) => s + (x.totalCostCents ?? 0),
          0
        );
        const skus = new Set(v2Assets.map((x) => x.sku).filter(Boolean));
        setStats({
          totalSpend: totalCents / 100,
          launchCount: launches_.length,
          succeeded: launches_.filter((x) => x.status === "succeeded").length,
          hitl: launches_.filter(
            (x) =>
              (x.hitlInterventions ?? 0) > 0 || x.status === "hitl_blocked"
          ).length,
          assetCount: v2Assets.length,
          skuCount: skus.size,
        });
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "fetch failed");
        setLaunches([]);
      });
  }, [apiFetch]);

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
        {error && (
          <div className="mb-8 rounded-m3-md border border-error/40 bg-error-container/40 px-5 py-4">
            <span className="ff-stamp-label">api error</span>
            <span className="ml-3 md-typescale-body-medium font-mono text-error-on-container">
              {error}
            </span>
          </div>
        )}

        {/* ── Hero — recent launches, the most actionable surface ─────────── */}
        <div className="mb-12 md-fade-in">
          <div className="flex items-baseline justify-between gap-4 mb-5 flex-wrap">
            <div>
              <div className="ff-stamp-label mb-2">Recent launches · 最近上线</div>
              <h2 className="md-typescale-headline-large text-on-surface">
                {launches === null
                  ? "Loading launches…"
                  : launches.length === 0
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

          {launches === null ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : launches.length === 0 ? (
            <FirstLaunchCTA />
          ) : (
            <div className="md-surface-container-low border ff-hairline rounded-m3-lg overflow-hidden">
              {launches.slice(0, 5).map((l, i) => (
                <LaunchRowItem key={l.id} launch={l} isLast={i === Math.min(launches.length, 5) - 1} />
              ))}
            </div>
          )}
        </div>

        {/* ── KPI ribbon — small, secondary, single line on desktop ────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px md-surface-container border ff-hairline rounded-m3-md overflow-hidden mb-14">
          <KpiCell
            label="Total spend"
            value={
              stats === null ? null : `$${stats.totalSpend.toFixed(2)}`
            }
            tone="primary"
          />
          <KpiCell
            label="Launches"
            value={stats === null ? null : stats.launchCount.toString()}
            sub={stats ? `${stats.succeeded} succeeded` : undefined}
          />
          <KpiCell
            label="SKUs"
            value={stats === null ? null : stats.skuCount.toString()}
            sub={stats ? `${stats.assetCount} assets` : undefined}
          />
          <KpiCell
            label="HITL holds"
            value={stats === null ? null : stats.hitl.toString()}
            sub="needing review"
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
                title="Launch a SKU"
                hint="Pick a product → get per-platform images + bilingual SEO copy + compliance scoring · ~10–50¢"
              />
              <ActionRow
                href="/library"
                index="02"
                title="Browse the library"
                hint="Every asset shipped, grouped by SKU + platform slot"
              />
              <ActionRow
                href="/costs"
                index="03"
                title="Review costs"
                hint="Per-run breakdowns across Sonnet, Flux, GPT Image 2, DataForSEO, Kling"
              />
            </CardContent>
            <CardFooter>
              <span className="md-typescale-label-small">v0.2.0 · live</span>
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
                <CardTitle className="mt-1.5">Compliance bands</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="md-typescale-body-small text-on-surface-variant leading-relaxed">
                Per-platform scores band into{" "}
                <span className="text-tertiary">EXCELLENT</span> / GOOD (publish-ready),{" "}
                <span className="text-ff-amber">FAIR</span> (HITL review), and{" "}
                <span className="text-error">POOR</span> (regenerate). The orchestrator retries up
                to 3× before holding for human review.
              </p>
            </CardContent>
            <CardFooter>
              <span>Optional Opus 4.7 vision pass · ~$0.02/asset</span>
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

// ────────────────────────────────────────────────────────────────────────
// Recent-launches list row + supporting helpers
// ────────────────────────────────────────────────────────────────────────
function LaunchRowItem({
  launch,
  isLast,
}: {
  launch: LaunchRow;
  isLast: boolean;
}) {
  const status = launch.status ?? "pending";
  const statusVariant: "passed" | "pending" | "flagged" =
    status === "succeeded"
      ? "passed"
      : status === "hitl_blocked" || status === "cost_capped"
        ? "pending"
        : "flagged";
  const ago = launch.createdAt ? relativeTime(launch.createdAt) : "—";
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
          <span className="md-typescale-title-medium text-on-surface group-hover:text-primary transition-colors truncate">
            {launch.productNameEn ?? launch.sku ?? "(unknown product)"}
          </span>
          {launch.sku && (
            <span className="md-typescale-label-small text-on-surface-variant/70 font-mono">
              {launch.sku}
            </span>
          )}
        </div>
        <div className="md-typescale-body-small text-on-surface-variant/80 mt-0.5 flex items-center gap-2.5 flex-wrap font-mono">
          <span>{ago}</span>
          {launch.durationMs !== null && (
            <>
              <span className="text-outline-variant">·</span>
              <span>{(launch.durationMs / 1000).toFixed(1)}s</span>
            </>
          )}
          {launch.totalCostCents !== null && (
            <>
              <span className="text-outline-variant">·</span>
              <span>{launch.totalCostCents}¢</span>
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
        {status}
      </Badge>
    </Link>
  );
}

function FirstLaunchCTA() {
  return (
    <div className="md-surface-container-low border border-dashed border-outline-variant rounded-m3-lg p-8 md-fade-in">
      <div className="ff-stamp-label mb-3">Get started · 三步上手</div>
      <h3 className="md-typescale-headline-small text-on-surface mb-2">
        Three steps to your first SKU
      </h3>
      <p className="md-typescale-body-medium text-on-surface-variant max-w-xl mb-6">
        Each step is reversible. Dry runs are free of FAL spend. Sample
        catalog SKUs (fishing rods) are visible until you onboard your own.
      </p>
      <ol className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-2">
        <OnboardStep
          n="01"
          title="Add a product"
          sub="Drop reference images + name + kind"
          href="/products/new"
          cta="Add product →"
        />
        <OnboardStep
          n="02"
          title="Launch"
          sub="Pick platforms + dry/full + see live cost"
          href="/launch"
          cta="Open wizard →"
        />
        <OnboardStep
          n="03"
          title="Inspect + ship"
          sub="Edit listings, regen images, export ZIP"
          href="/library"
          cta="Open library →"
        />
      </ol>
      <p className="md-typescale-body-small text-on-surface-variant mt-4">
        Need agency-side automation? Issue an API key in{" "}
        <Link href="/settings" className="text-primary underline">
          /settings
        </Link>
        .
      </p>
    </div>
  );
}

function OnboardStep({
  n,
  title,
  sub,
  href,
  cta,
}: {
  n: string;
  title: string;
  sub: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="rounded-m3-md md-surface-container border ff-hairline px-4 py-4 flex flex-col gap-2">
      <span className="ff-stamp-label text-ff-vermilion-deep">{n}</span>
      <div>
        <div className="md-typescale-title-small text-on-surface">{title}</div>
        <div className="md-typescale-body-small text-on-surface-variant mt-0.5">
          {sub}
        </div>
      </div>
      <Link
        href={href}
        className="md-typescale-label-medium text-primary hover:underline mt-auto"
      >
        {cta}
      </Link>
    </div>
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

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
