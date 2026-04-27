import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResearchKeywordsInput, type ResearchKeywordsInputType } from "@ff/types";
import { DataForSEOClient, type DataForSEOMarket as Market } from "@ff/seo-clients";
import { withToolErrorBoundary } from "../lib/tool_boundary.js";

/**
 * v2 SEO Layer · D1 — research_keywords
 *
 * Pulls a seed → expanded keyword set with volumes + competition.
 * Routing per market:
 *  - amazon-us  : amazonRelated(seed) for marketplace-specific terms
 *  - google-us  : relatedKeywords(seed, "google-us")
 *  - google-cn  : relatedKeywords(seed, "google-cn")
 *  - baidu      : relatedKeywords(seed, "baidu") — DataForSEO routes via Google
 *                  CN; Baidu-native is a separate Standard endpoint we can wire later
 *
 * If `includeVolumes=true`, the top-N results get a search_volume call to
 * fill nulls. Cost stays under $0.10 per call for typical 50-result requests.
 */
export function registerResearchKeywords(
  server: McpServer,
  env: CloudflareBindings
): void {
  server.tool(
    "research_keywords",
    "v2 SEO: pull a keyword set for a seed via DataForSEO. Returns terms with searchVolume, competition, cpc. Use to drive bilingual SEO description generation.",
    ResearchKeywordsInput.shape,
    withToolErrorBoundary("research_keywords", async (params: ResearchKeywordsInputType) => {
      const login = env.DATAFORSEO_LOGIN;
      const password = env.DATAFORSEO_PASSWORD;
      if (!login || !password) {
        throw new Error("DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD secrets not configured");
      }
      const client = new DataForSEOClient(login, password);
      const market = params.market as Market;

      let totalCostUsd = 0;
      let keywords: Array<{
        term: string;
        searchVolume: number | null;
        competition: number | null;
        cpc: number | null;
      }> = [];

      // Step 1 — related-keyword discovery
      if (market === "amazon-us") {
        const r = await client.amazonRelated(params.seed, { limit: params.maxResults });
        totalCostUsd += r.costUsd;
        keywords = r.results.map((k) => ({
          term: k.term,
          searchVolume: k.searchVolume,
          competition: k.competition,
          cpc: k.cpc ?? null,
        }));
      } else {
        const r = await client.relatedKeywords(params.seed, market, {
          limit: params.maxResults,
        });
        totalCostUsd += r.costUsd;
        keywords = r.results.map((k) => ({
          term: k.term,
          searchVolume: k.searchVolume,
          competition: k.competition,
          cpc: k.cpc,
        }));
      }

      // Step 2 — fill missing volumes with a single search-volume batch
      if (params.includeVolumes) {
        const missing = keywords
          .filter((k) => k.searchVolume === null)
          .map((k) => k.term);
        if (missing.length > 0) {
          const v = await client.searchVolume(missing, market);
          totalCostUsd += v.costUsd;
          const volMap = new Map(v.results.map((r) => [r.term, r]));
          keywords = keywords.map((k) => {
            const hit = volMap.get(k.term);
            return hit
              ? {
                  term: k.term,
                  searchVolume: hit.searchVolume ?? k.searchVolume,
                  competition: hit.competition ?? k.competition,
                  cpc: hit.cpc ?? k.cpc,
                }
              : k;
          });
        }
      }

      // Sort by search volume desc (nulls last) for downstream consumers
      keywords.sort((a, b) => {
        const av = a.searchVolume ?? -1;
        const bv = b.searchVolume ?? -1;
        return bv - av;
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                seed: params.seed,
                market: params.market,
                keyword_count: keywords.length,
                cost_usd: Math.round(totalCostUsd * 10000) / 10000,
                keywords,
              },
              null,
              2
            ),
          },
        ],
      };
    })
  );
}
