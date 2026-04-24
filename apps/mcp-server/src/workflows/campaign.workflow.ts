import type { RunCampaignInputType } from "@ff/types";
import { getLangfuse } from "../lib/langfuse.js";
import { plannerStep } from "./steps/planner.js";
import { copyStep } from "./steps/copy.js";
import { translateStep } from "./steps/translate.js";
import { imageStep } from "./steps/image.js";
import { videoStep } from "./steps/video.js";
import { guardianStep } from "./steps/guardian.js";
import { publishStep } from "./steps/publish.js";
import { stubScorecard } from "../tools/score-brand-compliance.js";
import type { ScoreFn } from "./steps/guardian.js";

export interface CampaignResult {
  campaign_id: string;
  status: "complete" | "hitl_required";
  key_points: unknown[];
  copy: {
    linkedin_en: string;
    linkedin_zh: string;
    weibo_en: string;
    weibo_zh: string;
  };
  published_assets: unknown[];
  hitl_required_assets?: unknown[];
  total_assets: number;
  run_cost_logged: boolean;
}

// scoreBrandComplianceFn — injected. Starts as stub, replaced in Step 4.2.
let _scoreFn: ScoreFn = async (params) => {
  void params;
  return stubScorecard();
};

export function setScoreFn(fn: ScoreFn): void {
  _scoreFn = fn;
}

export async function runCampaignWorkflow(
  params: RunCampaignInputType,
  env: CloudflareBindings
): Promise<CampaignResult> {
  const campaignId = `camp-${Date.now()}`;
  const langfuse = getLangfuse(env);
  const traceId = campaignId;

  // Step 1: Plan
  const plannerOutput = await plannerStep({
    sourceText: params.source_text,
    anthropicKey: env.ANTHROPIC_API_KEY,
    langfuse,
    traceId,
  });

  // Step 2: Copy
  const copyOutput = await copyStep({
    plannerOutput,
    platforms: params.platforms,
    anthropicKey: env.ANTHROPIC_API_KEY,
    langfuse,
    traceId,
  });

  // Step 3: Translate to ZH
  const translateOutput = await translateStep({
    copyOutput,
    anthropicKey: env.ANTHROPIC_API_KEY,
    langfuse,
    traceId,
  });

  // Step 4: Generate images
  const imageOutput = await imageStep({
    plannerOutput,
    includeInfographic: params.include_infographic,
    r2Bucket: env.R2,
    r2PublicUrl: env.R2_PUBLIC_URL,
    falKey: env.FAL_KEY,
    openaiKey: env.OPENAI_API_KEY,
    langfuse,
    traceId,
  });

  // Step 4b: Optional video
  if (params.include_video && imageOutput.assets.length > 0) {
    const firstAsset = imageOutput.assets[0];
    const videoOutput = await videoStep({
      visualBrief: plannerOutput.key_points[0]?.visual_brief ?? "",
      heroImageUrl: firstAsset?.image_url,
      r2PublicUrl: env.R2_PUBLIC_URL,
      falKey: env.FAL_KEY,
      langfuse,
      traceId,
    });

    if (videoOutput.videoAsset) {
      imageOutput.assets.push(videoOutput.videoAsset);
    }
  }

  // Step 5: Brand Guardian scoring
  const guardianOutput = await guardianStep({
    assets: imageOutput.assets,
    copyEn: copyOutput.linkedin_post_en,
    copyZh: translateOutput.linkedin_post_zh,
    apiKey: env.ANTHROPIC_API_KEY,
    scoreFn: _scoreFn,
    langfuse,
    traceId,
  });

  // Step 6: HITL check — if any score < 70, return early for human review
  if (!guardianOutput.allPass && guardianOutput.minScore < 70) {
    await langfuse.flushAsync();
    return {
      campaign_id: campaignId,
      status: "hitl_required",
      key_points: plannerOutput.key_points,
      copy: {
        linkedin_en: copyOutput.linkedin_post_en,
        linkedin_zh: translateOutput.linkedin_post_zh,
        weibo_en: copyOutput.weibo_post_en,
        weibo_zh: translateOutput.weibo_post_zh,
      },
      published_assets: [],
      hitl_required_assets: guardianOutput.scoredAssets.map((a) => ({
        r2_key: a.r2_key,
        image_url: a.image_url,
        asset_type: a.asset_type,
        brand_score: a.scorecard.overall_score,
        scorecard: a.scorecard,
      })),
      total_assets: guardianOutput.scoredAssets.length,
      run_cost_logged: false,
    };
  }

  // Step 7: Publish to DAM
  const publishOutput = await publishStep({
    scoredAssets: guardianOutput.scoredAssets,
    campaign: campaignId,
    platforms: params.platforms,
    linkedInPostEn: copyOutput.linkedin_post_en,
    linkedInPostZh: translateOutput.linkedin_post_zh,
    weiboPostZh: translateOutput.weibo_post_zh,
    env,
    langfuse,
    traceId,
    claudeInputTokens: 0,
    claudeOutputTokens: 0,
  });

  return {
    campaign_id: campaignId,
    status: "complete",
    key_points: plannerOutput.key_points,
    copy: {
      linkedin_en: copyOutput.linkedin_post_en,
      linkedin_zh: translateOutput.linkedin_post_zh,
      weibo_en: copyOutput.weibo_post_en,
      weibo_zh: translateOutput.weibo_post_zh,
    },
    published_assets: publishOutput.publishedAssets,
    total_assets: publishOutput.publishedAssets.length,
    run_cost_logged: publishOutput.run_cost_logged,
  };
}
