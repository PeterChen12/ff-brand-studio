"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MCP_URL } from "@/lib/config";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardTitle, CardContent, CardEyebrow, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NumberTicker } from "@/components/magic/number-ticker";
import { Skeleton } from "@/components/ui/skeleton";

interface Stats {
  assetCount: number;
  totalSpend: number;
  avgScore: number;
  campaignCount: number;
  passRate: number;
}

export default function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetch(`${MCP_URL}/api/assets`), fetch(`${MCP_URL}/api/costs`)])
      .then(async ([a, c]) => {
        const aData = (await a.json()) as {
          assets: Array<{ brandScore?: number | null; campaign?: string | null }>;
        };
        const cData = (await c.json()) as { totalSpend: number; runs: number };
        const scored = aData.assets.map((x) => x.brandScore ?? 0).filter((s) => s > 0);
        const avgScore = scored.length
          ? Math.round(scored.reduce((s, x) => s + x, 0) / scored.length)
          : 0;
        const passing = scored.filter((s) => s >= 70).length;
        const passRate = scored.length ? Math.round((passing / scored.length) * 100) : 0;
        const campaigns = new Set(aData.assets.map((x) => x.campaign).filter(Boolean));
        setStats({
          assetCount: aData.assets.length,
          totalSpend: cData.totalSpend,
          avgScore,
          campaignCount: campaigns.size,
          passRate,
        });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "fetch failed"));
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Overview · 总览"
        title="The atelier ledger"
        description="Every campaign that crossed the bench, every dollar logged, every brand score stamped — laid out for the operator to read at a glance."
        action={
          <Link href="/campaigns/new">
            <Button variant="accent" size="lg">
              New Campaign →
            </Button>
          </Link>
        }
      />

      <section className="px-6 md:px-12 py-12 max-w-7xl mx-auto">
        {error && (
          <div className="mb-8 border border-vermilion/40 bg-vermilion/5 px-5 py-4 text-sm text-vermilion-deep font-mono">
            <span className="stamp-label text-vermilion-deep">api error</span>
            <span className="ml-3">{error}</span>
          </div>
        )}

        {/* ── Hero metric — single dominant number, editorial weight ─────── */}
        <div className="grid grid-cols-12 gap-6 mb-14">
          <div className="col-span-12 md:col-span-7 animate-fade-up">
            <div className="stamp-label mb-4">Cumulative spend · 累计支出</div>
            <div className="font-display text-display-1 leading-none font-medium text-ink">
              {stats === null ? (
                <Skeleton className="h-24 w-72" />
              ) : (
                <NumberTicker value={stats.totalSpend} prefix="$" decimals={2} />
              )}
            </div>
            <div className="mt-5 flex items-baseline gap-3 text-ink-soft">
              <span className="text-sm">across</span>
              <span className="font-mono text-sm tabular-nums text-ink">
                {stats === null ? "—" : <NumberTicker value={stats.campaignCount} />}
              </span>
              <span className="text-sm">campaigns</span>
              <span className="text-mist">·</span>
              <span className="font-mono text-sm tabular-nums text-ink">
                {stats === null ? "—" : <NumberTicker value={stats.assetCount} />}
              </span>
              <span className="text-sm">assets shipped</span>
            </div>
          </div>

          <div className="col-span-12 md:col-span-5 md:pl-6 md:border-l md:border-mist animate-fade-up [animation-delay:120ms]">
            <div className="stamp-label mb-4">Brand compliance · 品牌合规</div>
            <div className="flex items-baseline gap-4">
              <div className="font-display text-display-2 font-medium text-ink leading-none">
                {stats === null ? (
                  <Skeleton className="h-16 w-32" />
                ) : (
                  <NumberTicker value={stats.avgScore} suffix="/100" />
                )}
              </div>
              {stats && (
                <Badge variant={stats.avgScore >= 85 ? "passed" : stats.avgScore >= 70 ? "pending" : "flagged"}>
                  {stats.avgScore >= 85
                    ? "auto-approve"
                    : stats.avgScore >= 70
                      ? "passes review"
                      : "HITL"}
                </Badge>
              )}
            </div>
            <div className="mt-5 flex items-center gap-3 text-sm text-ink-soft">
              <span className="font-mono text-ink">
                {stats === null ? "—" : `${stats.passRate}%`}
              </span>
              <span>of scored assets clear the 70 threshold</span>
            </div>
          </div>
        </div>

        <div className="hairline mb-14" />

        {/* ── Operator console — two cards side by side, asymmetric weight ─ */}
        <div className="grid grid-cols-12 gap-6">
          <Card className="col-span-12 md:col-span-7 animate-fade-up [animation-delay:200ms]">
            <CardHeader>
              <div>
                <CardEyebrow>Quick actions · 快速操作</CardEyebrow>
                <CardTitle className="mt-1">Step onto the bench</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <ActionRow
                href="/campaigns/new"
                index="01"
                title="Run a new campaign"
                hint="EN brief in → bilingual copy + hero + scorecard out · ~30–45s · ~$0.06"
              />
              <ActionRow
                href="/assets"
                index="02"
                title="Inspect the asset manifest"
                hint="Most-recent 50 generated assets with brand-score stamps"
              />
              <ActionRow
                href="/costs"
                index="03"
                title="Audit the cost ledger"
                hint="Per-run breakdowns · Flux / GPT Image 2 / Kling / Claude tokens"
              />
            </CardContent>
            <CardFooter>
              <span className="font-mono text-2xs uppercase tracking-stamp">
                v0.2.0 · live
              </span>
              <Link
                href="/campaigns/new"
                className="font-mono text-2xs uppercase tracking-stamp text-vermilion-deep hover:text-vermilion"
              >
                start —→
              </Link>
            </CardFooter>
          </Card>

          <Card className="col-span-12 md:col-span-5 animate-fade-up [animation-delay:280ms]">
            <CardHeader>
              <div>
                <CardEyebrow>Compliance rubric · 评分基准</CardEyebrow>
                <CardTitle className="mt-1">Brand-score thresholds</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <ScoreRow
                band="85—100"
                label="Auto-approved"
                hint="Goes straight to DAM publish, no human gate"
                variant="passed"
              />
              <ScoreRow
                band="70—84"
                label="Passes review"
                hint="Default human eyeball before scheduling"
                variant="pending"
              />
              <ScoreRow
                band="< 70"
                label="HITL required"
                hint="Held in queue · evaluator-optimizer retries up to 3×"
                variant="flagged"
              />
            </CardContent>
            <CardFooter>
              <span>Opus 4.7 vision (opt-in) · ~$0.02/asset</span>
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
      className="group flex items-baseline gap-4 px-4 py-4 -mx-2 transition-colors hover:bg-paper-dim/40 border-b border-mist/60 last:border-0"
    >
      <span className="font-mono text-2xs text-vermilion-deep tracking-stamp shrink-0">
        {index}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-display text-base font-medium text-ink group-hover:text-vermilion-deep transition-colors">
          {title}
        </div>
        <div className="text-2xs text-ink-mute font-mono mt-0.5">{hint}</div>
      </div>
      <span className="font-mono text-2xs text-ink-mute group-hover:text-vermilion shrink-0">→</span>
    </Link>
  );
}

function ScoreRow({
  band,
  label,
  hint,
  variant,
}: {
  band: string;
  label: string;
  hint: string;
  variant: "passed" | "pending" | "flagged";
}) {
  return (
    <div className="flex items-baseline gap-3 py-2 border-b border-mist/60 last:border-0">
      <span className="font-mono text-xs text-ink tabular-nums shrink-0 w-20">{band}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-ink">{label}</span>
          <Badge variant={variant} size="sm">
            {variant}
          </Badge>
        </div>
        <div className="text-2xs text-ink-mute font-mono mt-0.5">{hint}</div>
      </div>
    </div>
  );
}
