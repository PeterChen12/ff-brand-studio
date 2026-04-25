"use client";

import { useEffect, useState } from "react";
import { AssetCard } from "@/components/asset-card";
import { MCP_URL } from "@/lib/config";
import type { AssetRow } from "@/db/schema";

export default function AssetsPage() {
  const [assetList, setAssetList] = useState<AssetRow[] | null>(null);

  useEffect(() => {
    fetch(`${MCP_URL}/api/assets`)
      .then((r) => r.json())
      .then((data: { assets: AssetRow[] }) => setAssetList(data.assets))
      .catch(() => setAssetList([]));
  }, []);

  if (assetList === null) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 24px", textAlign: "center", color: "#6b7280" }}>
        Loading assets…
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Asset Library</h1>
        <p style={{ color: "#6b7280", fontSize: 14 }}>
          {assetList.length} asset{assetList.length !== 1 ? "s" : ""} — most recent first
        </p>
      </div>

      {assetList.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "80px 24px",
            color: "#6b7280",
            border: "1px dashed #1f2937",
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: "#9ca3af" }}>
            No assets yet
          </div>
          <div style={{ fontSize: 14 }}>
            Run a campaign via Claude Desktop or the New Campaign page.
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {assetList.map((asset) => (
            <AssetCard key={asset.id} asset={asset} />
          ))}
        </div>
      )}
    </div>
  );
}
