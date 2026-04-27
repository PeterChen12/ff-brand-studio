import { CampaignForm } from "@/components/campaign-form";
import { PageHeader } from "@/components/layout/page-header";

export default function NewCampaignPage() {
  const mcpUrl =
    process.env.NEXT_PUBLIC_MCP_URL ?? "https://ff-brand-studio-mcp.creatorain.workers.dev";

  return (
    <>
      <PageHeader
        eyebrow="New Campaign · 新活动"
        title="Step onto the bench"
        description="Paste a press release, investor update, or creative brief. The pipeline lifts the key points, drafts bilingual copy, renders a brand-locked hero, and stamps it with a Brand Guardian score before publishing to the DAM."
      />
      <section className="px-6 md:px-12 py-12 max-w-7xl mx-auto">
        <CampaignForm mcpUrl={mcpUrl} />
      </section>
    </>
  );
}
