import { getDb } from "@/db/client";
import { assets, runCosts } from "@/db/schema";
import { sql } from "drizzle-orm";

async function getStats() {
  try {
    const db = getDb();
    const [assetCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(assets);
    const [costSum] = await db
      .select({ total: sql<string>`coalesce(sum(total_cost_usd), 0)::text` })
      .from(runCosts);
    const [avgScore] = await db
      .select({ avg: sql<number>`coalesce(avg(brand_score), 0)::int` })
      .from(assets);
    const [campaignCount] = await db
      .select({ count: sql<number>`count(distinct campaign)::int` })
      .from(assets);

    return {
      assetCount: assetCount?.count ?? 0,
      totalCost: parseFloat(costSum?.total ?? "0").toFixed(2),
      avgScore: avgScore?.avg ?? 0,
      campaignCount: campaignCount?.count ?? 0,
    };
  } catch {
    return { assetCount: 0, totalCost: "0.00", avgScore: 0, campaignCount: 0 };
  }
}

export default async function DashboardPage() {
  const stats = await getStats();

  const statCards = [
    { label: "Total Assets", value: stats.assetCount, color: "#00a8e8" },
    { label: "Campaigns Run", value: stats.campaignCount, color: "#c9a84c" },
    { label: "Avg Brand Score", value: `${stats.avgScore}/100`, color: stats.avgScore >= 70 ? "#22c55e" : "#ef4444" },
    { label: "Total Spend", value: `$${stats.totalCost}`, color: "#9ca3af" },
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
            <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
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
