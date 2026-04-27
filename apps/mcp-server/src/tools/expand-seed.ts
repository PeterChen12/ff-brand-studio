import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ExpandSeedInput, type ExpandSeedInputType } from "@ff/types";
import { expandSeed, type AutocompleteMarket } from "@ff/seo-clients";
import { withToolErrorBoundary } from "../lib/tool_boundary.js";

/**
 * v2 SEO Layer · D2 — expand_seed
 *
 * Free-tier keyword discovery via public autocomplete endpoints (Amazon,
 * Google, Tmall/Taobao). Alphabet-trick fan-out: queries `seed` + each
 * `seed a..z 0..9` → up to ~200 deduplicated phrases per seed.
 *
 * 1-hour LRU is keyed by SESSION_KV (not added here — caller decides; the
 * tool returns deterministic output for a given input so it's safe to cache).
 */
export function registerExpandSeed(server: McpServer, _env: CloudflareBindings): void {
  server.tool(
    "expand_seed",
    "v2 SEO: expand a seed term into ~50–200 deduplicated phrases via Amazon/Google/Tmall autocomplete (free, no paid APIs). Use as cheap top-of-funnel before paying for related_keywords.",
    ExpandSeedInput.shape,
    withToolErrorBoundary("expand_seed", async (params: ExpandSeedInputType) => {
      const result = await expandSeed(params.seed, params.market as AutocompleteMarket, {
        alphabetTrick: params.alphabetTrick,
        maxResults: params.maxResults,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                seed: result.seed,
                market: result.market,
                phrase_count: result.phrases.length,
                source_calls: result.source_calls,
                errors: result.errors,
                phrases: result.phrases,
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
