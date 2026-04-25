"use client";

import { useEffect, useState } from "react";
import { MCP_URL } from "@/lib/config";

interface Stats {
  assetCount: number;
  totalCost: number;
  avgScore: number;
  campaignCount: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    Promise.all([fetch(`${MCP_URL}/api/assets`), fetch(`${MCP_URL}/api/costs`)])
      .then(async ([a, c]) => {
        const aData = (await a.json()) as { assets: Array<{ brandScore?: number; campaign?: string }> };
        const cData = (await c.json()) as { totalSpend: number; runs: number };
        const scores = aData.assets.map((x) => x.brandScore ?? 0).filter((s) => s > 0);
        const avgScore = scores.length > 0 ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : 0;
        const campaigns = new Set(aData.assets.map((x) => x.campaign).filter(Boolean));
        setStats({
          assetCount: aData.assets.length,
          totalCost: cData.totalSpend,
          avgScore,
          campaignCount: campaigns.size,
        });
      })
      .catch(() => setStats({ assetCount: 0, totalCost: 0, avgScore: 0, campaignCount: 0 }));
  }, []);

  const statCards = stats
    ? [
        { label: "Total Assets", value: stats.assetCount, color: "#00a8e8" },
        { label: "Campaigns Run", value: stats.campaignCount, color: "#c9a84c" },
        {
          label: "Avg Brand Score",
          value: `${stats.avgScore}/100`,
          color: stats.avgScore >= 70 ? "#22c55e" : "#ef4444",
        },
        { label: "Total Spend", value: `$${stats.totalCost.toFixed(2)}`, color: "#9ca3af" },
      ]
    : [
        { label: "Total Assets", value: "—", color: "#6b7280" },
        { label: "Campaigns Run", value: "—", color: "#6b7280" },
        { label: "Avg Brand Score", value: "—", color: "#6b7280" },
        { label: "Total Spend", value: "—", color: "#6b7280" },
      ];

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Brand Studio Overview</h1>
      <p style={{ color: "#6b7280", marginBottom: 32, fontSize: 14 }}>
        AI-generated bilingual marketing assets for Faraday Future
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 40 }}>
        {statCards.map((card) => (
          <div
            key={card.label}
            style={{
              background: "#111827",
              border: "1px solid #1f2937",
              borderRadius: 8,
              padding: "20px 24px",
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: "#6b7280",
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 8,
              }}
            >
              {card.label}
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, color: card.color }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 8, padding: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Quick Actions</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <a
              href="/campaigns/new"
              style={{
                display: "block",
                padding: "12px 16px",
                background: "#c9a84c",
                borderRadius: 6,
                color: "#0a0a0a",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              + Run New Campaign
            </a>
            <a
              href="/assets"
              style={{
                display: "block",
                padding: "12px 16px",
                background: "#1c3faa",
                borderRadius: 6,
                color: "#fff",
                fontWeight: 500,
                fontSize: 14,
              }}
            >
              View Asset Library
            </a>
            <a
              href="/costs"
              style={{
                display: "block",
                padding: "12px 16px",
                background: "#0d1b4b",
                border: "1px solid #1c3faa",
                borderRadius: 6,
                color: "#fff",
                fontWeight: 500,
                fontSize: 14,
              }}
            >
              View Cost Report
            </a>
          </div>
        </div>

        <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 8, padding: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Brand Score Legend</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#22c55e" }} />
              <span style={{ color: "#9ca3af" }}>85-100 — Auto-approved</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#f59e0b" }} />
              <span style={{ color: "#9ca3af" }}>70-84 — Passes review</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ef4444" }} />
              <span style={{ color: "#9ca3af" }}>&lt;70 — HITL required</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
