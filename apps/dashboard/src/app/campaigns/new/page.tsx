import { CampaignForm } from "@/components/campaign-form";

export default function NewCampaignPage() {
  const mcpUrl =
    process.env.NEXT_PUBLIC_MCP_URL ?? "https://ff-brand-studio-mcp.creatorain.workers.dev";

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>New Campaign</h1>
        <p style={{ color: "#6b7280", fontSize: 14 }}>
          Paste a press release, investor update, or creative brief. The pipeline will extract
          key points, draft bilingual posts, generate assets, score against brand guidelines, and
          publish to the DAM.
        </p>
      </div>

      <CampaignForm mcpUrl={mcpUrl} />
    </div>
  );
}
