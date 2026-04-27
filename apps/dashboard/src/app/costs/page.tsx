"use client";

import { useEffect, useState, useMemo } from "react";
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
import { NumberTicker } from "@/components/magic/number-ticker";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import type { RunCostRow } from "@/db/schema";

interface CostSummary {
  totalSpend: number;
  runs: number;
  totalFlux: number;
  totalGpt: number;
  totalKling: number;
}

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

const COST_RATES = {
  flux: 0.055,
  gptImage2: 0.09,
  kling: 0.18,
} as const;

// M3-token RGB triplets sourced from globals.css. Recharts needs string
// rgb() values not custom-property references, so we hand-pick from the
// vermilion seed palette to keep the chart visually consistent with M3.
const CHART = {
  primary: "rgb(196 57 43)",
  primaryFade: "rgb(196 57 43)",
  outline: "rgb(205 199 189)",
  onSurface: "rgb(74 70 63)",
  surface: "rgb(247 241 231)",
  ink: "rgb(28 27 26)",
};

export default function CostsPage() {
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [rows, setRows] = useState<RunCostRow[] | null>(null);
  const [launches, setLaunches] = useState<LaunchRow[] | null>(null);

  useEffect(() => {
    fetch(`${MCP_URL}/api/launches`)
      .then((r) => r.json())
      .then((d: { launches: LaunchRow[] }) => setLaunches(d.launches ?? []))
      .catch(() => setLaunches([]));
    Promise.all([fetch(`${MCP_URL}/api/costs`), fetch(`${MCP_URL}/api/runs`)])
      .then(async ([s, r]) => {
        setSummary((await s.json()) as CostSummary);
        const runsData = (await r.json()) as { runs: RunCostRow[] };
        setRows(runsData.runs);
      })
      .catch(() => {
        setSummary({ totalSpend: 0, runs: 0, totalFlux: 0, totalGpt: 0, totalKling: 0 });
        setRows([]);
      });
  }, []);

  const chartData = useMemo(() => {
    if (!rows) return [];
    return [...rows]
      .reverse()
      .filter((r) => r.runAt)
      .map((r) => ({
        run: r.runAt
          ? new Date(r.runAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
          : "—",
        cost: parseFloat(r.totalCostUsd ?? "0"),
      }));
  }, [rows]);

  return (
    <>
      <PageHeader
        eyebrow="Costs · 成本"
        title="Every dollar, by run"
        description="Per-launch breakdown of API spend across Sonnet 4.6, FLUX.2, GPT Image 2, Kling, and DataForSEO. v2 launches and v1 social campaigns are tracked side by side."
      />

      <section className="px-6 md:px-12 py-12 max-w-7xl mx-auto space-y-12">
        {/* ── Summary ribbon — 5 metrics, M3 surface-tier separation ─────── */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-px md-surface-container border ff-hairline rounded-m3-lg overflow-hidden">
          <MetricCell
            label="Total spend"
            value={summary === null ? null : summary.totalSpend}
            prefix="$"
            decimals={2}
            accent
          />
          <MetricCell
            label="Legacy runs"
            value={summary === null ? null : summary.runs}
          />
          <MetricCell
            label="Flux calls"
            value={summary === null ? null : summary.totalFlux}
            sub={summary ? `$${(summary.totalFlux * COST_RATES.flux).toFixed(2)}` : ""}
          />
          <MetricCell
            label="GPT Image 2"
            value={summary === null ? null : summary.totalGpt}
            sub={summary ? `$${(summary.totalGpt * COST_RATES.gptImage2).toFixed(2)}` : ""}
          />
          <MetricCell
            label="Kling video"
            value={summary === null ? null : summary.totalKling}
            sub={summary ? `$${(summary.totalKling * COST_RATES.kling).toFixed(2)}` : ""}
          />
        </div>

        {/* ── Trend chart ──────────────────────────────────────────────── */}
        <Card className="md-fade-in">
          <CardHeader>
            <div>
              <CardEyebrow>Spend trend · 支出趋势</CardEyebrow>
              <CardTitle className="mt-1.5">Per-run cost over time</CardTitle>
            </div>
            <div className="md-typescale-label-small">
              {rows === null ? "—" : `${rows.length} runs`}
            </div>
          </CardHeader>
          <CardContent>
            {rows === null ? (
              <Skeleton className="h-64 w-full" />
            ) : chartData.length === 0 ? (
              <div className="h-64 flex items-center justify-center md-typescale-label-medium text-on-surface-variant">
                No data yet
              </div>
            ) : (
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
                      formatter={(v: number) => [`$${v.toFixed(3)}`, "cost"]}
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
            )}
          </CardContent>
        </Card>

        {/* ── Recent launches (v2 launch_runs) ───────────────────────────── */}
        <Card>
          <CardHeader>
            <div>
              <CardEyebrow>Launch runs · 上线运行</CardEyebrow>
              <CardTitle className="mt-1.5">Recent launches by SKU</CardTitle>
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
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : launches.length === 0 ? (
              <div className="py-16 text-center">
                <div className="ff-stamp-label text-on-surface-variant mb-2">No launches yet</div>
                <p className="md-typescale-body-medium text-on-surface-variant">
                  v2 launch_product_sku runs land here once the dashboard wizard fires one.
                </p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="md-surface-container-low">
                    {["Product", "SKU", "Status", "Run at", "HITL", "Cost"].map((h, i) => (
                      <th
                        key={h}
                        className={[
                          "px-5 py-3 md-typescale-label-small text-on-surface-variant",
                          i >= 4 ? "text-right" : "text-left",
                        ].join(" ")}
                      >
                        {h}
                      </th>
                    ))}
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

        {/* ── Legacy v1 run ledger (run_costs) ───────────────────────────── */}
        <Card>
          <CardHeader>
            <div>
              <CardEyebrow>Legacy v1 ledger · 旧版账目</CardEyebrow>
              <CardTitle className="mt-1.5">v1 social campaigns</CardTitle>
            </div>
          </CardHeader>
          <div className="border-t ff-hairline overflow-x-auto">
            {rows === null ? (
              <div className="p-12 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="py-16 text-center">
                <div className="ff-stamp-label text-on-surface-variant mb-2">Ledger empty</div>
                <p className="md-typescale-body-medium text-on-surface-variant">
                  No runs recorded yet.
                </p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="md-surface-container-low">
                    {["Campaign", "Run at", "Flux", "GPT Img 2", "Kling", "Total"].map((h, i) => (
                      <th
                        key={h}
                        className={[
                          "px-5 py-3 md-typescale-label-small text-on-surface-variant",
                          i >= 2 ? "text-right" : "text-left",
                        ].join(" ")}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-t ff-hairline hover:bg-surface-container-low/60 transition-colors duration-m3-short3"
                    >
                      <td className="px-5 py-3 text-on-surface font-mono text-xs truncate max-w-[20ch]">
                        {row.campaign ?? "—"}
                      </td>
                      <td className="px-5 py-3 text-on-surface-variant font-mono text-xs">
                        {row.runAt
                          ? new Date(row.runAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs tabular-nums text-on-surface-variant">
                        {row.fluxCalls ?? 0}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs tabular-nums text-on-surface-variant">
                        {row.gptImage2Calls ?? 0}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs tabular-nums text-on-surface-variant">
                        {row.klingCalls ?? 0}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs tabular-nums text-ff-vermilion-deep font-semibold">
                        ${parseFloat(row.totalCostUsd ?? "0").toFixed(3)}
                      </td>
                    </tr>
                  ))}
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
  prefix,
  decimals,
  sub,
  accent,
}: {
  label: string;
  value: number | null;
  prefix?: string;
  decimals?: number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="md-surface-container-lowest px-5 py-5 flex flex-col gap-1.5 min-h-[120px]">
      <span className="ff-stamp-label">{label}</span>
      <div
        className={[
          "md-typescale-display-small tabular-nums",
          accent ? "text-ff-vermilion-deep" : "text-on-surface",
        ].join(" ")}
      >
        {value === null ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <NumberTicker value={value} prefix={prefix} decimals={decimals ?? 0} />
        )}
      </div>
      {sub && (
        <span className="md-typescale-label-small text-on-surface-variant/70 font-mono">
          {sub}
        </span>
      )}
    </div>
  );
}
