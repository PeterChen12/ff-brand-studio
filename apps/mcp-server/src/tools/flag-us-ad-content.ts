import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FlagUsAdContentInput } from "@ff/types";
import { flagUsAdContent } from "../compliance/us_ad_flagger.js";

export function registerFlagUsAdContent(
  server: McpServer,
  _env: CloudflareBindings
): void {
  server.tool(
    "flag_us_ad_content",
    "v2 Phase 4: pattern-based US ad-content flagger (Amazon ToS + FTC + health-claims). Returns matched flags grouped by category. Free, deterministic; Phase 4 follow-up upgrades to Sonnet 4.6 LLM call for nuance.",
    FlagUsAdContentInput.shape,
    async (params) => {
      const flags = flagUsAdContent(params.text);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                surface: params.surface,
                clean: flags.length === 0,
                flag_count: flags.length,
                flags,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
