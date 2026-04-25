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

// ── v2 ecommerce-imagery tool inputs ────────────────────────────────────────

export const PlatformComplianceRating = z.enum(["EXCELLENT", "GOOD", "FAIR", "POOR"]);
export type PlatformComplianceRatingType = z.infer<typeof PlatformComplianceRating>;

export const PlatformComplianceResult = z.object({
  rating: PlatformComplianceRating,
  issues: z.array(z.string()),
  suggestions: z.array(z.string()),
  metrics: z.record(z.string(), z.unknown()),
});
export type PlatformComplianceResultType = z.infer<typeof PlatformComplianceResult>;

export const ScoreAmazonComplianceInput = z.object({
  asset_id: z.string().uuid(),
});
export type ScoreAmazonComplianceInputType = z.infer<typeof ScoreAmazonComplianceInput>;

export const ScoreShopifyComplianceInput = z.object({
  asset_id: z.string().uuid(),
});
export type ScoreShopifyComplianceInputType = z.infer<typeof ScoreShopifyComplianceInput>;

export const TranscreateZhToEnUsInput = z.object({
  zh_source: z.string().min(1).max(4000),
  surface: z.enum([
    "amazon_title",
    "amazon_bullet",
    "amazon_description",
    "a_plus_callout",
    "shopify_description",
    "image_overlay",
  ]),
  brand_voice: z
    .object({
      tone: z.string().optional(),
      banned_words: z.array(z.string()).optional(),
      must_use_phrases: z.array(z.string()).optional(),
    })
    .optional(),
});
export type TranscreateZhToEnUsInputType = z.infer<typeof TranscreateZhToEnUsInput>;

export const FlagUsAdContentInput = z.object({
  text: z.string().min(1),
  surface: z.enum([
    "amazon_title",
    "amazon_bullet",
    "amazon_description",
    "a_plus_callout",
    "shopify_description",
    "image_overlay",
    "social_post",
  ]),
});
export type FlagUsAdContentInputType = z.infer<typeof FlagUsAdContentInput>;



// Single source of truth for product categories — also enforced as a CHECK
// constraint at the DB layer (P1 #8).
export const ProductCategory = z.enum([
  "apparel",
  "drinkware",
  "tech-acc",
  "bag",
  "hat",
  "other",
]);
export type ProductCategoryType = z.infer<typeof ProductCategory>;

export const LaunchProductSkuInput = z.object({
  product_id: z.string().uuid().describe("UUID of the product row to launch"),
  platforms: z
    .array(z.enum(["amazon", "shopify"]))
    .min(1)
    .default(["amazon", "shopify"])
    .describe("Marketplaces to fan out to. Tmall/JD intentionally out of v2 scope."),
  include_video: z.boolean().default(false),
  dry_run: z
    .boolean()
    .default(true)
    .describe(
      "When true (default in Phase 1), inserts the launch_runs row with status='pending' and returns the run_id without doing any generation. Phases 2-5 wire in the real fan-out."
    ),
});
export type LaunchProductSkuInputType = z.infer<typeof LaunchProductSkuInput>;

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
