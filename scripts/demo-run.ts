/**
 * Demo script — tests the full campaign workflow end-to-end.
 * Requires all env vars from .env.example to be set.
 *
 * Usage:
 *   pnpm tsx scripts/demo-run.ts
 */

import { config } from "dotenv";
config({ path: ".env" });

// Validate required env vars before starting
const required = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "FAL_KEY",
  "PGHOST",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
];

const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const MCP_URL = process.env.MCP_URL ?? "http://localhost:8787";

const DEMO_SOURCE_TEXT = `
Faraday Future is proud to announce that the FF 91 2.0 Futurist Alliance has achieved a
groundbreaking 1050 horsepower output — making it the most powerful production electric
vehicle on the market. With 0-60 mph in under 2.4 seconds, a 300-mile EPA-estimated range,
and our proprietary aiHyper Autonomous Driving System, the FF 91 2.0 redefines what is
possible in the luxury EV segment. Our Emotion Internet of Vehicle (EIoV) platform
transforms the car into an intelligent companion, seamlessly connecting FFID users across
global mobility ecosystems. We are targeting Q3 production ramp with key deliveries to
strategic investors and early adopters in the Greater China and North America markets.
`;

async function runDemoViaMCP() {
  console.log("FF Brand Studio — Demo Campaign Run");
  console.log("====================================");
  console.log(`MCP Server: ${MCP_URL}`);
  console.log("");

  // Health check
  const healthRes = await fetch(`${MCP_URL}/health`);
  if (!healthRes.ok) {
    throw new Error(`MCP server not reachable at ${MCP_URL}. Start with: pnpm --filter ff-mcp-server dev`);
  }
  const health = await healthRes.json() as { status: string; version: string };
  console.log(`Health: ${health.status} v${health.version}`);
  console.log("");

  console.log("Source text (excerpt):", DEMO_SOURCE_TEXT.trim().slice(0, 120) + "...");
  console.log("");
  console.log("Sending run_campaign to MCP tool endpoint...");
  console.log("(In production, Claude Desktop calls this — this script simulates the tool call)");
  console.log("");

  const payload = {
    source_text: DEMO_SOURCE_TEXT.trim(),
    platforms: ["linkedin", "weibo"],
    include_infographic: true,
    include_video: false,
    auto_publish: false,
  };

  // Direct HTTP call simulating what Claude Desktop would do
  const startMs = Date.now();
  const res = await fetch(`${MCP_URL}/demo/run-campaign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Campaign run failed (${res.status}): ${text}`);
  }

  const result = await res.json();
  console.log(`Campaign completed in ${elapsed}s`);
  console.log(JSON.stringify(result, null, 2));
}

runDemoViaMCP().catch((err) => {
  console.error("Demo failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
