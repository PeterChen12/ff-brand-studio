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

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useApiFetch } from "@/lib/api";
import { formatCents } from "@/lib/format";
import type { PlatformAssetRow } from "@/db/schema";
import {
  BundleSkuButton,
  DownloadAssetButton,
} from "@/components/library/asset-actions";
import { StageProductButton } from "@/components/library/stage-product-button";
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
import { ListingCopy } from "@/components/listings/ListingCopy";
import { useTenant } from "@/lib/tenant-context";
import { cn } from "@/lib/cn";

interface ProductRow {
  id: string;
  sku: string;
  nameEn: string;
  nameZh: string | null;
  category: string;
  kind: string;
  createdAt?: string | null;
  isSample?: boolean;
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
      grounding?: {
        rating: "GROUNDED" | "PARTIALLY_GROUNDED" | "UNGROUNDED";
        ungrounded_claims: string[];
        confidence?: number;
        source?: "ai" | "fallback";
      } | null;
    }>;
  };
}

type SeoLang = "en" | "zh";

// Phase C · Iteration 05 — quality preset for marketers. Internal model
// routing (ADR-0002) is hidden; the marketer picks a tier and the
// per-image price is the only number that matters to her.
const QUALITY_PRESETS: {
  id: "budget" | "balanced" | "premium";
  label: string;
  hint: string;
  perImageCents: number;
}[] = [
  {
    id: "balanced",
    label: "Recommended · 推荐",
    hint: "Best image quality for the price",
    perImageCents: 50,
  },
  {
    id: "premium",
    label: "Best performing · 最佳画质",
    hint: "4K lifestyle imagery, full-quality infographics",
    perImageCents: 70,
  },
  {
    id: "budget",
    label: "Most cost saving · 经济",
    hint: "Lower-cost batch generation, ~30% cheaper per image",
    perImageCents: 35,
  },
];

