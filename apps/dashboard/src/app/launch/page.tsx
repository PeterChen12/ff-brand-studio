import { LaunchWizard } from "@/components/launch-wizard";
import { PageHeader } from "@/components/layout/page-header";
import { MCP_URL } from "@/lib/config";

export default function LaunchPage() {
  return (
    <>
      <PageHeader
        eyebrow="Launch SKU · 上线产品"
        title="Pick a product, get listings"
        description="Pick a seeded SKU, choose target marketplaces, and the orchestrator runs the full pipeline — image plan, bilingual SEO copy, per-platform compliance scoring, with up to 3 regeneration iterations on each surface."
      />
      <section className="px-6 md:px-12 py-12 max-w-7xl mx-auto">
        <LaunchWizard mcpUrl={MCP_URL} />
      </section>
    </>
  );
}
