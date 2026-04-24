import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PublishToDAMInput } from "@ff/types";
import { createDbClient } from "../db/client.js";
import { assets } from "../db/schema.js";

export function registerPublishToDAM(
  server: McpServer,
  env: CloudflareBindings
): void {
  server.tool(
    "publish_to_dam",
    "Save a generated asset to the Digital Asset Manager (Postgres) and return a mock social preview",
    PublishToDAMInput.shape,
    async (params) => {
      const db = createDbClient(env);

      const publicUrl = `${env.R2_PUBLIC_URL.replace(/\/$/, "")}/${params.r2_key}`;

      await db.insert(assets).values({
        r2Key: params.r2_key,
        assetType: params.asset_type,
        campaign: params.metadata.campaign,
        platform: params.metadata.platform,
        locale: params.metadata.locale,
        brandScore: params.metadata.brand_score,
        metadata: params.metadata as Record<string, unknown>,
      });

      const linkedInPreview = {
        platform: "linkedin",
        status: "mock_scheduled",
        preview_text: `[Asset: ${params.asset_type}] Campaign: ${params.metadata.campaign}`,
        image_url: publicUrl,
        locale: params.metadata.locale,
        note: "Real LinkedIn publishing requires LinkedIn Developer OAuth — mocked for demo",
      };

      const weiboPreview = {
        platform: "weibo",
        status: "mock_scheduled",
        preview_text: `[素材: ${params.asset_type}] 活动: ${params.metadata.campaign}`,
        image_url: publicUrl,
        locale: params.metadata.locale,
        note: "Weibo publishing requires mainland China business entity — mocked for demo",
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              r2_key: params.r2_key,
              public_url: publicUrl,
              dam_record_created: true,
              brand_score: params.metadata.brand_score,
              platform_previews: {
                linkedin: params.publish_targets?.includes("linkedin")
                  ? linkedInPreview
                  : null,
                weibo: params.publish_targets?.includes("weibo")
                  ? weiboPreview
                  : null,
              },
            }),
          },
        ],
      };
    }
  );
}
