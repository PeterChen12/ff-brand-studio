"use client";

import type { AssetRow } from "@/db/schema";
import { useState } from "react";
import { BrandScorecardPanel } from "./brand-scorecard";
import type { BrandScorecardType } from "@ff/types";

function scoreBadgeStyle(score: number | null) {
  if (score === null) return { background: "#374151", color: "#9ca3af" };
  if (score >= 85) return { background: "#14532d", color: "#4ade80" };
  if (score >= 70) return { background: "#78350f", color: "#fbbf24" };
  return { background: "#7f1d1d", color: "#f87171" };
}

const ASSET_ICONS: Record<string, string> = {
  hero_image: "🖼",
  infographic: "📊",
  video: "🎬",
};

export function AssetCard({ asset }: { asset: AssetRow }) {
  const [showScorecard, setShowScorecard] = useState(false);
  const scorecard = (asset.metadata as { scorecard?: BrandScorecardType } | null)?.scorecard;

  const badgeStyle = scoreBadgeStyle(asset.brandScore);

  return (
    <div
      style={{
        background: "#111827",
        border: "1px solid #1f2937",
        borderRadius: 8,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Image preview */}
      <div
        style={{
          height: 180,
          background: "#0d1b4b",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 40,
          position: "relative",
        }}
      >
        <span>{ASSET_ICONS[asset.assetType] ?? "📄"}</span>
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            ...badgeStyle,
            padding: "2px 8px",
            borderRadius: 12,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {asset.brandScore ?? "—"}/100
        </div>
      </div>

      {/* Card body */}
      <div style={{ padding: 16, flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>
          {asset.assetType?.replace("_", " ")}
        </div>
        <div style={{ fontSize: 13, color: "#e5e7eb", fontWeight: 500, wordBreak: "break-all" }}>
          {asset.r2Key}
        </div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          Campaign: <span style={{ color: "#9ca3af" }}>{asset.campaign ?? "—"}</span>
        </div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          Platform: <span style={{ color: "#9ca3af" }}>{asset.platform ?? "—"}</span>
        </div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          {asset.createdAt
            ? new Date(asset.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "—"}
        </div>

        {scorecard && (
          <button
            type="button"
            onClick={() => setShowScorecard(!showScorecard)}
            style={{
              marginTop: "auto",
              padding: "6px 12px",
              background: "#0d1b4b",
              border: "1px solid #1c3faa",
              borderRadius: 6,
              color: "#00a8e8",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {showScorecard ? "Hide Scorecard" : "View Scorecard"}
          </button>
        )}
      </div>

      {showScorecard && scorecard && (
        <div style={{ borderTop: "1px solid #1f2937", padding: 16 }}>
          <BrandScorecardPanel scorecard={scorecard} />
        </div>
      )}
    </div>
  );
}
