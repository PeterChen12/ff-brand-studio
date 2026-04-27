"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardEyebrow,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

// ── Types mirroring Worker /api/products + /demo/launch-sku ──────────────
interface ProductRow {
  id: string;
  sku: string;
  nameEn: string;
  nameZh: string | null;
  category: string;
  materials: string[] | null;
  colorsHex: string[] | null;
  dimensions: Record<string, unknown> | null;
  loraUrl: string | null;
  sellerId: string;
  sellerNameEn: string | null;
  sellerNameZh: string | null;
}

type Rating = "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
type LaunchStatus = "succeeded" | "failed" | "hitl_blocked" | "cost_capped";
type SeoStatus =
  | "succeeded"
  | "partial"
  | "skipped"
  | "cost_capped"
  | "failed";

interface AdContentFlag {
  category: string;
  severity: "block" | "warn";
  matched: string;
  rule: string;
}
interface SeoSurfaceResult {
  surface: "amazon-us" | "tmall" | "jd" | "shopify";
  language: "en" | "zh";
  copy: Record<string, unknown> | null;
  raw_output?: string;
  flags: AdContentFlag[];
  violations: string[];
  rating: Rating;
  issues: string[];
  suggestions: string[];
  metrics: Record<string, unknown>;
  iterations: number;
  cost_cents: number;
}
interface AdapterResult {
  platform: string;
  slot: string;
  asset_id: string;
  spec_compliant: boolean;
  spec_violations: string[];
  final_rating?: string;
  iterations?: number;
  hitl_required?: boolean;
}
interface CanonicalRow {
  kind: string;
  model_used: string;
  cost_cents: number;
}
interface LaunchResult {
  run_id: string;
  product_id: string;
  product_sku: string;
  status: LaunchStatus;
  duration_ms: number;
  total_cost_cents: number;
  plan: {
    lifestyles: unknown[];
    variants: unknown[];
    produce_video: boolean;
    train_lora: boolean;
    adapter_targets: { platform: string; slot: string }[];
  };
  canonicals: CanonicalRow[];
  adapter_results: AdapterResult[];
  hitl_count: number;
  notes: string[];
  seo?: {
    status: SeoStatus;
    total_cost_cents: number;
    keyword_summary: {
      seed: string;
      expanded_count: number;
      cluster_count: number;
      top_reps: string[];
    };
    surfaces: SeoSurfaceResult[];
    notes: string[];
  };
}

const PLATFORMS: { id: "amazon" | "shopify"; label: string; sub: string }[] = [
  { id: "amazon", label: "Amazon US", sub: "amazon-us · en" },
  { id: "shopify", label: "Shopify DTC", sub: "shopify · en" },
];

const ratingVariant: Record<Rating, "passed" | "pending" | "flagged"> = {
  EXCELLENT: "passed",
  GOOD: "passed",
  FAIR: "pending",
  POOR: "flagged",
};

