/**
 * Per-platform SEO description prompts for the v2 SEO layer.
 * One source of truth for: marketplace policy → prompt rules → output shape.
 *
 * Surfaces:
 * - amazon-us  Amazon US listings (Jan 2025 title rule baked in)
 * - tmall      天猫 详情页 — passes through PRC ad-law flagger before publish
 * - jd         京东 商品标题 — same compliance discipline as Tmall
 * - shopify    DTC — H1/meta + JSON-LD Product schema for SEO
 *
 * Each prompt is split into (a) a stable system block (cacheable via
 * Anthropic prompt caching) and (b) a per-call user block carrying SKU
 * specifics + keyword cluster representatives.
 */

export type SeoSurface = "amazon-us" | "tmall" | "jd" | "shopify";
export type SeoLanguage = "en" | "zh";

export interface SeoSurfaceConfig {
  surface: SeoSurface;
  language: SeoLanguage;
  /** Cacheable system prompt — pin word-for-word. */
  systemPrompt: string;
  /** Output JSON schema description (informs the LLM what to emit). */
  outputShape: string;
  /** Hard byte/char/struct constraints checked deterministically post-gen. */
  hardLimits: Record<string, number>;
  /** Compliance flagger to run on the output. */
  flagger: "us-ad" | "china-ad";
}

const AMAZON_US_RULES = `Amazon US listing rules (Jan 2025 enforcement):
- title: ≤200 characters total. NO word repeated more than 2× in title (Jan 2025 anti-stuffing rule).
  No promotional language ("best", "#1", "guaranteed", "money-back guarantee", "eco-friendly" without cert).
  No special characters: ! ? * # $ … only standard punctuation. Use sentence-case.
  Format: [Brand] [Product] [Key Feature] [Variant/Size]
- bullets: exactly 5. ≤500 characters EACH. Lead with the benefit, then the spec.
  Imperative voice ("Charges in 30 minutes", not "Will charge in 30 minutes").
  No "click here", no review references, no competitor names.
- description: ≤2000 characters. Plain text or simple HTML (<br><p><b><i><ul>).
- search_terms: backend keywords, ≤249 BYTES (UTF-8). Single line, space-separated, lowercase, no commas.
  Don't repeat title words. No misspellings. No competitor brands.
- Strictly avoid: "lifetime", "premium" without basis, drug/health claims, FDA references.`;

const TMALL_RULES = `天猫 详情页 / 商品标题 中文规则：
- title: ≤30 个汉字。结构：[品牌] [品类] [核心卖点] [型号/规格]
  禁止使用：最、第一、唯一、首个、顶级、国家级、最佳、绝无仅有、独家（《广告法》第9条）
- bullets: 5-7 条产品卖点。每条 ≤80 字。突出实用功能，不夸张。
- long_description: ≤500 字。结构清晰，段落分明。可包含规格表格描述。
- backend_keywords: ≤100 字符。搜索词，空格分隔，与正文不重复。
- 字体假设：PingFang SC / Source Han Sans CN / 思源黑体（手机端默认渲染）。
- 涉及医疗/保健品/化妆品/食品时，避免疗效宣称。`;

const JD_RULES = `京东 商品标题 中文规则：
- title: ≤60 个汉字。可比天猫多 2× 字数。结构同天猫。
- bullets: 5 条。每条 ≤100 字。
- description: ≤800 字。京东详情页支持更长描述。
- 同样禁止《广告法》第9条绝对化用语。`;

const SHOPIFY_RULES = `Shopify DTC product page SEO:
- h1: ≤60 characters. Maps to <title> tag. Brand-led, descriptive.
- meta_description: ≤160 characters (Google SERP truncation point). Action-oriented.
- description_md: 200-400 words, GitHub-flavored markdown. Sections welcome (e.g., "Why it works", "What's in the box").
- jsonld_product: complete schema.org Product object (name, description, brand, offers, image, sku, aggregateRating optional).
- alt_text: ≤100 characters. Describes the image semantically (not "image of …").
- Avoid: keyword stuffing, fake urgency ("only 3 left!" without basis), competitor mentions.`;

const BASE_VOICE = `Voice: confident but not promotional. Specific specs over vague hype. American conversational English (or natural mainland Chinese for zh).
DO NOT use: "best", "#1", "guaranteed", "money-back guarantee", named competitor brands, weight-loss promises with numbers, FDA-related claims, drug claims (cure/treat/heal/prevent/diagnose).`;

const BASE_VOICE_ZH = `语气：自信但不浮夸，具体参数胜过空洞口号，自然书面中文（非翻译腔）。
禁止用语：最、第一、唯一、首个、顶级、国家级、最佳、绝无仅有、独家、特效、奇效、根治。
禁止比较：竞品名（如"超越XX"）。`;

// ── Builders ───────────────────────────────────────────────────────────────

