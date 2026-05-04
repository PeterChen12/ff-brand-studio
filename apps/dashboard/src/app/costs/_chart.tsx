"use client";

/**
 * Recharts SpendChart — extracted to its own module so next/dynamic
 * (in _client.tsx) can put recharts in a route-specific chunk instead
 * of dragging it into the shared First Load JS bundle (P2-8).
 */
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

const CHART = {
  primary: "rgb(196 57 43)",
  outline: "rgb(205 199 189)",
  onSurface: "rgb(74 70 63)",
  surface: "rgb(247 241 231)",
  ink: "rgb(28 27 26)",
};

export interface ChartDatum {
  run: string;
  sku: string;
  cost: number;
}

export function SpendChart({ data }: { data: ChartDatum[] }) {
  return (
    <div className="h-64 -ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
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
  );
}
