// Worker URL — single source of truth, baked into the static build.
// Override at build time with: NEXT_PUBLIC_MCP_URL=https://... pnpm build
export const MCP_URL =
  process.env.NEXT_PUBLIC_MCP_URL ?? "https://ff-brand-studio-mcp.creatorain.workers.dev";
