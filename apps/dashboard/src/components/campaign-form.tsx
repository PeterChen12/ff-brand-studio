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

interface CampaignResult {
  campaign_id: string;
  status: string;
  total_assets: number;
  copy?: {
    linkedin_en: string;
    linkedin_zh: string;
    weibo_en: string;
    weibo_zh: string;
  };
  published_assets?: Array<{
    r2_key: string;
    image_url: string;
    brand_score: number;
  }>;
}

const EXAMPLE_TEXT = `Faraday Future announces the FF 91 2.0 Futurist Alliance has achieved 1050 horsepower with 0-60 mph in under 2.4 seconds. Combined with a 300-mile EPA estimated range and our proprietary aiHyper Autonomous Driving System, the FF 91 2.0 redefines the ultra-luxury EV segment.`;

export function CampaignForm({ mcpUrl }: { mcpUrl: string }) {
  const [sourceText, setSourceText] = useState(EXAMPLE_TEXT);
  const [platforms, setPlatforms] = useState<string[]>(["linkedin", "weibo"]);
  const [includeInfographic, setIncludeInfographic] = useState(false);
  const [includeVideo, setIncludeVideo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<CampaignResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function togglePlatform(p: string) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
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
      const res = await fetch(`${mcpUrl}/demo/run-campaign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_text: sourceText,
          platforms,
          include_infographic: includeInfographic,
          include_video: includeVideo,
          auto_publish: false,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`${res.status}: ${errText.slice(0, 300)}`);
      }
      const data = (await res.json()) as CampaignResult;
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
      {/* ── Brief column ───────────────────────────────────────────────── */}
      <Card className="col-span-12 lg:col-span-7 md-fade-in">
        <CardHeader>
          <div>
            <CardEyebrow>Step 01 · 撰稿</CardEyebrow>
            <CardTitle className="mt-1.5">Brief the bench</CardTitle>
          </div>
          <span className="md-typescale-label-small">{sourceText.length} / 5000</span>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-7">
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              rows={9}
              required
              minLength={10}
              maxLength={5000}
              placeholder="Paste your press release, investor update, or creative brief…"
              className={cn(
                "w-full px-4 py-3.5 rounded-m3-md md-surface-container-low",
                "border border-outline-variant text-on-surface md-typescale-body-large",
                "resize-y min-h-[200px]",
                "focus:outline-none focus:border-primary focus:bg-surface-container-lowest",
                "transition-colors duration-m3-short4 ease-m3-emphasized",
                "placeholder:text-on-surface-variant/60 placeholder:italic"
              )}
            />

            <div>
              <div className="ff-stamp-label mb-3">Platforms · 平台</div>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: "linkedin", label: "LinkedIn" },
                  { id: "weibo", label: "Weibo · 微博" },
                ].map((p) => (
                  <Chip
                    key={p.id}
                    active={platforms.includes(p.id)}
                    onClick={() => togglePlatform(p.id)}
                  >
                    {p.label}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <div className="ff-stamp-label mb-3">Optional assets · 可选资产</div>
              <div className="flex flex-col gap-px md-surface-container border ff-hairline rounded-m3-md overflow-hidden">
                <ToggleRow
                  label="Bilingual infographic"
                  hint="GPT Image 2 · ~$0.09 · adds ~10s"
                  checked={includeInfographic}
                  onChange={setIncludeInfographic}
                />
                <ToggleRow
                  label="Cinematic video"
                  hint="Kling 2.6 · ~$0.18 · adds 30–90s"
                  checked={includeVideo}
                  onChange={setIncludeVideo}
                />
              </div>
            </div>

            <div className="flex items-center gap-4 pt-2">
              <Button type="submit" disabled={loading || platforms.length === 0} variant="accent" size="lg">
                {loading ? `Running · ${(elapsedMs / 1000).toFixed(1)}s` : "Run pipeline →"}
              </Button>
              <span className="md-typescale-label-small">
                runs on <span className="text-ff-vermilion-deep">{new URL(mcpUrl).hostname}</span>
              </span>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ── Pipeline guide column ──────────────────────────────────────── */}
      <Card
        className="col-span-12 lg:col-span-5 md-fade-in"
        style={{ animationDelay: "160ms" }}
      >
        <CardHeader>
          <div>
            <CardEyebrow>Pipeline · 流水线</CardEyebrow>
            <CardTitle className="mt-1.5">What happens next</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <PipelineStep n="01" label="Planner" hint="Sonnet 4.6 extracts 3 key points + audience" />
          <PipelineStep n="02" label="Bilingual copy" hint="EN drafted, then transcreated to ZH (not machine-translated)" />
          <PipelineStep n="03" label="Hero render" hint="Flux Pro · brand-locked colors · ~12s" />
          <PipelineStep
            n="04"
            label="Brand Guardian"
            hint="Opus 4.7 vision · 5-dim scorecard · gates HITL at <70"
          />
          <PipelineStep n="05" label="DAM publish" hint="Postgres + R2 · platform_assets row stamped" />
        </CardContent>
        <CardFooter>
          <span>Cost target: ~$0.06 / run baseline</span>
        </CardFooter>
      </Card>

      {/* ── Error ──────────────────────────────────────────────────────── */}
      {error && (
        <div className="col-span-12 rounded-m3-md border border-error/40 bg-error-container/40 px-6 py-5 md-fade-in">
          <div className="ff-stamp-label mb-2">Pipeline error</div>
          <pre className="font-mono text-xs text-error-on-container whitespace-pre-wrap">{error}</pre>
        </div>
      )}

      {/* ── Result panel ───────────────────────────────────────────────── */}
      {result && (
        <Card className="col-span-12 md-fade-in">
          <CardHeader>
            <div>
              <CardEyebrow className="text-ff-jade-deep">
                ✓ Campaign {result.status} · 已完成
              </CardEyebrow>
              <CardTitle className="mt-1.5 font-mono normal-case md-typescale-title-medium">
                {result.campaign_id}
              </CardTitle>
            </div>
            <Badge variant="passed">
              {result.total_assets} asset{result.total_assets !== 1 ? "s" : ""}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-6">
            {result.published_assets && result.published_assets.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {result.published_assets.map((a) => (
                  <div
                    key={a.r2_key}
                    className="rounded-m3-md md-surface-container-lowest border ff-hairline overflow-hidden group"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.image_url}
                      alt={a.r2_key}
                      className="w-full aspect-[4/3] object-cover group-hover:scale-[1.02] transition-transform duration-700 ease-m3-emphasized"
                    />
                    <div className="px-4 py-3 flex items-center justify-between gap-3">
                      <div
                        className="md-typescale-label-small text-on-surface-variant truncate"
                        title={a.r2_key}
                      >
                        {a.r2_key.split("/").slice(-1)[0]}
                      </div>
                      <Badge
                        variant={
                          a.brand_score >= 85 ? "passed" : a.brand_score >= 70 ? "pending" : "flagged"
                        }
                        size="sm"
                      >
                        {a.brand_score}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {result.copy && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(Object.keys(result.copy) as Array<keyof typeof result.copy>).map((k) => (
                  <div
                    key={k}
                    className="md-surface-container-low border ff-hairline rounded-m3-md p-4"
                  >
                    <CardEyebrow>{k.replace("_", " · ")}</CardEyebrow>
                    <p className="mt-2 md-typescale-body-medium text-on-surface whitespace-pre-wrap">
                      {result.copy![k]}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
          <CardFooter>
            <div className="flex gap-4">
              <a
                href="/assets"
                className="md-typescale-label-small text-ff-vermilion-deep hover:text-primary transition-colors"
              >
                In manifest →
              </a>
              <a
                href="/costs"
                className="md-typescale-label-small text-on-surface-variant hover:text-on-surface transition-colors"
              >
                In ledger →
              </a>
            </div>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

/** M3 filter-chip-like toggle for the platforms list */
function Chip({
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
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-4 h-9 rounded-m3-sm",
        "md-typescale-label-medium uppercase tracking-stamp border",
        "transition-colors duration-m3-short4 ease-m3-emphasized",
        active
          ? "bg-on-surface text-surface border-on-surface"
          : "bg-surface-container-low text-on-surface-variant border-outline-variant hover:border-outline hover:text-on-surface"
      )}
    >
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full",
          active ? "bg-primary" : "bg-outline-variant"
        )}
      />
      {children}
    </button>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "flex items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors duration-m3-short3",
        checked ? "md-surface-container-high" : "md-surface-container-lowest hover:md-surface-container-low"
      )}
    >
      <div>
        <div className="md-typescale-title-small text-on-surface">{label}</div>
        <div className="md-typescale-body-small text-on-surface-variant/80 font-mono mt-0.5">
          {hint}
        </div>
      </div>
      {/* M3-style switch — track + handle, animates on toggle */}
      <span
        aria-hidden
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-m3-full border-2 transition-colors duration-m3-short4 ease-m3-emphasized",
          checked
            ? "bg-primary border-primary"
            : "bg-surface-container border-outline"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full transition-all duration-m3-short4 ease-m3-emphasized",
            checked
              ? "translate-x-[18px] bg-primary-on shadow-m3-1"
              : "translate-x-0.5 bg-outline"
          )}
        />
      </span>
    </button>
  );
}

function PipelineStep({ n, label, hint }: { n: string; label: string; hint: string }) {
  return (
    <div className="flex items-baseline gap-3 py-2.5 border-b ff-hairline last:border-0">
      <span className="font-mono text-[0.6875rem] text-ff-vermilion-deep tracking-stamp shrink-0">
        {n}
      </span>
      <div className="flex-1">
        <div className="md-typescale-title-small text-on-surface">{label}</div>
        <div className="md-typescale-body-small text-on-surface-variant/80 font-mono mt-0.5">
          {hint}
        </div>
      </div>
    </div>
  );
}
