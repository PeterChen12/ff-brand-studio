import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ClusterKeywordsInput, type ClusterKeywordsInputType } from "@ff/types";
import { embed, clusterByCosine } from "@ff/seo-clients";
import { withToolErrorBoundary } from "../lib/tool_boundary.js";

/**
 * v2 SEO Layer · D3 — cluster_keywords
 *
 * Takes a phrase list (typically the output of `expand_seed`), embeds via
 * OpenAI `text-embedding-3-small` ($0.02 / 1M tokens), then groups by
 * cosine similarity. Returns one row per cluster with the longest-member
 * representative.
 *
 * Typical input: 200 phrases from autocomplete fan-out.
 * Typical output: 25-40 clusters, each with 3-15 members.
 * Typical cost: <$0.001.
 */
export function registerClusterKeywords(server: McpServer, env: CloudflareBindings): void {
  server.tool(
    "cluster_keywords",
    "v2 SEO: cluster a phrase set by semantic similarity. Use to collapse 200 autocomplete suggestions into 30-40 distinct keyword themes before paying for DataForSEO research.",
    ClusterKeywordsInput.shape,
    withToolErrorBoundary("cluster_keywords", async (params: ClusterKeywordsInputType) => {
      if (!env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY not configured");
      }
      const { items, costUsd } = await embed(params.phrases, env.OPENAI_API_KEY);
      const clusters = clusterByCosine(items, params.threshold);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                input_count: params.phrases.length,
                cluster_count: clusters.length,
                cost_usd: costUsd,
                threshold: params.threshold,
                clusters,
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
