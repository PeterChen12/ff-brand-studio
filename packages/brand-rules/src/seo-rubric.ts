/**
 * Deterministic SEO compliance rubric — scores generated SEO copy against
 * platform-specific hard rules + voice constraints. Matches the shape of
 * the v2 v1 PlatformComplianceResult so the evaluator-optimizer loop in
 * the orchestrator treats it identically.
 *
 * Use this before paying for an LLM-based "writing quality" pass — most
 * regressions are deterministic limit violations, not vibe checks.
 */

import { type SeoSurface, type SeoLanguage } from "./seo-prompts.js";

export type SeoRating = "EXCELLENT" | "GOOD" | "FAIR" | "POOR";

export interface SeoComplianceResult {
  rating: SeoRating;
  issues: string[];
  suggestions: string[];
  metrics: Record<string, unknown>;
  blocking: boolean;
}

interface ScoreInput {
  surface: SeoSurface;
  language: SeoLanguage;
  copy: Record<string, unknown> | null;
  /** Pre-computed deterministic violations from generate_seo_description. */
  violations?: string[];
  /** Ad-content flags (us-ad or china-ad) with category + matched. */
  flags?: Array<{ category: string; matched: string; severity?: string }>;
}

const RECOMMEND_AMAZON = `Aim for 150-180 char title, 5 bullets ~300-400 chars each, description 1500-1900, search_terms 200-240 bytes.`;
const RECOMMEND_TMALL = `标题 25-30 字，5-6 条卖点（60-80 字/条），详情 400-480 字。避免任何绝对化用语。`;

function rateFromIssueCount(issues: number, blocking: boolean): SeoRating {
  if (blocking) return "POOR";
  if (issues === 0) return "EXCELLENT";
  if (issues <= 1) return "GOOD";
  if (issues <= 3) return "FAIR";
  return "POOR";
}

export function scoreSeoCompliance(input: ScoreInput): SeoComplianceResult {
  const issues: string[] = [...(input.violations ?? [])];
  const suggestions: string[] = [];
  const metrics: Record<string, unknown> = {};

  const flags = input.flags ?? [];
  const blockingFlags = flags.filter((f) => f.severity === "block" || !f.severity);
  if (blockingFlags.length > 0) {
    issues.push(
      `${blockingFlags.length} ad-content blocker${blockingFlags.length > 1 ? "s" : ""}: ${blockingFlags.map((f) => f.matched).join(", ")}`
    );
  }
  metrics.flag_count = flags.length;
  metrics.blocking_flag_count = blockingFlags.length;

  if (!input.copy) {
    return {
      rating: "POOR",
      issues: ["LLM did not return parseable JSON; rerun"],
      suggestions: ["Inspect raw_output and the system prompt for length issues"],
      metrics,
      blocking: true,
    };
  }

  // Per-surface metrics (advisory — non-blocking unless already in violations[])
  if (input.surface === "amazon-us") {
    const t = String(input.copy.title ?? "");
    metrics.title_chars = t.length;
    if (t.length < 80) suggestions.push(`Title is short (${t.length} chars) — add a key feature or variant.`);
    if (t.length > 180) suggestions.push(`Title is near max — consider trimming to <180 for mobile preview.`);
    const bullets = Array.isArray(input.copy.bullets) ? input.copy.bullets : [];
    metrics.bullet_count = bullets.length;
    metrics.bullet_chars = bullets.map((b) => (typeof b === "string" ? b.length : 0));
    const desc = String(input.copy.description ?? "");
    metrics.description_chars = desc.length;
    if (desc.length < 800) suggestions.push("Description <800 chars — Amazon ranks longer descriptions higher.");
    suggestions.push(RECOMMEND_AMAZON);
  } else if (input.surface === "tmall") {
    const t = String(input.copy.title ?? "");
    metrics.title_zh_chars = [...t].length;
    const bullets = Array.isArray(input.copy.bullets) ? input.copy.bullets : [];
    metrics.bullet_count = bullets.length;
    suggestions.push(RECOMMEND_TMALL);
  } else if (input.surface === "jd") {
    const t = String(input.copy.title ?? "");
    metrics.title_zh_chars = [...t].length;
  } else if (input.surface === "shopify") {
    const h1 = String(input.copy.h1 ?? "");
    const meta = String(input.copy.meta_description ?? "");
    const md = String(input.copy.description_md ?? "");
    const wordCount = md.split(/\s+/).filter(Boolean).length;
    metrics.h1_chars = h1.length;
    metrics.meta_chars = meta.length;
    metrics.description_words = wordCount;
    if (meta.length > 165) suggestions.push("Meta description >165 — Google may truncate at SERP.");
    if (wordCount < 200) suggestions.push("Description <200 words — too thin for SEO-meaningful content.");
    if (wordCount > 400) suggestions.push("Description >400 words — consider splitting into a longer-form spec sheet.");
    // JSON-LD basic shape check
    const ld = input.copy.jsonld_product as Record<string, unknown> | undefined;
    if (!ld || typeof ld !== "object" || ld["@type"] !== "Product") {
      issues.push("jsonld_product missing or @type !== 'Product'");
    }
  }

  const blocking = issues.length > 0 && (blockingFlags.length > 0 || issues.some((i) => i.includes("max") || i.includes(">")));
  const rating = rateFromIssueCount(issues.length, blocking);

  return { rating, issues, suggestions, metrics, blocking };
}
