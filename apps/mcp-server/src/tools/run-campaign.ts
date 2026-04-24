import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RunCampaignInput } from "@ff/types";
import { runCampaignWorkflow, setScoreFn } from "../workflows/campaign.workflow.js";
import { scoreBrandCompliance } from "../guardian/index.js";

export function registerRunCampaign(server: McpServer, env: CloudflareBindings): void {
  // Wire the real Brand Guardian score function into the workflow
  setScoreFn((params) =>
    scoreBrandCompliance({
      assetUrl: params.assetUrl,
      assetType: params.assetType,
      copyEn: params.copyEn,
      copyZh: params.copyZh,
      apiKey: params.apiKey,
    })
  );

  server.tool(
    "run_campaign",
    "Orchestrate a full bilingual campaign: extract key points, write copy, generate images, score against brand guidelines, and publish to DAM",
    RunCampaignInput.shape,
    async (params) => {
      const result = await runCampaignWorkflow(params, env);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
}
