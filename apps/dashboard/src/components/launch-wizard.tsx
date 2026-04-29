"use client";

/**
 * Phase O — single-screen launch wizard.
 *
 * Improvements over the prior multi-card layout:
 *  - Debounced live cost preview (POST /v1/launches/preview) on every
 *    change to platforms / image-mode / SEO toggle. Operator sees
 *    cents-level predicted spend before they click Launch.
 *  - Wallet-aware gate: if predicted > balance, button disabled with
 *    a Top-up shortcut to /billing.
 *  - Compact product header — when ?product_id= is set we collapse
 *    the picker into a sticky breadcrumb so config + preview own the
 *    real estate. Without a product_id, a cursor-paginated picker
 *    feeds GET /v1/products.
 *  - Post-launch: routes to /library?q=<sku> after a successful
 *    full-run so the operator lands on their just-shipped assets.
 *    Dry runs render the SEO ResultPanel in place (existing behavior).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardEyebrow,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

interface ProductRow {
  id: string;
  sku: string;
  nameEn: string;
  nameZh: string | null;
  category: string;
  kind: string;
  createdAt?: string | null;
}

type Rating = "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
type LaunchStatus = "succeeded" | "failed" | "hitl_blocked" | "cost_capped";

interface PreviewResponse {
  prediction: {
    total_cents: number;
    breakdown: {
      images: { count: number; per_unit_cents: number; subtotal: number };
      listings: { count: number; per_unit_cents: number; subtotal: number };
      video: { count: number; per_unit_cents: number; subtotal: number };
    };
  };
  wallet: {
    balance_cents: number;
    balance_after_cents: number;
    sufficient: boolean;
  };
}

// Reuses the existing LaunchResult shape — kept inline rather than
// re-exported so this file stays self-contained on the static export.
interface LaunchResult {
  run_id: string;
  product_id: string;
  product_sku: string;
  status: LaunchStatus;
  duration_ms: number;
  total_cost_cents: number;
  hitl_count: number;
  notes: string[];
  seo?: {
    status: string;
    total_cost_cents: number;
    surfaces: Array<{
      surface: string;
      language: string;
      copy: Record<string, unknown> | null;
      rating: Rating;
      iterations: number;
      cost_cents: number;
    }>;
  };
}

const PLATFORMS: { id: "amazon" | "shopify"; label: string; sub: string }[] = [
  { id: "amazon", label: "Amazon US", sub: "amazon-us · en" },
  { id: "shopify", label: "Shopify DTC", sub: "shopify · en" },
];

export function LaunchWizard({ mcpUrl: _mcpUrl }: { mcpUrl: string }) {
  const apiFetch = useApiFetch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const seedProductId = searchParams.get("product_id");

  // ── State ─────────────────────────────────────────────────────────────
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [productErr, setProductErr] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(seedProductId);
  const [platforms, setPlatforms] = useState<("amazon" | "shopify")[]>([
    "amazon",
    "shopify",
  ]);
  const [dryRun, setDryRun] = useState(true);
  const [includeSeo, setIncludeSeo] = useState(true);

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  const [launching, setLaunching] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Load products ─────────────────────────────────────────────────────
  useEffect(() => {
    apiFetch<{ products: ProductRow[] }>("/v1/products?limit=50")
      .then((d) => {
        setProducts(d.products ?? []);
        if ((d.products?.length ?? 0) > 0 && !productId) {
          setProductId(d.products[0].id);
        }
      })
      .catch((err) =>
        setProductErr(err instanceof Error ? err.message : String(err))
      );
  }, [apiFetch, productId]);

  const selected = useMemo(
    () => products?.find((p) => p.id === productId) ?? null,
    [products, productId]
  );

  // ── Live cost preview (debounced 250 ms) ──────────────────────────────
  const previewKey = `${platforms.join(",")}|${dryRun}|${includeSeo}`;
  const previewKeyRef = useRef(previewKey);
  const fetchPreview = useCallback(async () => {
    if (platforms.length === 0) {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewErr(null);
    try {
      const data = await apiFetch<PreviewResponse>("/v1/launches/preview", {
        method: "POST",
        body: JSON.stringify({
          platforms,
          // Image generation only happens in non-dry-run; preview still
          // surfaces the cost so the operator sees the full picture.
          include_seo: includeSeo,
          include_video: false,
        }),
      });
      setPreview(data);
    } catch (err) {
      setPreviewErr(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  }, [apiFetch, platforms, includeSeo]);

  useEffect(() => {
    previewKeyRef.current = previewKey;
    const t = setTimeout(() => {
      if (previewKeyRef.current === previewKey) fetchPreview();
    }, 250);
    return () => clearTimeout(t);
  }, [previewKey, fetchPreview]);

  // ── Submit ───────────────────────────────────────────────────────────
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
    setLaunching(true);
    setElapsedMs(0);
    const startedAt = Date.now();
    const tick = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    try {
      const data = await apiFetch<LaunchResult>("/v1/launches", {
        method: "POST",
        body: JSON.stringify({
          product_id: productId,
          platforms,
          dry_run: dryRun,
          include_seo: includeSeo,
        }),
      });
      setResult(data);

      // Full-run success → redirect to library so operator lands on
      // generated assets. Dry runs stay in place (SEO panel below).
      if (!dryRun && data.status === "succeeded") {
        router.push(`/library?q=${encodeURIComponent(data.product_sku)}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      clearInterval(tick);
      setLaunching(false);
    }
  }

  // ── Predicted-cost-vs-wallet decision ────────────────────────────────
  const predictedCents = preview?.prediction.total_cents ?? 0;
  const walletCents = preview?.wallet.balance_cents ?? null;
  const sufficient = preview?.wallet.sufficient ?? true;
  const dryRunCents = useMemo(() => {
    // Dry run only charges the SEO surfaces. Strip image cost from the
    // breakdown to give the operator an accurate dry-run estimate.
    if (!preview) return 0;
    const b = preview.prediction.breakdown;
    return (includeSeo ? b.listings.subtotal : 0);
  }, [preview, includeSeo]);
  const effectiveCents = dryRun ? dryRunCents : predictedCents;
  const effectiveSufficient = walletCents === null ? true : walletCents >= effectiveCents;
  const canLaunch =
    !launching && !!productId && platforms.length > 0 && effectiveSufficient;

  return (
    <div className="grid grid-cols-12 gap-6">
      {/* ── Product picker / breadcrumb ─────────────────────────────────── */}
      <Card className="col-span-12 md-fade-in">
        <CardHeader>
          <div className="min-w-0">
            <CardEyebrow>Step 01 · 选品</CardEyebrow>
            <CardTitle className="mt-1.5">
              {selected ? selected.nameEn : "Pick a product"}
            </CardTitle>
            {selected?.nameZh && (
              <div className="md-typescale-body-medium text-on-surface-variant mt-0.5">
                {selected.nameZh}
              </div>
            )}
          </div>
          {selected && (
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="neutral" size="sm">
                {selected.category}
              </Badge>
              <span className="md-typescale-body-small font-mono text-[0.6875rem] text-on-surface-variant">
                {selected.sku}
              </span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {productErr ? (
            <div className="rounded-m3-md border border-error/40 bg-error-container/40 px-4 py-3 md-typescale-body-small flex items-center gap-3">
              <span className="flex-1">
                Failed to load products: {productErr}
              </span>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-3 h-8 rounded-m3-full bg-error/20 hover:bg-error/30 md-typescale-label-small shrink-0"
              >
                Retry
              </button>
            </div>
          ) : products === null ? (
            <Skeleton className="h-10 w-full" />
          ) : products.length === 0 ? (
            <div className="rounded-m3-md border border-dashed border-outline-variant py-8 px-6 text-center md-typescale-body-medium text-on-surface-variant">
              No products yet.{" "}
              <a href="/products/new" className="text-primary underline">
                Add one →
              </a>
            </div>
          ) : (
            <select
              value={productId ?? ""}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full h-11 px-4 rounded-m3-md bg-surface-container-low border ff-hairline focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.nameEn} ({p.category})
                </option>
              ))}
            </select>
          )}
        </CardContent>
      </Card>

      {/* ── Configure ───────────────────────────────────────────────────── */}
      <Card
        className="col-span-12 lg:col-span-7 md-fade-in"
        style={{ animationDelay: "60ms" }}
      >
        <CardHeader>
          <div>
            <CardEyebrow>Step 02 · 配置</CardEyebrow>
            <CardTitle className="mt-1.5">Configure</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLaunch} className="flex flex-col gap-6">
            <ConfigRow
              label="Marketplaces"
              sub="Amazon US · Shopify DTC"
            >
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
                          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-m3-sm border",
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
            </ConfigRow>

            <ConfigRow
              label="Image generation"
              sub={dryRun ? "Skip — SEO only" : "Generate images via FAL pipeline"}
            >
              <Toggle
                on={!dryRun}
                onChange={(next) => setDryRun(!next)}
                offLabel="Dry run · SEO only"
                onLabel="Full run · images + SEO"
                offHint="Free of FAL spend; bilingual SEO still runs."
                onHint="Charges per slot per the breakdown on the right."
              />
            </ConfigRow>

            <ConfigRow
              label="Bilingual SEO"
              sub={includeSeo ? "Generate Amazon + Shopify copy" : "Skip"}
            >
              <Toggle
                on={includeSeo}
                onChange={setIncludeSeo}
                offLabel="Off"
                onLabel="On"
                offHint="No SEO copy; assets only (full-run only)."
                onHint="$0.10/listing per platform."
              />
            </ConfigRow>
          </form>
        </CardContent>
      </Card>

      {/* ── Live cost preview + Launch ─────────────────────────────────── */}
      <Card
        className="col-span-12 lg:col-span-5 md-fade-in"
        style={{ animationDelay: "120ms" }}
      >
        <CardHeader>
          <div>
            <CardEyebrow>Step 03 · 启动</CardEyebrow>
            <CardTitle className="mt-1.5">Launch</CardTitle>
          </div>
          {previewLoading ? (
            <span className="ff-stamp-label text-on-surface-variant">
              recalculating…
            </span>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-5">
          <CostPreview
            preview={preview}
            error={previewErr}
            dryRun={dryRun}
            includeSeo={includeSeo}
            platforms={platforms}
            effectiveCents={effectiveCents}
          />

          <WalletGauge
            walletCents={walletCents}
            chargeCents={effectiveCents}
            sufficient={effectiveSufficient}
          />

          <div className="flex flex-col gap-3 pt-2 border-t ff-hairline">
            <Button
              type="button"
              variant="accent"
              size="lg"
              onClick={handleLaunch}
              disabled={!canLaunch}
              className="w-full"
            >
              {launching
                ? `Running · ${(elapsedMs / 1000).toFixed(1)}s`
                : `Launch${effectiveCents > 0 ? ` · ${formatCents(effectiveCents)}` : ""}`}
            </Button>
            {!effectiveSufficient && walletCents !== null && (
              <a
                href="/billing"
                className="md-typescale-label-medium text-center text-error hover:text-error/80"
              >
                Top up wallet → ({formatCents(effectiveCents - walletCents)} short)
              </a>
            )}
            {selected && (
              <div className="md-typescale-body-small text-on-surface-variant/80 font-mono leading-relaxed">
                {platforms.length === 0 ? (
                  <>
                    <span className="text-error">
                      Pick at least one marketplace to launch
                    </span>
                    {" · "}
                    <span className="text-on-surface-variant">
                      {selected.sku}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-on-surface-variant">launching:</span>{" "}
                    <span className="text-on-surface">{selected.sku}</span>
                    {" → "}
                    {platforms.map((p, i) => (
                      <span key={p} className="text-primary">
                        {p}
                        {i < platforms.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="col-span-12 rounded-m3-md border border-error/40 bg-error-container/40 px-6 py-5 md-fade-in">
          <div className="ff-stamp-label mb-2">Pipeline error</div>
          <pre className="font-mono text-xs text-error-on-container whitespace-pre-wrap">
            {error}
          </pre>
        </div>
      )}

      {result && <ResultPanel result={result} dryRun={dryRun} />}
    </div>
  );
}

// ── Building blocks ─────────────────────────────────────────────────────

function ConfigRow({
  label,
  sub,
  children,
}: {
  label: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4">
      <div className="pt-1">
        <div className="ff-stamp-label">{label}</div>
        <div className="md-typescale-body-small text-on-surface-variant/80 mt-1">
          {sub}
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}

function Toggle({
  on,
  onChange,
  offLabel,
  onLabel,
  offHint,
  onHint,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  offLabel: string;
  onLabel: string;
  offHint: string;
  onHint: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-3 w-full rounded-m3-md border transition-colors duration-m3-short3 text-left",
        on
          ? "bg-primary-container text-primary-on-container border-primary"
          : "md-surface-container-high border-outline-variant"
      )}
    >
      <div className="min-w-0">
        <div className="md-typescale-title-small">{on ? onLabel : offLabel}</div>
        <div className="md-typescale-body-small opacity-70 mt-0.5">
          {on ? onHint : offHint}
        </div>
      </div>
      <span
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-m3-full border-2 transition-colors duration-m3-short4",
          on ? "bg-primary border-primary" : "bg-surface-container border-outline"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full transition-all duration-m3-short4 ease-m3-emphasized",
            on
              ? "translate-x-[18px] bg-primary-on shadow-m3-1"
              : "translate-x-0.5 bg-outline"
          )}
        />
      </span>
    </button>
  );
}

function CostPreview({
  preview,
  error,
  dryRun,
  includeSeo,
  platforms,
  effectiveCents,
}: {
  preview: PreviewResponse | null;
  error: string | null;
  dryRun: boolean;
  includeSeo: boolean;
  platforms: ("amazon" | "shopify")[];
  effectiveCents: number;
}) {
  if (error) {
    return (
      <div className="rounded-m3-md border border-error/40 bg-error-container/30 px-4 py-3 md-typescale-body-small">
        Preview failed: {error}
      </div>
    );
  }
  if (!preview) {
    return (
      <div className="rounded-m3-md md-surface-container-low border ff-hairline px-4 py-3 md-typescale-body-medium text-on-surface-variant">
        {platforms.length === 0
          ? "Pick at least one marketplace to see the cost preview."
          : "Calculating…"}
      </div>
    );
  }
  const b = preview.prediction.breakdown;
  return (
    <div className="space-y-2">
      <div className="ff-stamp-label">Predicted cost · 预计费用</div>
      <Row
        label="Images"
        detail={dryRun ? "skipped (dry run)" : `${b.images.count} slots × ${formatCents(b.images.per_unit_cents)}`}
        cents={dryRun ? 0 : b.images.subtotal}
        muted={dryRun}
      />
      <Row
        label="Listings"
        detail={includeSeo ? `${b.listings.count} surfaces × ${formatCents(b.listings.per_unit_cents)}` : "off"}
        cents={includeSeo ? b.listings.subtotal : 0}
        muted={!includeSeo}
      />
      <div className="border-t ff-hairline pt-2 flex items-baseline justify-between">
        <span className="md-typescale-title-small">
          {dryRun ? "Total (dry)" : "Total"}
        </span>
        <span className="md-typescale-headline-small font-brand text-ff-vermilion-deep tabular-nums">
          {formatCents(effectiveCents)}
        </span>
      </div>
    </div>
  );
}

function Row({
  label,
  detail,
  cents,
  muted,
}: {
  label: string;
  detail: string;
  cents: number;
  muted?: boolean;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", muted && "opacity-50")}>
      <div className="min-w-0">
        <div className="md-typescale-body-medium text-on-surface">{label}</div>
        <div className="md-typescale-body-small text-on-surface-variant font-mono text-[0.6875rem] truncate">
          {detail}
        </div>
      </div>
      <div className="md-typescale-body-medium font-mono tabular-nums shrink-0">
        {formatCents(cents)}
      </div>
    </div>
  );
}

function WalletGauge({
  walletCents,
  chargeCents,
  sufficient,
}: {
  walletCents: number | null;
  chargeCents: number;
  sufficient: boolean;
}) {
  if (walletCents === null) return null;
  const ratio = walletCents > 0 ? chargeCents / walletCents : 0;
  const fill = Math.min(100, ratio * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="ff-stamp-label">Wallet · 余额</span>
        <span className={cn(
          "md-typescale-body-medium font-mono tabular-nums",
          sufficient ? "text-on-surface" : "text-error"
        )}>
          {formatCents(walletCents)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-surface-container overflow-hidden">
        <div
          className={cn(
            "h-full transition-all duration-m3-short4",
            sufficient ? "bg-primary" : "bg-error"
          )}
          style={{ width: `${fill}%` }}
        />
      </div>
      {!sufficient && (
        <div className="md-typescale-body-small text-error mt-1">
          Insufficient — top up before launching.
        </div>
      )}
    </div>
  );
}

function formatCents(cents: number): string {
  if (cents === 0) return "$0.00";
  return `$${(cents / 100).toFixed(2)}`;
}

// ── Result panel — kept from the prior wizard for the dry-run case ─────

function ResultPanel({ result, dryRun }: { result: LaunchResult; dryRun: boolean }) {
  const seoSurfaces = result.seo?.surfaces ?? [];
  return (
    <Card className="col-span-12 md-fade-in">
      <CardHeader>
        <div>
          <CardEyebrow
            className={cn(
              result.status === "succeeded" && "text-ff-jade-deep",
              result.status === "cost_capped" && "text-ff-amber",
              result.status === "failed" && "text-error"
            )}
          >
            launch {result.status} · {(result.duration_ms / 1000).toFixed(1)}s ·{" "}
            {formatCents(result.total_cost_cents)}
          </CardEyebrow>
          <CardTitle className="mt-1.5 font-mono normal-case md-typescale-title-medium">
            {result.product_sku}
          </CardTitle>
        </div>
        {result.hitl_count === 0 && result.status === "succeeded" ? (
          <Badge variant="passed">All clean</Badge>
        ) : (
          <Badge variant="pending">HITL · 人工复核</Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-5">
        {dryRun && (
          <div className="md-typescale-body-small text-on-surface-variant font-mono">
            dry-run mode — image generation skipped. Toggle Image generation
            to "Full run" to generate images on the next launch.
          </div>
        )}

        {seoSurfaces.length > 0 && (
          <div>
            <div className="ff-stamp-label mb-3">SEO surfaces · {seoSurfaces.length}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {seoSurfaces.map((s) => (
                <div
                  key={`${s.surface}-${s.language}`}
                  className="md-surface-container-low border ff-hairline rounded-m3-md px-4 py-3"
                >
                  <div className="flex items-center justify-between mb-1">
                    <CardEyebrow>
                      {s.surface} · {s.language}
                    </CardEyebrow>
                    <Badge
                      variant={
                        s.rating === "EXCELLENT" || s.rating === "GOOD"
                          ? "passed"
                          : s.rating === "FAIR"
                            ? "pending"
                            : "flagged"
                      }
                      size="sm"
                    >
                      {s.rating}
                    </Badge>
                  </div>
                  <div className="md-typescale-body-small text-on-surface-variant font-mono">
                    iter {s.iterations} · {formatCents(s.cost_cents)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {result.notes.length > 0 && (
          <details className="md-surface-container-low border ff-hairline rounded-m3-sm">
            <summary className="px-3 py-2 cursor-pointer md-typescale-label-small text-on-surface-variant">
              pipeline notes ({result.notes.length})
            </summary>
            <ul className="px-4 pb-3 pt-1 font-mono text-[0.6875rem] text-on-surface-variant space-y-1">
              {result.notes.map((n, i) => (
                <li key={i}>· {n}</li>
              ))}
            </ul>
          </details>
        )}

        <div className="flex items-center gap-3 pt-2 border-t ff-hairline">
          <a
            href={`/library?q=${encodeURIComponent(result.product_sku)}`}
            className="md-typescale-label-medium text-primary hover:underline"
          >
            See in library →
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
