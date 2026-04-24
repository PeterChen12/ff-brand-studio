import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { runCosts } from "@/db/schema";
import { sql } from "drizzle-orm";

interface CostStats {
  totalSpend: number;
  runs: number;
  totalFlux: number;
  totalGpt: number;
  totalKling: number;
}

export async function GET() {
  try {
    const db = getDb();
    const [row] = await db
      .select({
        totalSpend: sql<string>`coalesce(sum(total_cost_usd), 0)`,
        runs: sql<string>`count(*)`,
        totalFlux: sql<string>`coalesce(sum(flux_calls), 0)`,
        totalGpt: sql<string>`coalesce(sum(gpt_image_2_calls), 0)`,
        totalKling: sql<string>`coalesce(sum(kling_calls), 0)`,
      })
      .from(runCosts);

    const stats: CostStats = {
      totalSpend: Number(row?.totalSpend ?? 0),
      runs: Number(row?.runs ?? 0),
      totalFlux: Number(row?.totalFlux ?? 0),
      totalGpt: Number(row?.totalGpt ?? 0),
      totalKling: Number(row?.totalKling ?? 0),
    };

    return NextResponse.json(stats);
  } catch (err) {
    console.error("[api/costs] DB error:", err);
    const empty: CostStats = {
      totalSpend: 0,
      runs: 0,
      totalFlux: 0,
      totalGpt: 0,
      totalKling: 0,
    };
    return NextResponse.json(empty);
  }
}
