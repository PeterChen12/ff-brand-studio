import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { assets } from "@/db/schema";
import type { AssetRow } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const db = getDb();
    const rows: AssetRow[] = await db
      .select()
      .from(assets)
      .orderBy(desc(assets.createdAt))
      .limit(20);
    return NextResponse.json({ assets: rows });
  } catch (err) {
    console.error("[api/assets] DB error:", err);
    return NextResponse.json({ assets: [] });
  }
}
