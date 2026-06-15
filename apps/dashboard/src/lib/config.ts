// Worker URL — single source of truth, baked into the static build.
// Override at build time with: NEXT_PUBLIC_MCP_URL=https://... pnpm build
//
// Defaults to the buyfishingrod.com custom domain, NOT *.workers.dev: the
// dashboard is served from image-generation.buyfishingrod.com (a proxied
// Pages custom domain that resolves through Cloudflare's main edge and is
// reachable from mainland China), but the raw *.workers.dev API host is
// blocked/throttled by the GFW + some corporate networks. Pointing the API
// at workers.dev meant China-based sellers loaded the UI but every API call
// + /health probe failed → "API · error" + stuck KPIs for "only some users".
// mcp.image-generation.buyfishingrod.com is the same worker on a reachable
// host (see apps/mcp-server/wrangler.toml [[routes]]).
export const MCP_URL =
  process.env.NEXT_PUBLIC_MCP_URL ?? "https://mcp.image-generation.buyfishingrod.com";
