"use client";

import { useEffect, useMemo, useState } from "react";
import { MCP_URL } from "@/lib/config";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardHeader,
  CardTitle,
  CardEyebrow,
  CardContent,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

interface LaunchRow {
  id: string;
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

// M3-token RGB triplets — same palette as the rest of the dashboard.
const CHART = {
  primary: "rgb(196 57 43)",
  outline: "rgb(205 199 189)",
  onSurface: "rgb(74 70 63)",
  surface: "rgb(247 241 231)",
  ink: "rgb(28 27 26)",
};

export default function CostsPage() {
  const [launches, setLaunches] = useState<LaunchRow[] | null>(null);

  useEffect(() => {
    fetch(`${MCP_URL}/api/launches`)
      .then((r) => r.json())
      .then((d: { launches: LaunchRow[] }) => setLaunches(d.launches ?? []))
      .catch(() => setLaunches([]));
  }, []);

  // Chart data — newest-last so the line reads left-to-right chronologically.
  const chartData = useMemo(() => {
    if (!launches) return [];
    return [...launches]
      .filter((l) => l.createdAt && l.totalCostCents !== null)
      .reverse()
      .map((l) => ({
        run: l.createdAt
          ? new Date(l.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })
          : "—",
        sku: l.sku ?? "—",
        cost: (l.totalCostCents ?? 0) / 100,
      }));
  }, [launches]);

  // Aggregate v2 metrics — single source of truth, no v1 data.
  const stats = useMemo(() => {
    if (!launches) return null;
    const totalCents = launches.reduce(
      (s, l) => s + (l.totalCostCents ?? 0),
      0
    );
    const succeeded = launches.filter((l) => l.status === "succeeded").length;
    const hitl = launches.filter(
      (l) => (l.hitlInterventions ?? 0) > 0 || l.status === "hitl_blocked"
    ).length;
    const avgMs =
      launches.length > 0
        ? Math.round(
            launches.reduce((s, l) => s + (l.durationMs ?? 0), 0) /
              launches.length
          )
        : 0;
    return {
      totalSpend: totalCents / 100,
      runs: launches.length,
      succeeded,
      hitl,
      avgMs,
    };
  }, [launches]);

