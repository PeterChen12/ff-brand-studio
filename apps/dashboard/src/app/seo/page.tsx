import { SeoAtelier } from "@/components/seo-atelier";
import { PageHeader } from "@/components/layout/page-header";
import { MCP_URL } from "@/lib/config";

export default function SeoPage() {
  return (
    <>
      <PageHeader
        eyebrow="SEO Atelier · 文案工坊"
        title="Bilingual listings, made on the bench"
        description="Feed a product name + category. The pipeline expands the seed via free autocomplete fan-out, clusters semantic themes, ranks them with DataForSEO, then drafts platform-specific copy through Sonnet 4.6 — gated by the 广告法 / Amazon ToS flagger and a deterministic compliance scorer."
      />
      <section className="px-6 md:px-12 py-12 max-w-7xl mx-auto">
        <SeoAtelier mcpUrl={MCP_URL} />
      </section>
    </>
  );
}