function amazonSystemPrompt(): string {
  return `You write Amazon US product listings that comply with marketplace rules and rank well organically.

${AMAZON_US_RULES}

${BASE_VOICE}

Return JSON ONLY (no prose, no markdown fences):
{
  "title": "string ≤200 chars, no word repeated more than 2×",
  "bullets": ["≤500 chars", "≤500 chars", "≤500 chars", "≤500 chars", "≤500 chars"],
  "description": "≤2000 chars",
  "search_terms": "≤249 bytes UTF-8 lowercase space-separated"
}`;
}

function tmallSystemPrompt(): string {
  return `你是一名天猫详情页文案专家，遵守《广告法》和平台规则。

${TMALL_RULES}

${BASE_VOICE_ZH}

只输出 JSON（无说明，无 markdown）：
{
  "title": "≤30 汉字",
  "bullets": ["≤80 字", "≤80 字", "≤80 字", "≤80 字", "≤80 字"],
  "long_description": "≤500 字",
  "backend_keywords": "≤100 字符 空格分隔"
}`;
}

function jdSystemPrompt(): string {
  return `你是一名京东商品文案专家，遵守《广告法》。

${JD_RULES}

${BASE_VOICE_ZH}

只输出 JSON：
{
  "title": "≤60 汉字",
  "bullets": ["≤100 字", "≤100 字", "≤100 字", "≤100 字", "≤100 字"],
  "description": "≤800 字"
}`;
}

function shopifySystemPrompt(): string {
  return `You write Shopify DTC product pages optimized for organic search and conversion.

${SHOPIFY_RULES}

${BASE_VOICE}

Return JSON ONLY:
{
  "h1": "≤60 chars",
  "meta_description": "≤160 chars",
  "description_md": "GitHub-flavored markdown, 200-400 words",
  "jsonld_product": { "@context": "https://schema.org", "@type": "Product", ... },
  "alt_text": "≤100 chars"
}`;
}

export const SEO_SURFACE_CONFIGS: Record<string, SeoSurfaceConfig> = {
  "amazon-us:en": {
    surface: "amazon-us",
    language: "en",
    systemPrompt: amazonSystemPrompt(),
    outputShape:
      "{ title: string, bullets: string[5], description: string, search_terms: string }",
    hardLimits: {
      title_max: 200,
      bullet_count: 5,
      bullet_max: 500,
      description_max: 2000,
      search_terms_max_bytes: 249,
    },
    flagger: "us-ad",
  },
  "tmall:zh": {
    surface: "tmall",
    language: "zh",
    systemPrompt: tmallSystemPrompt(),
    outputShape:
      "{ title: string, bullets: string[5..7], long_description: string, backend_keywords: string }",
    hardLimits: {
      title_max: 30,
      bullet_min: 5,
      bullet_max_count: 7,
      bullet_max: 80,
      long_description_max: 500,
      backend_keywords_max: 100,
    },
    flagger: "china-ad",
  },
  "jd:zh": {
    surface: "jd",
    language: "zh",
    systemPrompt: jdSystemPrompt(),
    outputShape:
      "{ title: string, bullets: string[5], description: string }",
    hardLimits: {
      title_max: 60,
      bullet_count: 5,
      bullet_max: 100,
      description_max: 800,
    },
    flagger: "china-ad",
  },
  "shopify:en": {
    surface: "shopify",
    language: "en",
    systemPrompt: shopifySystemPrompt(),
    outputShape:
      "{ h1: string, meta_description: string, description_md: string, jsonld_product: object, alt_text: string }",
    hardLimits: {
      h1_max: 60,
      meta_max: 160,
      description_md_min_words: 200,
      description_md_max_words: 400,
      alt_text_max: 100,
    },
    flagger: "us-ad",
  },
};

export function getSeoSurfaceConfig(
  surface: SeoSurface,
  language: SeoLanguage
): SeoSurfaceConfig {
  const key = `${surface}:${language}`;
  const cfg = SEO_SURFACE_CONFIGS[key];
  if (!cfg) {
    throw new Error(
      `No SEO config for ${surface}/${language}. Valid combinations: ${Object.keys(SEO_SURFACE_CONFIGS).join(", ")}`
    );
  }
  return cfg;
}

export function buildUserPrompt(args: {
  productName: string;
  productCategory: string;
  specs?: Record<string, string | number | undefined>;
  keywordReps: string[];
  brandHint?: string;
}): string {
  const specLines = args.specs
    ? Object.entries(args.specs)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n")
    : "(no specs provided)";

  const kwLine = args.keywordReps.length
    ? args.keywordReps.slice(0, 12).join(", ")
    : "(none — write generically)";

  return `Product: ${args.productName}
Category: ${args.productCategory}
${args.brandHint ? `Brand voice: ${args.brandHint}` : ""}
Specs:
${specLines}

Target keywords (rank these terms organically — work them in naturally, do NOT stuff): ${kwLine}

Write the listing now. JSON only.`;
}
