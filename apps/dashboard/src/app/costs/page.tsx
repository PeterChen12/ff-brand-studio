import { getDb } from "@/db/client";
import { runCosts } from "@/db/schema";
import { desc, sql } from "drizzle-orm";

const COST_RATES = {
  fluxCalls: 0.055,
  gptImage2Calls: 0.09,
  klingCalls: 0.18,
  claudeInputPer1k: 0.003,
  claudeOutputPer1k: 0.015,
};

async function getCostData() {
  try {
    const db = getDb();
    const rows = await db.select().from(runCosts).orderBy(desc(runCosts.runAt)).limit(30);
    const [summary] = await db
      .select({
        totalSpend: sql<string>`coalesce(sum(total_cost_usd), 0)::text`,
        totalFlux: sql<number>`coalesce(sum(flux_calls), 0)::int`,
        totalGpt: sql<number>`coalesce(sum(gpt_image_2_calls), 0)::int`,
        totalKling: sql<number>`coalesce(sum(kling_calls), 0)::int`,
        runs: sql<number>`count(*)::int`,
      })
      .from(runCosts);
    return { rows, summary };
  } catch {
    return { rows: [], summary: null };
  }
}

export default async function CostsPage() {
  const { rows, summary } = await getCostData();

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Cost Tracker</h1>
        <p style={{ color: "#6b7280", fontSize: 14 }}>Per-run AI generation costs</p>
      </div>

      {/* Summary row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 12,
          marginBottom: 32,
        }}
      >
        {[
          {
            label: "Total Spend",
            value: `$${parseFloat(summary?.totalSpend ?? "0").toFixed(2)}`,
            color: "#c9a84c",
          },
          { label: "Campaigns", value: summary?.runs ?? 0, color: "#00a8e8" },
          {
            label: "Flux Calls",
            value: summary?.totalFlux ?? 0,
            note: `$${((summary?.totalFlux ?? 0) * COST_RATES.fluxCalls).toFixed(2)}`,
            color: "#9ca3af",
          },
          {
            label: "GPT Image 2",
            value: summary?.totalGpt ?? 0,
            note: `$${((summary?.totalGpt ?? 0) * COST_RATES.gptImage2Calls).toFixed(2)}`,
            color: "#9ca3af",
          },
          {
            label: "Kling Video",
            value: summary?.totalKling ?? 0,
            note: `$${((summary?.totalKling ?? 0) * COST_RATES.klingCalls).toFixed(2)}`,
            color: "#9ca3af",
          },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              background: "#111827",
              border: "1px solid #1f2937",
              borderRadius: 8,
              padding: "16px 20px",
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: "#6b7280",
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 6,
              }}
            >
              {card.label}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: card.color }}>{card.value}</div>
            {"note" in card && card.note && (
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{card.note}</div>
            )}
          </div>
        ))}
      </div>

      {/* Cost rate table */}
      <div
        style={{
          background: "#111827",
          border: "1px solid #1f2937",
          borderRadius: 8,
          padding: 20,
          marginBottom: 24,
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Cost Rates</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {[
            { service: "fal.ai Flux Pro (hero image)", rate: "$0.055 / call" },
            { service: "OpenAI GPT Image 2 (infographic)", rate: "$0.09 / call" },
            { service: "fal.ai Kling 2.6 (video)", rate: "$0.18 / call" },
            { service: "Claude Sonnet input tokens", rate: "$0.003 / 1K" },
            { service: "Claude Sonnet output tokens", rate: "$0.015 / 1K" },
            { service: "Claude Opus input tokens", rate: "$0.015 / 1K" },
          ].map((r) => (
            <div key={r.service} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "6px 0", borderBottom: "1px solid #1f2937" }}>
              <span style={{ color: "#9ca3af" }}>{r.service}</span>
              <span style={{ color: "#e5e7eb", fontWeight: 500 }}>{r.rate}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Run log table */}
      <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #1f2937" }}>
          <h2 style={{ fontSize: 14, fontWeight: 600 }}>Recent Runs</h2>
        </div>
        {rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#6b7280", fontSize: 14 }}>
            No runs recorded yet. Run a campaign to see cost data.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#0d1b4b" }}>
                {["Campaign", "Run At", "Flux", "GPT Img2", "Kling", "Total"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "10px 16px",
                      textAlign: "left",
                      fontSize: 11,
                      color: "#6b7280",
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      fontWeight: 600,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={{ borderTop: "1px solid #1f2937" }}>
                  <td style={{ padding: "10px 16px", fontSize: 13, color: "#e5e7eb" }}>
                    {row.campaign ?? "—"}
                  </td>
                  <td style={{ padding: "10px 16px", fontSize: 12, color: "#6b7280" }}>
                    {row.runAt
                      ? new Date(row.runAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </td>
                  <td style={{ padding: "10px 16px", fontSize: 13, color: "#9ca3af" }}>
                    {row.fluxCalls ?? 0}
                  </td>
                  <td style={{ padding: "10px 16px", fontSize: 13, color: "#9ca3af" }}>
                    {row.gptImage2Calls ?? 0}
                  </td>
                  <td style={{ padding: "10px 16px", fontSize: 13, color: "#9ca3af" }}>
                    {row.klingCalls ?? 0}
                  </td>
                  <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 600, color: "#c9a84c" }}>
                    ${parseFloat(row.totalCostUsd ?? "0").toFixed(3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
