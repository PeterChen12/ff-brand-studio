import { z } from "zod";

// ── Tool Input Schemas ────────────────────────────────────────────────────────

export const GenerateBrandHeroInput = z.object({
  prompt_en: z.string().min(1).describe("English creative brief for the hero image"),
  vehicle_model: z.enum(["FF91", "FF81", "FF71"]).optional(),
  mood: z.enum(["luxury", "tech", "lifestyle", "dramatic"]).default("luxury"),
  aspect_ratio: z.enum(["16:9", "1:1", "9:16", "4:5"]).default("16:9"),
  style: z.enum(["photoreal", "cinematic"]).default("photoreal"),
});
export type GenerateBrandHeroInputType = z.infer<typeof GenerateBrandHeroInput>;

export const GenerateBilingualInfographicInput = z.object({
  title_en: z.string().min(1).max(80),
  title_zh: z.string().min(1).max(40),
  points: z
    .array(z.object({ en: z.string().min(1), zh: z.string().min(1) }))
    .min(1)
    .max(5),
  template: z
    .enum(["three_points", "stats_bar", "timeline", "comparison"])
    .default("three_points"),
  accent_color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default("#1C3FAA"),
});
export type GenerateBilingualInfographicInputType = z.infer<
  typeof GenerateBilingualInfographicInput
>;

export const LocalizeToZhInput = z.object({
  content_en: z.string().min(1).max(2000),
  platform: z.enum(["linkedin", "weibo", "wechat", "xiaohongshu"]),
  tone: z.enum(["formal", "conversational", "investor"]).default("investor"),
  preserve_technical_terms: z.boolean().default(true),
});
export type LocalizeToZhInputType = z.infer<typeof LocalizeToZhInput>;

export const ScoreBrandComplianceInput = z.object({
  asset_url: z.string().url(),
  asset_type: z.enum(["hero_image", "infographic", "video_thumbnail", "social_post"]),
  copy_en: z.string().optional(),
  copy_zh: z.string().optional(),
});
export type ScoreBrandComplianceInputType = z.infer<typeof ScoreBrandComplianceInput>;

export const PublishToDAMInput = z.object({
  r2_key: z.string().min(1),
  asset_type: z.enum(["hero_image", "infographic", "video", "copy"]),
  metadata: z.object({
    campaign: z.string(),
    platform: z.string(),
    locale: z.enum(["en", "zh", "bilingual"]),
    brand_score: z.number().int().min(0).max(100),
  }),
  publish_targets: z.array(z.enum(["linkedin", "weibo"])).optional(),
});
export type PublishToDAMInputType = z.infer<typeof PublishToDAMInput>;

export const RunCampaignInput = z.object({
  source_text: z
    .string()
    .min(10)
    .max(5000)
    .describe("Raw investor update, press release, or creative brief"),
  platforms: z.array(z.enum(["linkedin", "weibo"])).min(1),
  include_infographic: z.boolean().default(true),
  include_video: z.boolean().default(false),
  auto_publish: z.boolean().default(false),
});
export type RunCampaignInputType = z.infer<typeof RunCampaignInput>;

// ── Brand Scorecard ───────────────────────────────────────────────────────────

const DimensionScore = z.object({
  score: z.number().min(0).max(100),
  notes: z.string(),
});

const Violation = z.object({
  rule: z.string(),
  severity: z.enum(["critical", "warning", "info"]),
  description: z.string(),
  guideline_reference: z.string().optional(),
});

export const BrandScorecard = z.object({
  overall_score: z.number().min(0).max(100),
  pass: z.boolean(),
  dimensions: z.object({
    color_compliance: DimensionScore,
    typography_compliance: DimensionScore,
    logo_placement: DimensionScore,
    image_quality: DimensionScore,
    copy_tone: DimensionScore,
  }),
  violations: z.array(Violation),
  suggestions: z.array(z.string()),
});
export type BrandScorecardType = z.infer<typeof BrandScorecard>;

// ── Campaign Workflow Types ───────────────────────────────────────────────────

export const KeyPoint = z.object({
  headline_en: z.string(),
  headline_zh: z.string(),
  body_en: z.string(),
  body_zh: z.string(),
  visual_brief: z.string(),
});
export type KeyPointType = z.infer<typeof KeyPoint>;

export const PlannerOutput = z.object({
  key_points: z.array(KeyPoint).min(1).max(5),
  linkedin_draft_en: z.string(),
  weibo_draft_en: z.string(),
});
export type PlannerOutputType = z.infer<typeof PlannerOutput>;

export const GeneratedAsset = z.object({
  r2_key: z.string(),
  image_url: z.string().url(),
  asset_type: z.enum(["hero_image", "infographic", "video"]),
  brand_score: z.number().min(0).max(100).optional(),
});
export type GeneratedAssetType = z.infer<typeof GeneratedAsset>;