export function LaunchWizard({ mcpUrl: _mcpUrl }: { mcpUrl: string }) {
  const apiFetch = useApiFetch();
  const searchParams = useSearchParams();
  const seedProductId = searchParams.get("product_id");
  // Phase C · Iteration 03 — read tenant defaults so a marketer doesn't
  // have to re-pick output language + quality preset every launch.
  const tenant = useTenant();
  const tenantDefaultLangs = useMemo<SeoLang[]>(() => {
    const raw = tenant?.features?.default_output_langs;
    if (Array.isArray(raw)) {
      const filtered = raw.filter((l): l is SeoLang => l === "en" || l === "zh");
      if (filtered.length > 0) return filtered;
    }
    return ["en"];
  }, [tenant?.features?.default_output_langs]);
  const tenantDefaultQuality = useMemo<
    "budget" | "balanced" | "premium"
  >(() => {
    const raw = tenant?.features?.default_quality_preset;
    if (raw === "budget" || raw === "balanced" || raw === "premium") return raw;
    return "balanced";
  }, [tenant?.features?.default_quality_preset]);

  // ── State ─────────────────────────────────────────────────────────────
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [productErr, setProductErr] = useState<string | null>(null);
  // productNotice is non-fatal feedback (e.g. "your bookmarked product
  // was deleted, we picked a default"). Distinct from productErr which
  // replaces the dropdown with a retry block — see Bug 4 fix.
  const [productNotice, setProductNotice] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(seedProductId);
  // Phase C · Iteration 02 — marketplace selection becomes real. Mei
  // (the marketing PM persona) picks which marketplaces she actually
  // sells on; we generate only those. Defaults to both for backwards
  // compat. Deselecting both is refused with a soft warning.
  const [outputLangs, setOutputLangs] = useState<SeoLang[]>(tenantDefaultLangs);
  const [platforms, setPlatforms] = useState<("amazon" | "shopify")[]>([
    "amazon",
    "shopify",
  ]);
  const togglePlatform = useCallback((p: "amazon" | "shopify") => {
    setPlatforms((prev) => {
      if (prev.includes(p)) {
        const next = prev.filter((x) => x !== p);
        if (next.length === 0) return prev; // refuse deselect-all
        return next;
      }
      return [...prev, p];
    });
  }, []);
  const surfaces = useMemo(
    () =>
      outputLangs.flatMap((lang) =>
        platforms.map((p) => ({
          surface: (p === "amazon" ? "amazon-us" : "shopify") as
            | "amazon-us"
            | "shopify",
          language: lang,
        }))
      ),
    [outputLangs, platforms]
  );
  // Issue 8 — model-routing preset. budget/balanced/premium changes
  // the per-image price (35¢/50¢/70¢) and downstream model selection
  // per ADR-0002. balanced is the current default. Phase C · Iter 03 —
  // initial value comes from tenant defaults.
  const [qualityPreset, setQualityPreset] = useState<
    "budget" | "balanced" | "premium"
  >(tenantDefaultQuality);
  // Sync state if tenant defaults arrive after first render (poll race).
  useEffect(() => {
    setOutputLangs((prev) =>
      prev === tenantDefaultLangs ? prev : tenantDefaultLangs
    );
    setQualityPreset((prev) =>
      prev === tenantDefaultQuality ? prev : tenantDefaultQuality
    );
    // Intentionally only on tenant-default changes; user edits aren't
    // overwritten because the prev-equals-default check would be false.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantDefaultLangs, tenantDefaultQuality]);
  // Phase C · Iteration 02 — full-run is the default. First-time users
  // running with dryRun=true got no images and didn't know why.
  const [dryRun, setDryRun] = useState(false);

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  const [launching, setLaunching] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Assets generated by the just-completed launch — populated only on
  // a successful full-run so ResultPanel can surface a download bundle
  // inline (Issue 9). null = not yet fetched, [] = fetched but empty.
  const [launchAssets, setLaunchAssets] = useState<PlatformAssetRow[] | null>(
    null
  );

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

  // ── Validate seed product_id against loaded list ─────────────────────
  // Catches orphan IDs from bookmarked / shared URLs (deleted products,
  // wrong tenant, typos). Without this the orphan ID stays in state and
  // a submit fires POST /v1/launches with a missing product_id, surfacing
  // a generic 4xx instead of an obvious "this product doesn't exist."
  useEffect(() => {
    if (!products || !seedProductId) return;
    const exists = products.some((p) => p.id === seedProductId);
    if (exists) return;
    // Default to first available, surface a non-blocking notice, strip
    // the bad query param so a refresh doesn't re-trigger this branch.
    const fallbackId = products[0]?.id ?? null;
    setProductId(fallbackId);
    setProductNotice(
      `Product '${seedProductId}' wasn't found — defaulted to ${
        fallbackId ? "the first available SKU." : "(no products yet)."
      }`
    );
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("product_id");
      window.history.replaceState({}, "", url.toString());
    }
  }, [products, seedProductId]);

  const selected = useMemo(
    () => products?.find((p) => p.id === productId) ?? null,
    [products, productId]
  );

  // ── Live cost preview (debounced 250 ms) ──────────────────────────────
  const seoEnabled = surfaces.length > 0;
  const surfacesKey = surfaces
    .map((s) => `${s.surface}:${s.language}`)
    .join(",");
  const previewKey = `${platforms.join(",")}|${dryRun}|${surfacesKey}|${qualityPreset}`;
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
          // Issue 7+10 — explicit per-surface targeting. The worker
          // computes surface_count from this; falls back to legacy
          // include_seo if surfaces is omitted.
          surfaces,
          include_video: false,
          // Issue 8 — preset gates the per-image price (35/50/70¢).
          quality_preset: qualityPreset,
        }),
      });
      setPreview(data);
    } catch (err) {
      setPreviewErr(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  }, [apiFetch, platforms, surfaces, qualityPreset]);

  useEffect(() => {
    previewKeyRef.current = previewKey;
    const t = setTimeout(() => {
      if (previewKeyRef.current === previewKey) fetchPreview();
    }, 250);
    return () => clearTimeout(t);
  }, [previewKey, fetchPreview]);

  // ── Submit ───────────────────────────────────────────────────────────
  async function handleLaunch(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) return;
    setError(null);
    setResult(null);
    setLaunchAssets(null);
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
          // Issue 7+10 — surfaces drives both per-surface SEO and the
          // cost prediction. Worker treats include_seo as derived from
          // surfaces.length when surfaces is provided.
          surfaces,
          include_seo: seoEnabled,
          // Issue 8 — preset for model routing + per-image pricing.
          quality_preset: qualityPreset,
        }),
      });
      setResult(data);

      // Full-run success → fetch generated assets so ResultPanel can
      // show a download bundle inline (Issue 9). Operators stay on
      // the launch page; "View in library" stays as a secondary link
      // for those who want the full asset browser. Dry runs skip
      // this — no images were generated.
      if (!dryRun && data.status === "succeeded") {
        try {
          const assetData = await apiFetch<{
            platformAssets: PlatformAssetRow[];
          }>("/api/assets");
          const productAssets = (assetData.platformAssets ?? []).filter(
            (a) => a.productId === data.product_id
          );
          setLaunchAssets(productAssets);
        } catch (assetErr) {
          // Non-fatal — the "View in library" link still works.
          if (typeof console !== "undefined") {
            // eslint-disable-next-line no-console
            console.warn("[launch] asset fetch failed", assetErr);
          }
          setLaunchAssets([]);
        }
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
    return seoEnabled ? b.listings.subtotal : 0;
  }, [preview, seoEnabled]);
  const effectiveCents = dryRun ? dryRunCents : predictedCents;
  const effectiveSufficient = walletCents === null ? true : walletCents >= effectiveCents;
  const canLaunch =
    !launching && !!productId && platforms.length > 0 && effectiveSufficient;

  // Phase C · Iter 12 — three-step indicator. Step 1 (Pick product) is
  // done once productId is set; Step 2 (Configure) is the active state
  // while we're on this page; Step 3 (Launch) is done once a launch
  // result exists. Stays static-positioned at the top of the grid so
  // the user always has a "where am I" anchor.
  const stepperState: ("done" | "active" | "future")[] = [
    productId ? "done" : "active",
    productId && !result ? "active" : productId ? "done" : "future",
    result ? "active" : "future",
  ];

  return (
    <div className="grid grid-cols-12 gap-6">
      <LaunchStepper state={stepperState} />
      {/* ── Product picker / breadcrumb ─────────────────────────────────── */}
      <Card className="col-span-12 md-fade-in">
        <CardHeader>
          <div className="min-w-0">
            <CardEyebrow>Step 01 · 选品</CardEyebrow>
            <CardTitle className="mt-1.5">
              {selected
                ? selected.nameEn || selected.nameZh || "(unnamed)"
                : "Pick a product"}
            </CardTitle>
            {selected?.nameZh && selected.nameZh !== selected.nameEn && (
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
          {productNotice && (
            <div className="rounded-m3-md border border-ff-amber/40 bg-ff-amber/10 px-4 py-3 mb-3 md-typescale-body-small flex items-start gap-3">
              <span className="flex-1">{productNotice}</span>
              <button
                type="button"
                onClick={() => setProductNotice(null)}
                className="text-on-surface-variant hover:text-on-surface md-typescale-label-small shrink-0"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}
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
            <ProductPicker
              products={products}
              value={productId}
              onChange={setProductId}
            />
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
              sub="Pick where you sell · 选择销售渠道"
            >
              <div className="flex flex-col gap-5">
                {/* Phase C · Iteration 02 — real toggle pills. Click to
                    select/deselect; deselect-all is refused (need ≥1). */}
                <div>
                  <div className="ff-stamp-label mb-2">Generate for</div>
                  <div role="group" className="flex flex-wrap items-center gap-2">
                    {(
                      [
                        { id: "amazon" as const, label: "Amazon US", spec: "7 image specs" },
                        { id: "shopify" as const, label: "Shopify DTC", spec: "5 image specs" },
                      ]
                    ).map((mkt) => {
                      const active = platforms.includes(mkt.id);
                      const wouldRemoveLast = active && platforms.length === 1;
                      return (
                        <button
                          key={mkt.id}
                          type="button"
                          role="checkbox"
                          aria-checked={active}
                          aria-disabled={wouldRemoveLast}
                          onClick={() => togglePlatform(mkt.id)}
                          title={
                            wouldRemoveLast
                              ? "At least one marketplace required"
                              : active
                                ? "Click to remove"
                                : "Click to add"
                          }
                          className={cn(
                            "inline-flex items-center gap-2 px-3 h-9 rounded-m3-full md-typescale-label-medium border transition-colors duration-m3-short3",
                            active
                              ? "bg-primary-container text-primary-on-container border-primary"
                              : "border-outline-variant text-on-surface-variant bg-surface-container hover:bg-surface-container-high",
                            wouldRemoveLast && "cursor-not-allowed opacity-70"
                          )}
                        >
                          <span aria-hidden="true">{active ? "✓" : "+"}</span>
                          <span>{mkt.label}</span>
                          <span className="text-on-surface-variant/70 text-[0.6875rem]">
                            {mkt.spec}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="md-typescale-body-small text-on-surface-variant/70 mt-1.5">
                    Auto-publish to Seller Central / Shopify Admin is an enterprise feature —{" "}
                    <a
                      href="/settings?tab=channels"
                      className="text-primary hover:underline"
                    >
                      set up in Settings · Channels →
                    </a>
                  </p>
                </div>

                {/* Output language — single shared radio. Both
                    marketplaces render copy in the chosen language(s). */}
                <div>
                  <div className="ff-stamp-label mb-2">Output language</div>
                  <div role="radiogroup" className="flex flex-wrap items-center gap-2">
                    {(
                      [
                        { id: "en", label: "English only", langs: ["en"] as SeoLang[] },
                        { id: "zh", label: "中文 only", langs: ["zh"] as SeoLang[] },
                        { id: "both", label: "Both languages", langs: ["en", "zh"] as SeoLang[] },
                      ] as const
                    ).map((choice) => {
                      const active =
                        outputLangs.length === choice.langs.length &&
                        choice.langs.every((l) => outputLangs.includes(l));
                      return (
                        <button
                          key={choice.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setOutputLangs([...choice.langs])}
                          className={cn(
                            "px-3 h-8 rounded-m3-full md-typescale-label-medium border transition-colors duration-m3-short3",
                            active
                              ? "bg-primary text-primary-on border-primary"
                              : "border-outline-variant text-on-surface bg-surface-container hover:bg-surface-container-high"
                          )}
                        >
                          {active ? "✓ " : ""}
                          {choice.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </ConfigRow>

            <ConfigRow label="Quality" sub="Routing preset · 模型选择">
              <div className="flex flex-col gap-2">
                {QUALITY_PRESETS.map((q) => {
                  const active = qualityPreset === q.id;
                  return (
                    <button
                      type="button"
                      key={q.id}
                      onClick={() => setQualityPreset(q.id)}
                      className={cn(
                        "flex items-start gap-3 px-4 py-3 rounded-m3-md border transition-colors duration-m3-short4 ease-m3-emphasized text-left",
                        active
                          ? "bg-primary-container text-primary-on-container border-primary"
                          : "md-surface-container-low text-on-surface-variant border-outline-variant hover:border-outline hover:text-on-surface"
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border mt-0.5",
                          active
                            ? "bg-primary border-primary text-primary-on"
                            : "border-outline-variant"
                        )}
                      >
                        {active && (
                          <span className="block h-2 w-2 rounded-full bg-primary-on" />
                        )}
                      </span>
                      <span className="flex-1 min-w-0">
                        <div className="md-typescale-title-small leading-tight">
                          {q.label}
                        </div>
                        <div className="md-typescale-body-small opacity-80 mt-0.5">
                          {q.hint} · {formatCents(q.perImageCents)}/image
                        </div>
                      </span>
                    </button>
                  );
                })}
              </div>
            </ConfigRow>

            <ConfigRow
              label="Image generation"
              sub={dryRun ? "Preview only · free" : "Generate images · charges wallet"}
            >
              <Toggle
                on={!dryRun}
                onChange={(next) => setDryRun(!next)}
                offLabel="Preview only · free"
                onLabel="Generate images · charges wallet"
                offHint="Skip image generation; SEO listing copy still runs."
                onHint="Charges per slot per the breakdown on the right."
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
            seoEnabled={seoEnabled}
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

      {result && (
        <ResultPanel
          result={result}
          dryRun={dryRun}
          assets={launchAssets}
          productNameEn={selected?.nameEn ?? result.product_sku}
          onAssetUpdated={(assetId, newR2Url) => {
            setLaunchAssets((prev) =>
              prev
                ? prev.map((a) =>
                    a.id === assetId
                      ? { ...a, r2Url: newR2Url, thumbUrl: newR2Url }
                      : a
                  )
                : prev
            );
          }}
        />
      )}
    </div>
  );
}

// ── Building blocks ─────────────────────────────────────────────────────

// Phase C · Iter 12 — three-step horizontal stepper. Mei sees where she
// is in the flow (Product → Configure → Launch) without inferring it
// from the eyebrow stamps on each card.
function LaunchStepper({
  state,
}: {
  state: ("done" | "active" | "future")[];
}) {
  const steps = [
    { label: "Pick product", sub: "选品" },
    { label: "Configure", sub: "配置" },
    { label: "Launch", sub: "启动" },
  ];
  return (
    <div className="col-span-12">
      <ol className="flex items-center gap-2 md-typescale-label-medium">
        {steps.map((s, i) => {
          const status = state[i] ?? "future";
          const isLast = i === steps.length - 1;
          return (
            <li key={s.label} className="flex items-center gap-2 min-w-0">
              <span
                aria-hidden="true"
                className={cn(
                  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-mono",
                  status === "done" &&
                    "bg-tertiary text-on-tertiary",
                  status === "active" &&
                    "bg-primary text-primary-on shadow-m3-1",
                  status === "future" &&
                    "bg-surface-container text-on-surface-variant/60 border ff-hairline"
                )}
              >
                {status === "done" ? "✓" : i + 1}
              </span>
              <span
                className={cn(
                  "shrink-0",
                  status === "active"
                    ? "text-on-surface"
                    : "text-on-surface-variant"
                )}
              >
                {s.label}
                <span className="text-on-surface-variant/60 ml-1.5">
                  {s.sub}
                </span>
              </span>
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-px flex-1 min-w-[1.5rem]",
                    state[i] === "done" || state[i] === "active"
                      ? "bg-outline"
                      : "bg-outline-variant"
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// Phase C · Iter 09 — searchable product picker. Replaces the native
// <select> that became unusable past ~50 SKUs. Filters case-insensitively
// across SKU, English name, Chinese name, and category. Shows the
// selected product compactly when collapsed.
function ProductPicker({
  products,
  value,
  onChange,
}: {
  products: ProductRow[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = products.find((p) => p.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products.slice(0, 50);
    return products
      .filter((p) => {
        const hay = [p.sku, p.nameEn, p.nameZh, p.category]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 50);
  }, [products, query]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full h-11 px-4 rounded-m3-md bg-surface-container-low border ff-hairline text-left hover:bg-surface-container transition-colors flex items-center justify-between gap-3"
      >
        <span className="truncate">
          {selected ? (
            <>
              {selected.isSample && (
                <span className="text-on-surface-variant/70 mr-1">[demo]</span>
              )}
              <span className="font-mono text-[0.75rem] text-on-surface-variant/80 mr-2">
                {selected.sku}
              </span>
              <span>
                {selected.nameEn || selected.nameZh || "(unnamed)"}
              </span>
            </>
          ) : (
            <span className="text-on-surface-variant">Pick a product…</span>
          )}
        </span>
        <span className="text-on-surface-variant/60">⌄</span>
      </button>
    );
  }

  return (
    <div className="rounded-m3-md bg-surface-container-low border ff-hairline">
      <div className="p-2 flex items-center gap-2 border-b ff-hairline">
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, SKU, or category…"
          className="flex-1 h-9 px-3 rounded-m3-md bg-transparent md-typescale-body-medium focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-9 px-3 md-typescale-label-medium text-on-surface-variant hover:text-on-surface"
        >
          Cancel
        </button>
      </div>
      <ul role="listbox" className="max-h-80 overflow-y-auto">
        {filtered.length === 0 ? (
          <li className="px-4 py-6 text-center md-typescale-body-medium text-on-surface-variant">
            No products match "{query}".
          </li>
        ) : (
          filtered.map((p) => {
            const isActive = p.id === value;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "w-full text-left px-4 py-2.5 flex items-baseline gap-3 hover:bg-surface-container transition-colors",
                    isActive && "bg-primary-container/40"
                  )}
                >
                  {p.isSample && (
                    <span className="md-typescale-body-small text-on-surface-variant/70 shrink-0">
                      [demo]
                    </span>
                  )}
                  <span className="font-mono text-[0.6875rem] text-on-surface-variant/80 shrink-0">
                    {p.sku}
                  </span>
                  <span className="flex-1 truncate">
                    {p.nameEn || p.nameZh || "(unnamed)"}
                  </span>
                  <span className="md-typescale-body-small text-on-surface-variant/60 shrink-0">
                    {p.category}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

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
  seoEnabled,
  platforms,
  effectiveCents,
}: {
  preview: PreviewResponse | null;
  error: string | null;
  dryRun: boolean;
  seoEnabled: boolean;
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
        detail={seoEnabled ? `${b.listings.count} listings × ${formatCents(b.listings.per_unit_cents)}` : "off — images only"}
        cents={seoEnabled ? b.listings.subtotal : 0}
        muted={!seoEnabled}
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


// ── Image QA Layer 3 — Tweak Image panel ──────────────────────────────
//
// Per-asset chat-style iteration: pick an image, type "rod is cropped —
// show the full length end-to-end", submit. Calls /v1/assets/:id/regenerate
// which merges the instruction into the FAL prompt. Caps at 5 client
// iterations per asset (enforced by the worker) — at the cap the panel
// disables and points the user at the Calendly schedule link.
function TweakImagePanel({
  assets,
  sku,
  onAssetUpdated,
}: {
  assets: PlatformAssetRow[];
  sku: string;
  onAssetUpdated: (assetId: string, newR2Url: string) => void;
}) {
  const apiFetch = useApiFetch();
  const [selectedId, setSelectedId] = useState<string>(assets[0]?.id ?? "");
  const [instruction, setInstruction] = useState("");
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  // Per-asset client-iteration counts. Initialized to 0; updated from
  // each regen response. We don't pre-fetch from /v1/assets/:id/iterations
  // because the asset is fresh — the count starts at 0 in this flow.
  const [iterations, setIterations] = useState<
    Record<string, { used: number; cap: number }>
  >({});

  const selected = assets.find((a) => a.id === selectedId);
  const selectedIters = iterations[selectedId];
  const cap = selectedIters?.cap ?? 5;
  const used = selectedIters?.used ?? 0;
  const remaining = cap - used;
  const atCap = remaining <= 0;
  const canSubmit =
    !busyAssetId && instruction.trim().length >= 4 && selectedId && !atCap;

  async function handleSubmit() {
    if (!canSubmit || !selected) return;
    setBusyAssetId(selectedId);
    try {
      const res = await apiFetch<{
        r2Url: string;
        costCents: number;
        asset_iterations?: { used: number; cap: number };
      }>(`/v1/assets/${selectedId}/regenerate`, {
        method: "POST",
        body: JSON.stringify({ feedback: instruction.trim().slice(0, 500) }),
      });
      onAssetUpdated(selectedId, res.r2Url);
      if (res.asset_iterations) {
        setIterations((prev) => ({
          ...prev,
          [selectedId]: res.asset_iterations as { used: number; cap: number },
        }));
      }
      setInstruction("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const apiErr = err as { status?: number };
      // Backend returns 429 with asset_iterations on cap-reached.
      if (apiErr?.status === 429) {
        const detail = (err as { body?: { asset_iterations?: { used: number; cap: number } } })
          ?.body?.asset_iterations;
        if (detail) {
          setIterations((prev) => ({ ...prev, [selectedId]: detail }));
        }
      }
      // Surface via console; the global ErrorState/Toaster catches the
      // ApiError if it bubbles via SWR; here it's a direct apiFetch
      // call so we just log and reset.
      // eslint-disable-next-line no-console
      console.error("[regen]", msg);
    } finally {
      setBusyAssetId(null);
    }
  }

  return (
    <div className="mt-5 md-surface-container-low border ff-hairline rounded-m3-md px-5 py-4">
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <div>
          <div className="ff-stamp-label">Tweak an image · 微调</div>
          <div className="md-typescale-body-small text-on-surface-variant mt-0.5">
            Pick an image, describe what to fix. We'll regenerate just that
            one — $0.30 per iteration, up to {cap} per image.
          </div>
        </div>
        {selectedIters && (
          <Badge
            variant={atCap ? "flagged" : remaining <= 1 ? "pending" : "neutral"}
            size="sm"
          >
            {used}/{cap} used
          </Badge>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          disabled={!!busyAssetId}
          className="w-full h-10 px-3 rounded-m3-md bg-surface-container border ff-hairline md-typescale-body-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.platform} · {a.slot}
              {a.format ? ` · ${a.format}` : ""}
              {iterations[a.id] ? ` · ${iterations[a.id].used}/${iterations[a.id].cap}` : ""}
            </option>
          ))}
        </select>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={!!busyAssetId || atCap}
          maxLength={500}
          rows={3}
          placeholder='e.g. "logo is too small — make it 30% larger" or "white background has color banding, make it pure white"'
          className="w-full px-3 py-2 rounded-m3-md bg-surface-container-low border ff-hairline md-typescale-body-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary resize-y disabled:opacity-50"
        />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span
            className={cn(
              "md-typescale-body-small font-mono tabular-nums",
              instruction.length > 480
                ? "text-ff-amber"
                : "text-on-surface-variant/70"
            )}
          >
            {instruction.length} / 500
            {selected && busyAssetId === selectedId && " · regenerating…"}
          </span>
          {atCap ? (
            <div className="flex flex-col gap-2 items-end max-w-md">
              <p className="md-typescale-body-small text-on-surface-variant">
                You've reached {cap} regenerations on this image. We cap
                iterations to keep costs predictable. Need more tries?
              </p>
              <a
                href="https://calendar.app.google/SKMgxvqGGoCbSZut8"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 h-9 rounded-m3-full md-typescale-label-medium border border-outline text-primary bg-transparent hover:bg-primary/[0.04] transition-colors"
              >
                Schedule a call to discuss →
              </a>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 h-9 rounded-m3-full md-typescale-label-medium",
                "bg-primary text-primary-on shadow-m3-1 hover:shadow-m3-2 transition-shadow",
                "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {busyAssetId === selectedId
                ? "Regenerating…"
                : `Regenerate · $${(0.30).toFixed(2)}`}
            </button>
          )}
        </div>
      </div>
      {/* SKU label kept here so a screen-reader user knows which product
          they're iterating without scrolling back to the eyebrow. */}
      <span className="sr-only">Product SKU: {sku}</span>
    </div>
  );
}

// ── Result panel — surfaces SEO + asset download inline (Issue 9) ──────

// P2-4 — memoized; the parent re-renders on every cost-preview tick
// while the user is configuring. Without memo, every keystroke
// re-rendered the result panel + every ListingCopy underneath.
const ResultPanel = memo(ResultPanelImpl);

function ResultPanelImpl({
  result,
  dryRun,
  assets,
  productNameEn,
  onAssetUpdated,
}: {
  result: LaunchResult;
  dryRun: boolean;
  assets: PlatformAssetRow[] | null;
  productNameEn: string;
  /** Image QA Layer 3 — called after a successful client iteration so
   * the parent can swap the asset's r2Url + thumbUrl in launchAssets. */
  onAssetUpdated?: (assetId: string, newR2Url: string) => void;
}) {
  const seoSurfaces = result.seo?.surfaces ?? [];
  const isFullRunSucceeded = !dryRun && result.status === "succeeded";
  const hasAssets = (assets?.length ?? 0) > 0;
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

        {/* Issue 9 — download bundle inline. Shows for full-run success
            once /api/assets resolves. While loading we render a skeleton
            so users see "the download is coming." */}
        {isFullRunSucceeded && (
          <div>
            <div className="ff-stamp-label mb-3">
              Generated assets ·{" "}
              {assets && assets.length > 0 ? assets.length : "loading"}
            </div>
            {assets === null ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {["s1", "s2", "s3", "s4", "s5", "s6"].map((id) => (
                  <Skeleton key={id} className="aspect-square w-full" />
                ))}
              </div>
            ) : assets.length === 0 ? (
              <div className="md-surface-container-low border ff-hairline rounded-m3-md px-4 py-3 md-typescale-body-small text-on-surface-variant">
                Assets are still being persisted — refresh in a moment, or
                see them in the library.
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {assets.map((item) => (
                  <AssetThumbnail
                    key={item.id}
                    item={item}
                    sku={result.product_sku}
                  />
                ))}
              </div>
            )}
            {/* Image QA Layer 3 — per-image client iteration chat panel.
                Visible once assets land. The user picks an image, types
                a correction (e.g. "logo is too small — make it 30% larger"),
                and the system regenerates that single image with the
                instruction merged into the FAL prompt. */}
            {assets && assets.length > 0 && onAssetUpdated && (
              <TweakImagePanel
                assets={assets}
                sku={result.product_sku}
                onAssetUpdated={onAssetUpdated}
              />
            )}
          </div>
        )}

        {seoSurfaces.length > 0 && (
          <div>
            <div className="ff-stamp-label mb-3">SEO surfaces · {seoSurfaces.length}</div>
            <div className="grid grid-cols-1 gap-3">
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
                  <ListingCopy
                    surface={s.surface}
                    language={s.language}
                    copy={s.copy}
                    grounding={s.grounding ?? null}
                  />
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
              {result.notes.map((n) => (
                <li key={n}>· {n}</li>
              ))}
            </ul>
          </details>
        )}

        <div className="flex flex-col gap-2 pt-2 border-t ff-hairline">
          <div className="flex flex-wrap items-center gap-3">
            {isFullRunSucceeded && hasAssets ? (
              <>
                <StageProductButton
                  assets={assets ?? []}
                  productLabel={productNameEn || result.product_sku}
                />
                <BundleSkuButton
                  group={{
                    sku: result.product_sku,
                    nameEn: productNameEn,
                    items: assets ?? [],
                  }}
                />
                <a
                  href={`/library?q=${encodeURIComponent(result.product_sku)}`}
                  className="inline-flex items-center gap-1.5 px-3 h-8 rounded-m3-full md-typescale-label-medium border border-outline text-primary bg-transparent hover:bg-primary/[0.04] transition-colors duration-m3-short3"
                >
                  View in library →
                </a>
              </>
            ) : (
              <a
                href={
                  dryRun
                    ? `/library?q=${encodeURIComponent(result.product_sku)}&tab=listings`
                    : `/library?q=${encodeURIComponent(result.product_sku)}`
                }
                className="inline-flex items-center gap-1.5 px-3 h-8 rounded-m3-full md-typescale-label-medium bg-primary text-primary-on shadow-m3-1 hover:shadow-m3-2 transition-shadow"
              >
                {dryRun ? "View SEO copy" : "View in library"} →
              </a>
            )}
          </div>
          {isFullRunSucceeded && !hasAssets && (
            <p className="md-typescale-body-small text-on-surface-variant font-mono">
              Library updates as assets land.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Compact asset tile for the launch result. Renders the thumbnail with
// platform/slot pinned and a Download button overlay. Shares
// DownloadAssetButton with the Library so the file naming stays
// consistent across surfaces.
function AssetThumbnail({
  item,
  sku,
}: {
  item: PlatformAssetRow;
  sku: string;
}) {
  const isImage =
    item.format === "jpg" ||
    item.format === "jpeg" ||
    item.format === "png" ||
    item.format === "webp";
  return (
    <div className="md-surface-container-low border ff-hairline rounded-m3-sm overflow-hidden flex flex-col group">
      <div className="relative aspect-square bg-surface-container">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbUrl ?? item.r2Url}
            alt={`${item.platform} ${item.slot}`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center md-typescale-label-small text-on-surface-variant/70 font-mono">
            {item.format ?? "asset"}
          </div>
        )}
        <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between gap-1 pointer-events-none">
          <span className="px-1.5 py-0.5 rounded-m3-sm bg-surface/85 backdrop-blur-sm text-[0.625rem] font-mono uppercase tracking-stamp">
            {item.platform}
          </span>
          <span className="px-1.5 py-0.5 rounded-m3-sm bg-surface/85 backdrop-blur-sm text-[0.625rem] font-mono">
            {item.slot}
          </span>
        </div>
      </div>
      {isImage && (
        <div className="px-2 py-1.5 flex justify-center">
          <DownloadAssetButton item={item} sku={sku} />
        </div>
      )}
    </div>
  );
}