export function LaunchWizard({ mcpUrl }: { mcpUrl: string }) {
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [productErr, setProductErr] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [platforms, setPlatforms] = useState<("amazon" | "shopify")[]>([
    "amazon",
    "shopify",
  ]);
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${mcpUrl}/api/products`)
      .then((r) => r.json())
      .then((data: { products: ProductRow[] }) => {
        setProducts(data.products);
        if (data.products.length > 0 && !productId) {
          setProductId(data.products[0].id);
        }
      })
      .catch((err) => setProductErr(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mcpUrl]);

  const selected = products?.find((p) => p.id === productId) ?? null;

  function togglePlatform(id: "amazon" | "shopify") {
    setPlatforms((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleLaunch(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) return;
    setError(null);
    setResult(null);
    setLoading(true);
    setElapsedMs(0);
    const startTime = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - startTime), 250);
    try {
      const res = await fetch(`${mcpUrl}/demo/launch-sku`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: productId,
          platforms,
          dry_run: dryRun,
          include_seo: true,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`${res.status}: ${errText.slice(0, 300)}`);
      }
      const data = (await res.json()) as LaunchResult;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      clearInterval(timer);
      setLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-12 gap-6">
      {/* ── Step 01 — pick product ─────────────────────────────────────── */}
      <Card className="col-span-12 lg:col-span-7 md-fade-in">
        <CardHeader>
          <div>
            <CardEyebrow>Step 01 · 选品</CardEyebrow>
            <CardTitle className="mt-1.5">Pick a product</CardTitle>
          </div>
          {products && (
            <span className="md-typescale-label-small">
              {products.length} SKU{products.length === 1 ? "" : "s"} seeded
            </span>
          )}
        </CardHeader>
        <CardContent>
          {productErr && (
            <div className="rounded-m3-md border border-error/40 bg-error-container/40 px-4 py-3 mb-4">
              <span className="ff-stamp-label">api error</span>
              <span className="ml-3 md-typescale-body-small font-mono text-error-on-container">
                {productErr}
              </span>
            </div>
          )}
          {products === null ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="rounded-m3-md border border-dashed border-outline-variant py-12 px-6 text-center">
              <div className="ff-stamp-label mb-2">No products yet</div>
              <p className="md-typescale-body-medium text-on-surface-variant">
                Run <code className="font-mono text-[0.8125rem] text-primary">scripts/seed-demo-skus.mjs</code>{" "}
                to add the 3 fishing-rod demo SKUs.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-px md-surface-container border ff-hairline rounded-m3-md overflow-hidden">
              {products.map((p) => {
                const active = p.id === productId;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setProductId(p.id)}
                      className={cn(
                        "w-full text-left px-5 py-4 transition-colors duration-m3-short3",
                        active
                          ? "md-surface-container-high"
                          : "md-surface-container-lowest hover:md-surface-container-low"
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-3 flex-wrap">
                        <div className="flex items-baseline gap-3 min-w-0 flex-1">
                          <span
                            className={cn(
                              "inline-block h-2 w-2 rounded-full shrink-0",
                              active ? "bg-primary" : "bg-outline-variant"
                            )}
                          />
                          <div className="min-w-0">
                            <div className="md-typescale-title-small text-on-surface truncate">
                              {p.nameEn}
                            </div>
                            {p.nameZh && (
                              <div className="md-typescale-body-small text-on-surface-variant/80 truncate">
                                {p.nameZh}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="md-typescale-label-small text-on-surface-variant/70">
                            {p.category}
                          </span>
                          <span className="font-mono text-[0.6875rem] text-on-surface-variant/60">
                            {p.sku}
                          </span>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Step 02 + 03 — platforms + launch ──────────────────────────── */}
      <Card
        className="col-span-12 lg:col-span-5 md-fade-in"
        style={{ animationDelay: "100ms" }}
      >
        <CardHeader>
          <div>
            <CardEyebrow>Step 02 · 配置</CardEyebrow>
            <CardTitle className="mt-1.5">Configure & launch</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLaunch} className="flex flex-col gap-6">
            <div>
              <div className="ff-stamp-label mb-3">Marketplaces · 平台</div>
              <div className="flex flex-col gap-2">
                {PLATFORMS.map((p) => {
                  const active = platforms.includes(p.id);
                  return (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => togglePlatform(p.id)}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 rounded-m3-md border transition-colors duration-m3-short4 ease-m3-emphasized text-left",
                        active
                          ? "bg-primary-container text-primary-on-container border-primary"
                          : "md-surface-container-low text-on-surface-variant border-outline-variant hover:border-outline hover:text-on-surface"
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-m3-sm border transition-colors",
                          active
                            ? "bg-primary border-primary text-primary-on"
                            : "border-outline-variant"
                        )}
                      >
                        {active && (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path
                              d="M2 6.5L4.5 9L10 3"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </span>
                      <span className="flex-1 min-w-0">
                        <div className="md-typescale-title-small leading-tight">
                          {p.label}
                        </div>
                        <div className="md-typescale-body-small opacity-70">
                          {p.sub}
                        </div>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="ff-stamp-label mb-3">Image generation · 图片生成</div>
              <button
                type="button"
                onClick={() => setDryRun(!dryRun)}
                className={cn(
                  "flex items-center justify-between gap-3 px-4 py-3 w-full rounded-m3-md border transition-colors duration-m3-short3 text-left",
                  dryRun
                    ? "md-surface-container-high border-outline-variant"
                    : "bg-primary-container text-primary-on-container border-primary"
                )}
              >
                <div>
                  <div className="md-typescale-title-small">
                    {dryRun ? "Dry run · 仅 SEO" : "Full run · 图片 + SEO"}
                  </div>
                  <div className="md-typescale-body-small opacity-70 mt-0.5">
                    {dryRun
                      ? "Skip image generation (no FAL.ai cost). Real bilingual SEO still runs."
                      : "Generate canonical images via FLUX.2 + adapters · ~$0.30–1.50 / SKU"}
                  </div>
                </div>
                <span
                  className={cn(
                    "relative h-7 w-12 shrink-0 rounded-m3-full border-2 transition-colors duration-m3-short4",
                    dryRun
                      ? "bg-surface-container border-outline"
                      : "bg-primary border-primary"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-5 w-5 rounded-full transition-all duration-m3-short4 ease-m3-emphasized",
                      dryRun
                        ? "translate-x-0.5 bg-outline"
                        : "translate-x-[18px] bg-primary-on shadow-m3-1"
                    )}
                  />
                </span>
              </button>
            </div>

            <div className="flex items-center justify-between gap-4 pt-2">
              <Button
                type="submit"
                variant="accent"
                size="lg"
                disabled={loading || !productId || platforms.length === 0}
              >
                {loading
                  ? `Running · ${(elapsedMs / 1000).toFixed(1)}s`
                  : "Launch →"}
              </Button>
              <span className="md-typescale-label-small">
                ~10–50¢ / run<br />
                <span className="text-on-surface-variant/60">cap 50¢ on SEO</span>
              </span>
            </div>
            {selected && (
              <div className="md-typescale-body-small text-on-surface-variant/80 font-mono leading-relaxed pt-2 border-t ff-hairline">
                <span className="text-on-surface-variant">launching:</span>{" "}
                <span className="text-on-surface">{selected.sku}</span>
                {" → "}
                {platforms.length === 0 ? (
                  <span className="text-error">no platforms selected</span>
                ) : (
                  platforms.map((p) => (
                    <span key={p} className="text-primary">
                      {p}{" "}
                    </span>
                  ))
                )}
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {/* ── Error ─────────────────────────────────────────────────────── */}
      {error && (
        <div className="col-span-12 rounded-m3-md border border-error/40 bg-error-container/40 px-6 py-5 md-fade-in">
          <div className="ff-stamp-label mb-2">Pipeline error</div>
          <pre className="font-mono text-xs text-error-on-container whitespace-pre-wrap">
            {error}
          </pre>
        </div>
      )}

      {/* ── Result panel ──────────────────────────────────────────────── */}
      {result && <ResultPanel result={result} dryRun={dryRun} />}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Result panel
// ────────────────────────────────────────────────────────────────────────
function ResultPanel({
  result,
  dryRun,
}: {
  result: LaunchResult;
  dryRun: boolean;
}) {
  const seoSurfaces = result.seo?.surfaces ?? [];
  const allReadyToShip =
    seoSurfaces.length > 0 &&
    seoSurfaces.every(
      (s) => s.rating === "EXCELLENT" || s.rating === "GOOD"
    ) &&
    result.hitl_count === 0 &&
    result.status !== "failed";

  return (
    <Card className="col-span-12 md-fade-in">
      <CardHeader>
        <div>
          <CardEyebrow
            className={
              result.status === "succeeded"
                ? "text-ff-jade-deep"
                : result.status === "cost_capped"
                  ? "text-ff-amber"
                  : "text-error"
            }
          >
            ✓ launch {result.status} · {(result.duration_ms / 1000).toFixed(1)}s · {result.total_cost_cents}¢
          </CardEyebrow>
          <CardTitle className="mt-1.5 font-mono normal-case md-typescale-title-medium">
            {result.product_sku}
          </CardTitle>
        </div>
        {allReadyToShip ? (
          <Badge variant="passed">All ≥ GOOD · publish-ready</Badge>
        ) : (
          <Badge variant="pending">HITL · 人工复核</Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-7">
        {/* Image plan summary */}
        <div>
          <div className="ff-stamp-label mb-3">Image plan · 图片计划</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat
              label="canonicals"
              value={result.canonicals.length.toString()}
              hint={`${result.plan.lifestyles.length} lifestyles · ${result.plan.variants.length} variants`}
            />
            <Stat
              label="platform slots"
              value={result.adapter_results.length.toString()}
              hint={`${result.plan.adapter_targets.length} planned`}
            />
            <Stat
              label="HITL flags"
              value={result.hitl_count.toString()}
              hint={result.hitl_count === 0 ? "all clean" : "review needed"}
              tone={result.hitl_count === 0 ? "tertiary" : "amber"}
            />
            <Stat
              label="cost"
              value={`${result.total_cost_cents}¢`}
              hint={dryRun ? "dry run · SEO only" : "full pipeline"}
              tone="primary"
            />
          </div>
          {dryRun && (
            <div className="mt-3 md-typescale-body-small text-on-surface-variant/80 font-mono">
              dry-run mode — image generation skipped. Toggle off to generate
              real images via FLUX.2 + per-platform adapters.
            </div>
          )}
        </div>

        {/* SEO summary */}
        {result.seo && (
          <div>
            <div className="ff-stamp-label mb-3">SEO pipeline · 文案流水线</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Stat
                label="seed phrases"
                value={result.seo.keyword_summary.expanded_count.toLocaleString()}
                hint="autocomplete fan-out"
              />
              <Stat
                label="clusters"
                value={result.seo.keyword_summary.cluster_count.toString()}
                hint="distinct themes"
              />
              <Stat
                label="surfaces"
                value={`${seoSurfaces.length}/${result.adapter_results.length || result.plan.adapter_targets.length}`}
                hint="copy generated"
              />
              <Stat
                label="seo cost"
                value={`${result.seo.total_cost_cents}¢`}
                hint={`status: ${result.seo.status}`}
                tone="primary"
              />
            </div>
            {result.seo.keyword_summary.top_reps.length > 0 && (
              <div className="mb-4">
                <div className="md-typescale-label-small text-on-surface-variant mb-2">
                  Top keyword reps
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {result.seo.keyword_summary.top_reps.map((kw) => (
                    <span
                      key={kw}
                      className="inline-block px-2 py-0.5 md-surface-container-low border border-outline-variant rounded-m3-sm font-mono text-[0.6875rem] text-on-surface-variant"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {seoSurfaces.map((s) => (
                <SurfaceCard key={`${s.surface}-${s.language}`} s={s} />
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {result.notes.length > 0 && (
          <details className="md-surface-container-low border ff-hairline rounded-m3-sm">
            <summary className="px-3 py-2 cursor-pointer md-typescale-label-small text-on-surface-variant hover:text-on-surface">
              pipeline notes ({result.notes.length})
            </summary>
            <ul className="px-4 pb-3 pt-1 font-mono text-[0.6875rem] text-on-surface-variant space-y-1">
              {result.notes.map((n, i) => (
                <li key={i}>· {n}</li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>

      <CardFooter>
        <a
          href="/library"
          className="md-typescale-label-small text-ff-vermilion-deep hover:text-primary transition-colors"
        >
          See in library →
        </a>
        <button
          type="button"
          disabled={!allReadyToShip}
          className={cn(
            "px-4 h-9 rounded-m3-full md-typescale-label-medium uppercase tracking-stamp border transition-colors",
            allReadyToShip
              ? "border-tertiary text-ff-jade-deep hover:bg-tertiary hover:text-tertiary-on"
              : "border-outline-variant text-on-surface-variant/60 cursor-not-allowed"
          )}
          title={
            allReadyToShip
              ? "Publish to DAM (D8 follow-up)"
              : "Gated until every surface scores ≥ GOOD with no HITL flags"
          }
        >
          Publish to DAM →
        </button>
      </CardFooter>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "primary" | "tertiary" | "amber";
}) {
  const valueColor =
    tone === "primary"
      ? "text-ff-vermilion-deep"
      : tone === "tertiary"
        ? "text-ff-jade-deep"
        : tone === "amber"
          ? "text-ff-amber"
          : "text-on-surface";
  return (
    <div className="md-surface-container-low border ff-hairline rounded-m3-md px-4 py-3">
      <div className="md-typescale-label-small text-on-surface-variant/80">
        {label}
      </div>
      <div
        className={cn(
          "md-typescale-headline-small tabular-nums font-brand mt-1",
          valueColor
        )}
      >
        {value}
      </div>
      <div className="md-typescale-body-small text-on-surface-variant/70 font-mono mt-0.5">
        {hint}
      </div>
    </div>
  );
}

function SurfaceCard({ s }: { s: SeoSurfaceResult }) {
  const variant = ratingVariant[s.rating];
  const blockingFlags = s.flags.filter(
    (f) => f.severity === "block" || !f.severity
  );
  return (
    <div className="md-surface-container-low border ff-hairline rounded-m3-md flex flex-col">
      <div className="px-4 py-3 border-b ff-hairline flex items-center justify-between gap-2">
        <div>
          <CardEyebrow>
            {s.surface} · {s.language}
          </CardEyebrow>
          <div className="md-typescale-body-small text-on-surface-variant/70 mt-0.5 font-mono">
            iter {s.iterations} · {s.cost_cents}¢
          </div>
        </div>
        <Badge variant={variant}>{s.rating}</Badge>
      </div>

      <div className="px-4 py-3 flex-1 space-y-3">
        {s.copy ? (
          <CopyPreview copy={s.copy} />
        ) : (
          <div className="md-typescale-body-small text-error-on-container">
            ⚠ LLM did not return parseable JSON
            {s.raw_output && (
              <pre className="mt-2 font-mono text-[0.6875rem] whitespace-pre-wrap text-on-surface-variant">
                {s.raw_output.slice(0, 500)}
              </pre>
            )}
          </div>
        )}

        {blockingFlags.length > 0 && (
          <div className="border-l-2 border-error pl-3">
            <div className="ff-stamp-label text-error mb-1">Blocking flags</div>
            <ul className="font-mono text-[0.6875rem] text-on-surface-variant space-y-0.5">
              {blockingFlags.map((f, i) => (
                <li key={i}>
                  · <span className="text-error">{f.matched}</span>{" "}
                  <span className="text-on-surface-variant/70">({f.category})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {s.issues.length > 0 && (
          <details>
            <summary className="cursor-pointer md-typescale-label-small text-on-surface-variant hover:text-on-surface">
              issues ({s.issues.length})
            </summary>
            <ul className="mt-2 font-mono text-[0.6875rem] text-on-surface-variant space-y-0.5">
              {s.issues.slice(0, 6).map((iss, i) => (
                <li key={i}>· {iss}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function CopyPreview({ copy }: { copy: Record<string, unknown> }) {
  const title =
    typeof copy.title === "string"
      ? copy.title
      : typeof copy.h1 === "string"
        ? copy.h1
        : null;
  const meta =
    typeof copy.meta_description === "string"
      ? copy.meta_description
      : typeof copy.description === "string"
        ? copy.description.slice(0, 200)
        : typeof copy.long_description === "string"
          ? copy.long_description.slice(0, 200)
          : null;
  const bullets = Array.isArray(copy.bullets)
    ? (copy.bullets.filter((b) => typeof b === "string") as string[])
    : [];
  const searchTerms =
    typeof copy.search_terms === "string"
      ? copy.search_terms
      : typeof copy.backend_keywords === "string"
        ? copy.backend_keywords
        : null;

  return (
    <div className="space-y-2.5">
      {title && (
        <div>
          <div className="md-typescale-label-small text-on-surface-variant/70">
            Title
          </div>
          <p className="md-typescale-body-medium text-on-surface leading-snug font-medium">
            {title}
          </p>
        </div>
      )}
      {bullets.length > 0 && (
        <div>
          <div className="md-typescale-label-small text-on-surface-variant/70">
            Bullets · {bullets.length}
          </div>
          <ul className="md-typescale-body-small text-on-surface-variant leading-relaxed list-none space-y-1 mt-1">
            {bullets.slice(0, 5).map((b, i) => (
              <li key={i} className="pl-3 border-l border-outline-variant">
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}
      {meta && (
        <div>
          <div className="md-typescale-label-small text-on-surface-variant/70">
            {copy.meta_description ? "Meta" : "Description"}
          </div>
          <p className="md-typescale-body-small text-on-surface-variant leading-relaxed line-clamp-4">
            {meta}
          </p>
        </div>
      )}
      {searchTerms && (
        <div>
          <div className="md-typescale-label-small text-on-surface-variant/70">
            Backend keywords
          </div>
          <p className="font-mono text-[0.6875rem] text-on-surface-variant/80 break-all">
            {searchTerms}
          </p>
        </div>
      )}
    </div>
  );
}
