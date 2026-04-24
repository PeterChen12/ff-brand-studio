"use client";

import { useState } from "react";

interface CampaignResult {
  campaign_id: string;
  status: string;
  total_assets: number;
  copy?: {
    linkedin_en: string;
    linkedin_zh: string;
    weibo_en: string;
    weibo_zh: string;
  };
  published_assets?: Array<{
    r2_key: string;
    image_url: string;
    brand_score: number;
  }>;
}

const EXAMPLE_TEXT = `Faraday Future announces the FF 91 2.0 Futurist Alliance has achieved 1050 horsepower with 0-60 mph in under 2.4 seconds. Combined with a 300-mile EPA estimated range and our proprietary aiHyper Autonomous Driving System, the FF 91 2.0 redefines the ultra-luxury EV segment. Our Emotion Internet of Vehicle (EIoV) platform connects FFID users globally. Q3 production ramp targets Greater China and North America markets simultaneously.`;

export function CampaignForm({ mcpUrl }: { mcpUrl: string }) {
  const [sourceText, setSourceText] = useState(EXAMPLE_TEXT);
  const [platforms, setPlatforms] = useState<string[]>(["linkedin", "weibo"]);
  const [includeInfographic, setIncludeInfographic] = useState(false);
  const [includeVideo, setIncludeVideo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<CampaignResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function togglePlatform(p: string) {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    setElapsedMs(0);

    const startTime = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - startTime), 250);

    try {
      const res = await fetch(`${mcpUrl}/demo/run-campaign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_text: sourceText,
          platforms,
          include_infographic: includeInfographic,
          include_video: includeVideo,
          auto_publish: false,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`${res.status}: ${errText.slice(0, 300)}`);
      }

      const data = (await res.json()) as CampaignResult;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      clearInterval(timer);
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    background: "#0d1b4b",
    border: "1px solid #1f2937",
    borderRadius: 6,
    color: "#e5e7eb",
    fontSize: 14,
    fontFamily: "inherit",
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 24 }}>
      <form
        onSubmit={handleSubmit}
        style={{
          background: "#111827",
          border: "1px solid #1f2937",
          borderRadius: 8,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div>
          <label
            style={{ display: "block", fontSize: 12, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}
          >
            Source text
          </label>
          <textarea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            rows={8}
            style={{ ...inputStyle, resize: "vertical", fontFamily: "Georgia, serif", lineHeight: 1.5 }}
            placeholder="Paste your press release, investor update, or creative brief here (10–5000 chars)..."
            required
            minLength={10}
            maxLength={5000}
          />
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, textAlign: "right" }}>
            {sourceText.length} / 5000
          </div>
        </div>

        <div>
          <label
            style={{ display: "block", fontSize: 12, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}
          >
            Platforms
          </label>
          <div style={{ display: "flex", gap: 10 }}>
            {["linkedin", "weibo"].map((p) => (
              <label
                key={p}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 14px",
                  background: platforms.includes(p) ? "#1c3faa" : "#0d1b4b",
                  border: `1px solid ${platforms.includes(p) ? "#1c3faa" : "#1f2937"}`,
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 13,
                  textTransform: "capitalize",
                }}
              >
                <input
                  type="checkbox"
                  checked={platforms.includes(p)}
                  onChange={() => togglePlatform(p)}
                  style={{ margin: 0 }}
                />
                {p}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label
            style={{ display: "block", fontSize: 12, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}
          >
            Assets
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
              <input
                type="checkbox"
                checked={includeInfographic}
                onChange={(e) => setIncludeInfographic(e.target.checked)}
              />
              Include bilingual infographic <span style={{ color: "#6b7280", fontSize: 12 }}>(GPT Image 2, ~$0.09)</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
              <input
                type="checkbox"
                checked={includeVideo}
                onChange={(e) => setIncludeVideo(e.target.checked)}
              />
              Include cinematic video <span style={{ color: "#6b7280", fontSize: 12 }}>(Kling 2.6, ~$0.18, adds 30–90s)</span>
            </label>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || platforms.length === 0}
          style={{
            padding: "12px 24px",
            background: loading ? "#374151" : "#c9a84c",
            color: loading ? "#9ca3af" : "#0a0a0a",
            border: "none",
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 14,
            cursor: loading ? "wait" : "pointer",
            transition: "all 0.15s",
          }}
        >
          {loading ? `Running pipeline... ${(elapsedMs / 1000).toFixed(1)}s` : "Run Campaign"}
        </button>

        <div style={{ fontSize: 11, color: "#6b7280" }}>
          Runs on <code style={{ color: "#00a8e8" }}>{mcpUrl}</code>
        </div>
      </form>

      {error && (
        <div style={{ background: "#7f1d1d", border: "1px solid #991b1b", borderRadius: 8, padding: 16, color: "#fecaca", fontSize: 13 }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && (
        <div style={{ background: "#111827", border: "1px solid #22c55e", borderRadius: 8, padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#22c55e" }}>
              ✓ Campaign {result.status}
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "monospace" }}>
              {result.campaign_id}
            </div>
          </div>

          <div style={{ fontSize: 13, color: "#9ca3af" }}>
            {result.total_assets} asset{result.total_assets !== 1 ? "s" : ""} generated
            {result.published_assets?.length ? ` · Avg score ${Math.round(result.published_assets.reduce((s, a) => s + a.brand_score, 0) / result.published_assets.length)}/100` : ""}
          </div>

          {result.published_assets?.map((a) => (
            <div key={a.r2_key} style={{ display: "flex", gap: 12, padding: 12, background: "#0d1b4b", borderRadius: 6 }}>
              <img
                src={a.image_url}
                alt={a.r2_key}
                style={{ width: 160, height: 90, objectFit: "cover", borderRadius: 4 }}
              />
              <div style={{ flex: 1, fontSize: 12 }}>
                <div style={{ color: "#e5e7eb", fontWeight: 500, marginBottom: 4 }}>{a.r2_key}</div>
                <div style={{ color: "#6b7280" }}>
                  Score: <span style={{ color: a.brand_score >= 85 ? "#22c55e" : a.brand_score >= 70 ? "#f59e0b" : "#ef4444", fontWeight: 600 }}>{a.brand_score}/100</span>
                </div>
                <a href={a.image_url} target="_blank" rel="noopener noreferrer" style={{ color: "#00a8e8", fontSize: 11 }}>
                  View full image →
                </a>
              </div>
            </div>
          ))}

          {result.copy && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {(Object.keys(result.copy) as Array<keyof typeof result.copy>).map((k) => (
                <div key={k} style={{ padding: 12, background: "#0d1b4b", borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: "#c9a84c", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
                    {k.replace("_", " ")}
                  </div>
                  <div style={{ fontSize: 12, color: "#e5e7eb", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                    {result.copy![k]}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, paddingTop: 8, borderTop: "1px solid #1f2937" }}>
            <a
              href="/assets"
              style={{
                padding: "8px 14px",
                background: "#1c3faa",
                borderRadius: 6,
                color: "#fff",
                fontSize: 13,
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              View in Asset Library
            </a>
            <a
              href="/costs"
              style={{
                padding: "8px 14px",
                background: "#0d1b4b",
                border: "1px solid #1c3faa",
                borderRadius: 6,
                color: "#fff",
                fontSize: 13,
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              View Cost Tracker
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
