"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MCP_URL } from "@/lib/config";
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

        {/* ── Hero metric — single dominant number, editorial weight ─────── */}
        <div className="grid grid-cols-12 gap-6 mb-14">
          <div className="col-span-12 md:col-span-7 md-fade-in">
            <div className="ff-stamp-label mb-4">Cumulative spend · 累计支出</div>
            <div className="md-typescale-display-large text-on-surface tabular-nums">
              {stats === null ? (
                <Skeleton className="h-24 w-72" />
              ) : (
                <NumberTicker value={stats.totalSpend} prefix="$" decimals={2} />
              )}
            </div>
            <div className="mt-5 flex items-baseline gap-3 md-typescale-body-large text-on-surface-variant">
              <span>across</span>
              <span className="font-mono tabular-nums text-on-surface">
                {stats === null ? "—" : <NumberTicker value={stats.campaignCount} />}
              </span>
              <span>campaigns</span>
              <span className="text-outline-variant">·</span>
              <span className="font-mono tabular-nums text-on-surface">
                {stats === null ? "—" : <NumberTicker value={stats.assetCount} />}
              </span>
              <span>assets shipped</span>
            </div>
          </div>

          <div
            className="col-span-12 md:col-span-5 md:pl-8 md:border-l md:ff-hairline md-fade-in"
            style={{ animationDelay: "120ms" }}
          >
            <div className="ff-stamp-label mb-4">Brand compliance · 品牌合规</div>
            <div className="flex items-baseline gap-4">
              <div className="md-typescale-display-medium text-on-surface tabular-nums">
                {stats === null ? (
                  <Skeleton className="h-16 w-32" />
                ) : (
                  <NumberTicker value={stats.avgScore} suffix="/100" />
                )}
              </div>
              {stats && (
                <Badge
                  variant={
                    stats.avgScore >= 85
                      ? "passed"
                      : stats.avgScore >= 70
                        ? "pending"
                        : "flagged"
                  }
                >
                  {stats.avgScore >= 85
                    ? "auto-approve"
                    : stats.avgScore >= 70
                      ? "passes review"
                      : "HITL"}
                </Badge>
              )}
            </div>
            <div className="mt-5 md-typescale-body-medium text-on-surface-variant flex items-center gap-2">
              <span className="font-mono text-on-surface">
                {stats === null ? "—" : `${stats.passRate}%`}
              </span>
              <span>of scored assets clear the 70 threshold</span>
            </div>
          </div>
        </div>

        <div className="border-t ff-hairline mb-14" />

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

