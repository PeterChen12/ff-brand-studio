import type { GeneratedAssetType, BrandScorecardType } from "@ff/types";
import { createDbClient } from "../../db/client.js";
import { assets, runCosts, SAMPLE_TENANT_ID } from "../../db/schema.js";
import type Langfuse from "langfuse";

export interface PublishOutput {
  publishedAssets: Array<{
    r2_key: string;
    image_url: string;
    brand_score: number;
    dam_id: string;
    platform_previews: {
      linkedin: { status: string; preview_text: string } | null;
      weibo: { status: string; preview_text: string } | null;
    };
  }>;
  run_cost_logged: boolean;
}

export async function publishStep(params: {
  scoredAssets: Array<GeneratedAssetType & { scorecard: BrandScorecardType }>;
  campaign: string;
  platforms: string[];
  linkedInPostEn: string;
  linkedInPostZh: string;
  weiboPostZh: string;
  env: CloudflareBindings;
  langfuse: Langfuse;
  traceId: string;
  claudeInputTokens: number;
  claudeOutputTokens: number;
}): Promise<PublishOutput> {
  const db = createDbClient(params.env);
  const trace = params.langfuse.trace({ id: params.traceId });
  const span = trace.span({ name: "publish-to-dam" });

  const publishedAssets: PublishOutput["publishedAssets"] = [];

  for (const asset of params.scoredAssets) {
    const publicUrl = asset.image_url;

    const [row] = await db
      .insert(assets)
      .values({
        // Phase G — legacy v1 campaign path; assets attributed to the
        // sample-catalog tenant since this surface predates per-tenant
        // upload (Phase H replaces it).
        tenantId: SAMPLE_TENANT_ID,
        r2Key: asset.r2_key,
        assetType: asset.asset_type,
        campaign: params.campaign,
        platform: params.platforms.join(","),
        locale: "bilingual",
        brandScore: asset.scorecard.overall_score,
        metadata: {
          scorecard: asset.scorecard,
          campaigns: params.platforms,
        },
      })
      .returning({ id: assets.id });

    const liPreview = params.platforms.includes("linkedin")
      ? {
          status: "mock_ready",
          preview_text: params.linkedInPostEn.slice(0, 100) + "...",
        }
      : null;

    const wbPreview = params.platforms.includes("weibo")
      ? { status: "mock_ready", preview_text: params.weiboPostZh.slice(0, 50) }
      : null;

    publishedAssets.push({
      r2_key: asset.r2_key,
      image_url: publicUrl,
      brand_score: asset.scorecard.overall_score,
      dam_id: row?.id ?? "unknown",
      platform_previews: { linkedin: liPreview, weibo: wbPreview },
    });
  }

  // Log run costs
  const heroCount = params.scoredAssets.filter((a) => a.asset_type === "hero_image").length;
  const infoCount = params.scoredAssets.filter((a) => a.asset_type === "infographic").length;
  const videoCount = params.scoredAssets.filter((a) => a.asset_type === "video").length;

  const totalCost =
    heroCount * 0.055 +
    infoCount * 0.09 +
    videoCount * 0.18 +
    (params.claudeInputTokens / 1000) * 0.003 +
    (params.claudeOutputTokens / 1000) * 0.015;

  let run_cost_logged = false;
  try {
    await db.insert(runCosts).values({
      tenantId: SAMPLE_TENANT_ID,
      campaign: params.campaign,
      gptImage2Calls: infoCount,
      fluxCalls: heroCount,
      klingCalls: videoCount,
      claudeInputTokens: params.claudeInputTokens,
      claudeOutputTokens: params.claudeOutputTokens,
      totalCostUsd: totalCost.toFixed(4),
    });
    run_cost_logged = true;
  } catch {
    // Non-fatal
  }

  span.end({ output: `Published ${publishedAssets.length} assets. Cost: $${totalCost.toFixed(3)}` });
  await params.langfuse.flushAsync();

  return { publishedAssets, run_cost_logged };
}
