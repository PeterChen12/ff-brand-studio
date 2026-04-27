"use client";

import { useState } from "react";
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
import { cn } from "@/lib/cn";

type Rating = "EXCELLENT" | "GOOD" | "FAIR" | "POOR";

interface AdContentFlag {
  category: string;
  severity: "block" | "warn";
  matched: string;
  rule: string;
}

interface SurfaceResult {
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

interface SeoPipelineResult {
  status: "succeeded" | "partial" | "skipped" | "cost_capped" | "failed";
  total_cost_cents: number;
  keyword_summary: {
    seed: string;
    expanded_count: number;
    cluster_count: number;
    top_reps: string[];
  };
  surfaces: SurfaceResult[];
  notes: string[];
}

const CATEGORIES = [
  { id: "apparel", label: "Apparel · 服饰" },
  { id: "drinkware", label: "Drinkware · 饮具" },
  { id: "tech-acc", label: "Tech Acc · 配件" },
  { id: "bag", label: "Bag · 箱包" },
  { id: "hat", label: "Hat · 帽" },
  { id: "other", label: "Other · 其他" },
];

const PLATFORMS = [
  { id: "amazon", label: "Amazon US · en", surface: "amazon-us" },
  { id: "shopify", label: "Shopify DTC · en", surface: "shopify" },
];

// D8 demo SKUs — seeded in Postgres via scripts/seed-demo-skus.mjs. Click
// to auto-fill the brief form for a one-tap live demo.
const DEMO_PRESETS: {
  label: string;
  nameEn: string;
  nameZh: string;
  category: string;
}[] = [
  {
    label: "Carbon rod 12ft",
    nameEn: "Carbon fiber telescopic fishing rod 12ft",
    nameZh: "碳纤维伸缩钓竿 12 英尺",
    category: "other",
  },
  {
    label: "Spinning reel 4000",
    nameEn: "Saltwater spinning reel 4000 series",
    nameZh: "海钓纺车轮 4000 型",
    category: "tech-acc",
  },
  {
    label: "LED bite alarm 4-pk",
    nameEn: "LED bite alarm 4-pack",
    nameZh: "LED 咬钩报警器 4 件套",
    category: "tech-acc",
  },
];

// Rating → badge variant map. POOR is flagged, FAIR pending, GOOD/EXCELLENT passed.
const ratingVariant: Record<Rating, "passed" | "pending" | "flagged"> = {
  EXCELLENT: "passed",
  GOOD: "passed",
  FAIR: "pending",
  POOR: "flagged",
};

export function SeoAtelier({ mcpUrl }: { mcpUrl: string }) {
  const [productNameEn, setProductNameEn] = useState(
    "Carbon fiber telescopic fishing rod 12ft"
  );
  const [productNameZh, setProductNameZh] = useState(
    "碳纤维伸缩钓竿 12 英尺"
  );
  const [category, setCategory] = useState("other");
  const [platforms, setPlatforms] = useState<string[]>(["amazon", "shopify"]);
  const [loading, setLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<SeoPipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function togglePlatform(id: string) {
    setPlatforms((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    setElapsedMs(0);
    const startTime = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - startTime), 250);
    try {
      const res = await fetch(`${mcpUrl}/demo/seo-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_name_en: productNameEn,
          product_name_zh: productNameZh || undefined,
          product_category: category,
          platforms,
          cost_cap_cents: 50,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`${res.status}: ${errText.slice(0, 300)}`);
      }
      const data = (await res.json()) as SeoPipelineResult;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      clearInterval(timer);
      setLoading(false);
    }
  }

  const allGood =
    result?.surfaces.length &&
    result.surfaces.every(
      (s) => s.rating === "EXCELLENT" || s.rating === "GOOD"
    );

  return (
    <div className="grid grid-cols-12 gap-6">
      {/* ── Brief column ───────────────────────────────────────────────── */}
      <Card className="col-span-12 lg:col-span-7 animate-fade-up">
        <CardHeader>
          <div>
            <CardEyebrow>Step 01 · 草稿</CardEyebrow>
            <CardTitle className="mt-1">Brief the SEO bench</CardTitle>
          </div>
          <span className="font-mono text-2xs uppercase tracking-stamp text-ink-mute">
            ~2¢/surface · cap 50¢
          </span>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-7">
            <div>
              <div className="stamp-label mb-2">Demo SKUs · 一键填充</div>
              <div className="flex flex-wrap gap-2">
                {DEMO_PRESETS.map((d) => (
                  <button
                    type="button"
                    key={d.label}
                    onClick={() => {
                      setProductNameEn(d.nameEn);
                      setProductNameZh(d.nameZh);
                      setCategory(d.category);
                    }}
                    className={cn(
                      "inline-flex items-center gap-2 px-3 py-1.5 transition-colors",
                      "font-mono text-2xs uppercase tracking-stamp border",
                      "bg-paper-deep/40 text-ink-soft border-mist hover:border-vermilion-deep hover:text-vermilion-deep"
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="stamp-label mb-2">Product name (EN)</div>
              <input
                value={productNameEn}
                onChange={(e) => setProductNameEn(e.target.value)}
                required
                minLength={2}
                maxLength={200}
                className={cn(
                  "w-full px-4 py-2.5 bg-paper border border-mist text-ink",
                  "font-display text-base",
                  "focus:outline-none focus:border-ink"
                )}
              />
            </div>

            <div>
              <div className="stamp-label mb-2">Product name (ZH · optional)</div>
              <input
                value={productNameZh}
                onChange={(e) => setProductNameZh(e.target.value)}
                maxLength={200}
                placeholder="Used for tmall/jd surfaces only"
                className={cn(
                  "w-full px-4 py-2.5 bg-paper border border-mist text-ink",
                  "font-display text-base",
                  "focus:outline-none focus:border-ink"
                )}
              />
            </div>

            <div>
              <div className="stamp-label mb-3">Category · 品类</div>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => {
                  const active = category === c.id;
                  return (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => setCategory(c.id)}
                      className={cn(
                        "inline-flex items-center gap-2 px-3.5 py-1.5 transition-all",
                        "font-mono text-2xs uppercase tracking-stamp border",
                        active
                          ? "bg-ink text-paper border-ink"
                          : "bg-paper-deep/40 text-ink-soft border-mist hover:border-ink hover:text-ink"
                      )}
                    >
                      <span
                        className={cn(
                          "inline-block h-1.5 w-1.5",
                          active ? "bg-vermilion" : "bg-mist"
                        )}
                      />
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="stamp-label mb-3">Platforms · 平台</div>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => {
                  const active = platforms.includes(p.id);
                  return (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => togglePlatform(p.id)}
                      className={cn(
                        "inline-flex items-center gap-2 px-4 py-2 transition-all",
                        "font-mono text-2xs uppercase tracking-stamp border",
                        active
                          ? "bg-ink text-paper border-ink"
                          : "bg-paper-deep/40 text-ink-soft border-mist hover:border-ink hover:text-ink"
                      )}
                    >
                      <span
                        className={cn(
                          "inline-block h-1.5 w-1.5",
                          active ? "bg-vermilion" : "bg-mist"
                        )}
                      />
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-4 pt-2">
              <Button
                type="submit"
                disabled={
                  loading || platforms.length === 0 || productNameEn.length < 2
                }
                variant="accent"
                size="lg"
              >
                {loading
                  ? `Drafting · ${(elapsedMs / 1000).toFixed(1)}s`
                  : "Draft listings →"}
              </Button>
              <span className="text-2xs font-mono text-ink-mute">
                hits <span className="text-vermilion-deep">/demo/seo-preview</span> on{" "}
                <span className="text-ink-soft">{new URL(mcpUrl).hostname}</span>
              </span>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ── Pipeline guide ─────────────────────────────────────────────── */}
      <Card className="col-span-12 lg:col-span-5 animate-fade-up [animation-delay:160ms]">
        <CardHeader>
          <div>
            <CardEyebrow>Pipeline · 流水线</CardEyebrow>
            <CardTitle className="mt-1">SEO sub-flow, end-to-end</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-ink-soft leading-relaxed space-y-3">
          <PipelineStep
            n="01"
            label="expand_seed"
            hint="Amazon + Google + Tmall autocomplete fan-out · free"
          />
          <PipelineStep
            n="02"
            label="cluster_keywords"
            hint="OpenAI text-embedding-3-small + agglomerative · ~$0.001"
          />
          <PipelineStep
            n="03"
            label="research_keywords"
            hint="DataForSEO Amazon related · top 12 reps · ~$0.05"
          />
          <PipelineStep
            n="04"
            label="generate_seo_description"
            hint="Sonnet 4.6 · cached system prompt · per platform × language"
          />
          <PipelineStep
            n="05"
            label="score_seo_compliance"
            hint="Deterministic · 广告法 / Amazon ToS flagger · regen ≤3 iters"
          />
        </CardContent>
        <CardFooter>
          <span>Hard cap: 50¢ / SKU · degrades gracefully on missing keys</span>
        </CardFooter>
      </Card>

      {/* ── Error ──────────────────────────────────────────────────────── */}
      {error && (
        <div className="col-span-12 border border-vermilion bg-vermilion/5 px-6 py-5 animate-fade-up">
          <div className="stamp-label text-vermilion-deep mb-2">Pipeline error</div>
          <pre className="font-mono text-xs text-ink-soft whitespace-pre-wrap">
            {error}
          </pre>
        </div>
      )}

      {/* ── Result summary ─────────────────────────────────────────────── */}
      {result && (
        <Card className="col-span-12 animate-fade-up">
          <CardHeader>
            <div>
              <CardEyebrow
                className={
                  result.status === "succeeded"
                    ? "text-jade-deep"
                    : result.status === "cost_capped"
                      ? "text-amber"
                      : "text-vermilion-deep"
                }
              >
                ✓ pipeline {result.status} · {result.total_cost_cents}¢
              </CardEyebrow>
              <CardTitle className="mt-1 font-mono text-base normal-case">
                seed: {result.keyword_summary.seed}
              </CardTitle>
            </div>
            {allGood ? (
              <Badge variant="passed">All ≥ GOOD · publish-ready</Badge>
            ) : (
              <Badge variant="pending">HITL review · 人工复核</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Keyword fan-out summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat
                label="phrases"
                value={result.keyword_summary.expanded_count.toLocaleString()}
                hint="from autocomplete"
              />
              <Stat
                label="clusters"
                value={result.keyword_summary.cluster_count.toLocaleString()}
                hint="distinct themes"
              />
              <Stat
                label="reps used"
                value={result.keyword_summary.top_reps.length.toString()}
                hint="for prompt context"
              />
              <Stat
                label="cost"
                value={`${result.total_cost_cents}¢`}
                hint={`cap 50¢ · ${result.surfaces.length} surfaces`}
              />
            </div>

            {result.keyword_summary.top_reps.length > 0 && (
              <div>
                <div className="stamp-label mb-2">Top keyword reps</div>
                <div className="flex flex-wrap gap-1.5">
                  {result.keyword_summary.top_reps.map((kw) => (
                    <span
                      key={kw}
                      className="inline-block px-2 py-0.5 bg-paper-deep border border-mist font-mono text-2xs text-ink-soft"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Notes (failures / skips) */}
            {result.notes.length > 0 && (
              <details className="bg-paper-deep/40 border border-mist">
                <summary className="px-3 py-2 cursor-pointer font-mono text-2xs uppercase tracking-stamp text-ink-mute hover:text-ink">
                  pipeline notes ({result.notes.length})
                </summary>
                <ul className="px-4 pb-3 pt-1 font-mono text-2xs text-ink-soft space-y-1">
                  {result.notes.map((n, i) => (
                    <li key={i}>· {n}</li>
                  ))}
                </ul>
              </details>
            )}

            {/* Per-surface cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {result.surfaces.map((s) => (
                <SurfaceCard key={`${s.surface}-${s.language}`} s={s} />
              ))}
            </div>
          </CardContent>
          <CardFooter>
            <div className="flex items-center justify-between gap-4 w-full">
              <a
                href="/costs"
                className="font-mono text-2xs uppercase tracking-stamp text-ink-mute hover:text-ink"
              >
                In ledger →
              </a>
              <button
                type="button"
                disabled={!allGood}
                className={cn(
                  "px-4 py-2 font-mono text-2xs uppercase tracking-stamp border transition-colors",
                  allGood
                    ? "border-jade text-jade-deep hover:bg-jade hover:text-paper"
                    : "border-mist text-ink-mute cursor-not-allowed"
                )}
                title={
                  allGood
                    ? "Publish to DAM (D8)"
                    : "Gated until every surface scores ≥ GOOD"
                }
              >
                Publish to DAM →
              </button>
            </div>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

function SurfaceCard({ s }: { s: SurfaceResult }) {
  const variant = ratingVariant[s.rating];
  const blockingFlags = s.flags.filter(
    (f) => f.severity === "block" || !f.severity
  );
  return (
    <div className="border border-mist bg-paper-deep/40 flex flex-col">
      <div className="px-4 py-3 border-b border-mist flex items-center justify-between gap-2">
        <div>
          <CardEyebrow className="text-vermilion-deep">
            {s.surface} · {s.language}
          </CardEyebrow>
          <div className="font-mono text-2xs text-ink-mute mt-1">
            iter {s.iterations} · {s.cost_cents}¢
          </div>
        </div>
        <Badge variant={variant}>{s.rating}</Badge>
      </div>
      <div className="px-4 py-3 flex-1 space-y-3 text-sm">
        {s.copy ? (
          <CopyPreview copy={s.copy} />
        ) : (
          <div className="font-mono text-2xs text-vermilion-deep">
            ⚠ LLM did not return parseable JSON
            {s.raw_output && (
              <pre className="mt-2 whitespace-pre-wrap text-ink-mute">
                {s.raw_output.slice(0, 500)}
              </pre>
            )}
          </div>
        )}

        {blockingFlags.length > 0 && (
          <div className="border-l-2 border-vermilion pl-3">
            <div className="stamp-label text-vermilion-deep mb-1">Blocking flags</div>
            <ul className="font-mono text-2xs text-ink-soft space-y-0.5">
              {blockingFlags.map((f, i) => (
                <li key={i}>
                  · <span className="text-vermilion-deep">{f.matched}</span>{" "}
                  <span className="text-ink-mute">({f.category})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {s.issues.length > 0 && (
          <details>
            <summary className="cursor-pointer font-mono text-2xs uppercase tracking-stamp text-ink-mute hover:text-ink">
              issues ({s.issues.length})
            </summary>
            <ul className="mt-2 font-mono text-2xs text-ink-soft space-y-0.5">
              {s.issues.slice(0, 6).map((iss, i) => (
                <li key={i}>· {iss}</li>
              ))}
            </ul>
          </details>
        )}

        {s.suggestions.length > 0 && (
          <details>
            <summary className="cursor-pointer font-mono text-2xs uppercase tracking-stamp text-ink-mute hover:text-ink">
              suggestions ({s.suggestions.length})
            </summary>
            <ul className="mt-2 font-mono text-2xs text-ink-soft space-y-0.5">
              {s.suggestions.slice(0, 4).map((sg, i) => (
                <li key={i}>· {sg}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

// Render the surface-specific JSON copy in a readable card layout. Each
// platform produces a different shape so we cherry-pick known fields per
// surface and fall back to a JSON dump for the rest.
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
    <div className="space-y-2">
      {title && (
        <div>
          <div className="stamp-label">Title</div>
          <p className="text-ink leading-snug font-medium">{title}</p>
        </div>
      )}
      {bullets.length > 0 && (
        <div>
          <div className="stamp-label">Bullets · {bullets.length}</div>
          <ul className="text-ink-soft text-xs leading-relaxed list-none space-y-1 mt-1">
            {bullets.slice(0, 5).map((b, i) => (
              <li key={i} className="pl-3 border-l border-mist">
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}
      {meta && (
        <div>
          <div className="stamp-label">{copy.meta_description ? "Meta" : "Description"}</div>
          <p className="text-ink-soft text-xs leading-relaxed line-clamp-4">{meta}</p>
        </div>
      )}
      {searchTerms && (
        <div>
          <div className="stamp-label">Backend keywords</div>
          <p className="font-mono text-2xs text-ink-mute break-all">{searchTerms}</p>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="border border-mist bg-paper-deep/40 px-4 py-3">
      <div className="stamp-label">{label}</div>
      <div className="font-display text-2xl font-semibold text-ink mt-1">
        {value}
      </div>
      <div className="font-mono text-2xs text-ink-mute mt-0.5">{hint}</div>
    </div>
  );
}

function PipelineStep({
  n,
  label,
  hint,
}: {
  n: string;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-baseline gap-3 py-2 border-b border-mist/50 last:border-0">
      <span className="font-mono text-2xs text-vermilion-deep tracking-stamp shrink-0">
        {n}
      </span>
      <div className="flex-1">
        <div className="text-sm font-medium text-ink">{label}</div>
        <div className="text-2xs font-mono text-ink-mute mt-0.5">{hint}</div>
      </div>
    </div>
  );
}
