"use client";

import type { BrandScorecardType } from "@ff/types";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

const DIMENSION_LABELS: Record<string, string> = {
  color_compliance: "Color",
  typography_compliance: "Typography",
  logo_placement: "Logo",
  image_quality: "Image Quality",
  copy_tone: "Copy Tone",
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  warning: "#f59e0b",
  info: "#60a5fa",
};

export function BrandScorecardPanel({ scorecard }: { scorecard: BrandScorecardType }) {
  const radarData = Object.entries(scorecard.dimensions).map(([key, val]) => ({
    dimension: DIMENSION_LABELS[key] ?? key,
    score: val.score,
  }));

  const overallColor =
    scorecard.overall_score >= 85
      ? "#22c55e"
      : scorecard.overall_score >= 70
        ? "#f59e0b"
        : "#ef4444";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Overall score ring */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            border: `4px solid ${overallColor}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 18, fontWeight: 700, color: overallColor }}>
            {scorecard.overall_score}
          </span>
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: overallColor }}>
            {scorecard.pass ? "PASS" : "FAIL"} — {scorecard.overall_score}/100
          </div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>Overall Brand Compliance Score</div>
        </div>
      </div>

      {/* Radar chart */}
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={radarData}>
            <PolarGrid stroke="#1f2937" />
            <PolarAngleAxis dataKey="dimension" tick={{ fill: "#9ca3af", fontSize: 11 }} />
            <Radar
              dataKey="score"
              stroke="#1c3faa"
              fill="#1c3faa"
              fillOpacity={0.4}
            />
            <Tooltip
              contentStyle={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 6 }}
              labelStyle={{ color: "#e5e7eb" }}
              itemStyle={{ color: "#00a8e8" }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Dimension breakdown */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {Object.entries(scorecard.dimensions).map(([key, val]) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 100, fontSize: 11, color: "#6b7280", flexShrink: 0 }}>
              {DIMENSION_LABELS[key]}
            </div>
            <div
              style={{
                flex: 1,
                height: 6,
                background: "#1f2937",
                borderRadius: 3,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${val.score}%`,
                  height: "100%",
                  background: val.score >= 70 ? "#1c3faa" : "#ef4444",
                  borderRadius: 3,
                }}
              />
            </div>
            <div style={{ width: 28, fontSize: 11, color: "#e5e7eb", textAlign: "right" }}>
              {val.score}
            </div>
          </div>
        ))}
      </div>

      {/* Violations */}
      {scorecard.violations.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>
            Violations
          </div>
          {scorecard.violations.map((v, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 8,
                padding: "6px 10px",
                background: "#0d1b4b",
                borderRadius: 4,
                borderLeft: `3px solid ${SEVERITY_COLORS[v.severity] ?? "#6b7280"}`,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: SEVERITY_COLORS[v.severity] }}>
                  {v.severity.toUpperCase()} — {v.rule}
                </div>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>{v.description}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Suggestions */}
      {scorecard.suggestions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>
            Suggestions
          </div>
          {scorecard.suggestions.map((s, i) => (
            <div key={i} style={{ fontSize: 12, color: "#6b7280", paddingLeft: 8 }}>
              • {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