  return (
    <>
      <PageHeader
        eyebrow="Costs · 成本"
        title="Every dollar, by SKU launch"
        description="Per-launch spend across the v2 orchestrator (Sonnet 4.6, FLUX.2, GPT Image 2, Kling, DataForSEO). Sorted newest-first."
      />

      <section className="px-6 md:px-12 py-12 max-w-7xl mx-auto space-y-12">
        {/* ── v2 summary ribbon ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px md-surface-container border ff-hairline rounded-m3-lg overflow-hidden">
          <MetricCell
            label="Total spend"
            value={stats === null ? null : `$${stats.totalSpend.toFixed(2)}`}
            tone="primary"
          />
          <MetricCell
            label="Launches"
            value={stats === null ? null : stats.runs.toString()}
            sub={stats ? `${stats.succeeded} succeeded` : ""}
          />
          <MetricCell
            label="HITL holds"
            value={stats === null ? null : stats.hitl.toString()}
            sub="needing review"
            tone={stats && stats.hitl > 0 ? "amber" : undefined}
          />
          <MetricCell
            label="Avg duration"
            value={
              stats === null
                ? null
                : stats.avgMs > 0
                  ? `${(stats.avgMs / 1000).toFixed(1)}s`
                  : "—"
            }
            sub="end-to-end"
          />
        </div>

        {/* ── Spend trend (only meaningful with > 1 launch) ─────────────── */}
        {chartData.length > 1 && (
          <Card className="md-fade-in">
            <CardHeader>
              <div>
                <CardEyebrow>Spend trend · 支出趋势</CardEyebrow>
                <CardTitle className="mt-1.5">Cost per launch over time</CardTitle>
              </div>
              <div className="md-typescale-label-small">
                {chartData.length} launch{chartData.length === 1 ? "" : "es"}
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-64 -ml-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="primaryFade" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART.primary} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={CHART.primary} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={CHART.outline} strokeDasharray="2 6" vertical={false} />
                    <XAxis
                      dataKey="run"
                      tick={{ fill: CHART.onSurface, fontSize: 11, fontFamily: "JetBrains Mono" }}
                      tickLine={false}
                      axisLine={{ stroke: CHART.outline }}
                    />
                    <YAxis
                      tick={{ fill: CHART.onSurface, fontSize: 11, fontFamily: "JetBrains Mono" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `$${v.toFixed(2)}`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: CHART.surface,
                        border: `1px solid ${CHART.outline}`,
                        borderRadius: 12,
                        fontFamily: "JetBrains Mono",
                        fontSize: 11,
                        color: CHART.ink,
                      }}
                      labelStyle={{
                        color: CHART.onSurface,
                        textTransform: "uppercase",
                        letterSpacing: 2,
                        fontSize: 10,
                      }}
                      formatter={(v: number, _n, p) => [
                        `$${v.toFixed(3)} · ${p?.payload?.sku ?? "—"}`,
                        "cost",
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="cost"
                      stroke={CHART.primary}
                      strokeWidth={1.75}
                      fill="url(#primaryFade)"
                      dot={{ fill: CHART.primary, r: 2 }}
                      activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Launch ledger ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div>
              <CardEyebrow>Launch runs · 上线运行</CardEyebrow>
              <CardTitle className="mt-1.5">All launches by SKU</CardTitle>
            </div>
            {launches !== null && (
              <span className="md-typescale-label-small">
                {launches.length} run{launches.length === 1 ? "" : "s"}
              </span>
            )}
          </CardHeader>
          <div className="border-t ff-hairline overflow-x-auto">
            {launches === null ? (
              <div className="p-12 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : launches.length === 0 ? (
              <div className="py-16 text-center">
                <div className="ff-stamp-label text-on-surface-variant mb-2">
                  No launches yet
                </div>
                <p className="md-typescale-body-medium text-on-surface-variant">
                  v2 launches land here once the dashboard wizard fires one.
                </p>
                <a
                  href="/launch"
                  className={[
                    "inline-flex items-center gap-2 mt-5 px-5 h-9 rounded-m3-full",
                    "bg-primary text-primary-on shadow-m3-1 hover:shadow-m3-2",
                    "md-typescale-label-medium uppercase tracking-stamp transition-shadow",
                  ].join(" ")}
                >
                  Run your first launch →
                </a>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="md-surface-container-low">
                    {["Product", "SKU", "Status", "Run at", "HITL", "Duration", "Cost"].map(
                      (h, i) => (
                        <th
                          key={h}
                          className={[
                            "px-5 py-3 md-typescale-label-small text-on-surface-variant",
                            i >= 4 ? "text-right" : "text-left",
                          ].join(" ")}
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {launches.map((l) => {
                    const statusVariant =
                      l.status === "succeeded"
                        ? "passed"
                        : l.status === "hitl_blocked" || l.status === "cost_capped"
                          ? "pending"
                          : l.status === "failed"
                            ? "flagged"
                            : "neutral";
                    return (
                      <tr
                        key={l.id}
                        className="border-t ff-hairline hover:bg-surface-container-low/60 transition-colors duration-m3-short3"
                      >
                        <td className="px-5 py-3 text-on-surface md-typescale-body-small truncate max-w-[28ch]">
                          {l.productNameEn ?? "—"}
                        </td>
                        <td className="px-5 py-3 text-on-surface-variant font-mono text-xs">
                          {l.sku ?? "—"}
                        </td>
                        <td className="px-5 py-3">
                          <Badge variant={statusVariant} size="sm">
                            {l.status ?? "?"}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-on-surface-variant font-mono text-xs">
                          {l.createdAt
                            ? new Date(l.createdAt).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-xs tabular-nums">
                          {l.hitlInterventions ?? 0}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-xs tabular-nums text-on-surface-variant">
                          {l.durationMs !== null
                            ? `${(l.durationMs / 1000).toFixed(1)}s`
                            : "—"}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-xs tabular-nums text-ff-vermilion-deep font-semibold">
                          {l.totalCostCents !== null ? `${l.totalCostCents}¢` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </section>
    </>
  );
}

function MetricCell({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | null;
  sub?: string;
  tone?: "primary" | "amber" | "tertiary";
}) {
  const valueColor =
    tone === "primary"
      ? "text-ff-vermilion-deep"
      : tone === "amber"
        ? "text-ff-amber"
        : tone === "tertiary"
          ? "text-ff-jade-deep"
          : "text-on-surface";
  return (
    <div className="md-surface-container-lowest px-5 py-5 flex flex-col gap-1.5 min-h-[110px]">
      <span className="ff-stamp-label">{label}</span>
      <div
        className={[
          "md-typescale-display-small tabular-nums",
          valueColor,
        ].join(" ")}
      >
        {value === null ? <Skeleton className="h-8 w-24" /> : value}
      </div>
      {sub && (
        <span className="md-typescale-label-small text-on-surface-variant/70 font-mono">
          {sub}
        </span>
      )}
    </div>
  );
}
