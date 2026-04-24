import type { GeneratedAssetType, BrandScorecardType } from "@ff/types";
import { stubScorecard } from "../../tools/score-brand-compliance.js";
import type Langfuse from "langfuse";

export interface GuardianOutput {
  scoredAssets: Array<GeneratedAssetType & { scorecard: BrandScorecardType }>;
  allPass: boolean;
  minScore: number;
}

// scoreBrandComplianceFn is injected so guardian.ts can swap stub → real impl (Step 4.2)
export type ScoreFn = (params: {
  assetUrl: string;
  assetType: string;
  copyEn?: string;
  copyZh?: string;
  apiKey: string;
}) => Promise<BrandScorecardType>;

export async function guardianStep(params: {
  assets: GeneratedAssetType[];
  copyEn?: string;
  copyZh?: string;
  apiKey: string;
  scoreFn: ScoreFn;
  langfuse: Langfuse;
  traceId: string;
}): Promise<GuardianOutput> {
  const trace = params.langfuse.trace({ id: params.traceId });
  const span = trace.span({ name: "brand-guardian" });

  const scoredAssets: GuardianOutput["scoredAssets"] = [];

  for (const asset of params.assets) {
    let scorecard: BrandScorecardType;
    try {
      scorecard = await params.scoreFn({
        assetUrl: asset.image_url,
        assetType: asset.asset_type,
        copyEn: params.copyEn,
        copyZh: params.copyZh,
        apiKey: params.apiKey,
      });
    } catch {
      // On error, use stub to avoid crashing the workflow
      scorecard = stubScorecard();
    }

    scoredAssets.push({ ...asset, scorecard, brand_score: scorecard.overall_score });
  }

  const scores = scoredAssets.map((a) => a.scorecard.overall_score);
  const minScore = scores.length > 0 ? Math.min(...scores) : 0;
  const allPass = scoredAssets.every((a) => a.scorecard.pass);

  span.end({ output: `${scoredAssets.length} assets scored. Min: ${minScore}. All pass: ${allPass}` });

  return { scoredAssets, allPass, minScore };
}
