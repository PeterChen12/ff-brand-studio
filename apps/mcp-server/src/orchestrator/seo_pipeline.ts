/**
 * v2 SEO Layer · D6 — orchestrator sub-pipeline.
 *
 * Pipeline (per SKU):
 *   1. expand_seed (free, autocomplete fan-out)   → ~150-200 phrases
 *   2. cluster_keywords (OpenAI embed, ~$0.001)   → 25-40 clusters
 *   3. research_keywords (DataForSEO, top reps only, ~$0.05) → ranked terms
 *   4. for each surface:
 *      a. generate_seo_description (Sonnet 4.6, ~2¢/call) with cluster reps
 *      b. score_seo_compliance (deterministic, free)
 *      c. if rating < EXCELLENT and iter < 3, regenerate with issues[] feedback
 *   5. return per-surface bundle to launch pipeline
 *
 * Hard cost cap (default 50¢ total). Steps degrade gracefully on missing
 * secrets — e.g. no DataForSEO key skips ranking, no OPENAI_API_KEY skips
 * clustering and falls back to raw expand_seed phrases as keyword reps.
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  DataForSEOClient,
  expandSeed,
  embed,
  clusterByCosine,
} from "@ff/seo-clients";
import {
  getSeoSurfaceConfig,
  buildUserPrompt,
  scoreSeoCompliance,
  type SeoSurface,
  type SeoLanguage,
  type SeoComplianceResult,
} from "@ff/brand-rules";
import { flagUsAdContent, type AdContentFlag } from "../compliance/us_ad_flagger.js";
import type { Product } from "../db/schema.js";
import type { LaunchPlatform } from "./planner.js";

export interface SeoSurfaceSpec {
  surface: SeoSurface;
  language: SeoLanguage;
}

const DEFAULT_SURFACES: Record<LaunchPlatform, SeoSurfaceSpec> = {
  amazon: { surface: "amazon-us", language: "en" },
  shopify: { surface: "shopify", language: "en" },
};

// Mirror of generate-seo-description's inline zh ad-law flagger so the
// orchestrator scores Chinese surfaces with the same shape as us_ad.
const ZH_BANNED: RegExp[] = [
  /最[佳优好新强]/,
  /第一/,
  /唯一/,
  /首个/,
  /顶级/,
  /国家级/,
  /独家/,
  /绝无仅有/,
  /特效/,
  /奇效/,
  /根治/,
  /包治/,
];

function flagChineseAdLaw(text: string): AdContentFlag[] {
  const out: AdContentFlag[] = [];
  for (const re of ZH_BANNED) {
    const m = text.match(re);
    if (m) {
      out.push({
        category: "amazon_tos",
        severity: "block",
        matched: m[0],
        rule: re.source,
      });
    }
  }
  return out;
}

export interface SeoPipelineInput {
  product: Product;
  platforms: LaunchPlatform[];
  /** Override surfaces — defaults to platforms→en mapping. */
  surfaces?: SeoSurfaceSpec[];
  /** Hard cost cap in cents. Default 50¢. */
  cost_cap_cents?: number;
  anthropic_api_key: string;
  openai_api_key?: string;
  dataforseo_login?: string;
  dataforseo_password?: string;
}

export interface SeoSurfaceResult {
  surface: SeoSurface;
  language: SeoLanguage;
  copy: Record<string, unknown> | null;
  raw_output?: string;
  flags: AdContentFlag[];
  violations: string[];
  rating: SeoComplianceResult["rating"];
  issues: string[];
  suggestions: string[];
  metrics: Record<string, unknown>;
  iterations: number;
  cost_cents: number;
}

export interface SeoPipelineResult {
  status: "succeeded" | "partial" | "skipped" | "cost_capped" | "failed";
  total_cost_cents: number;
  keyword_summary: {
    seed: string;
    expanded_count: number;
    cluster_count: number;
    top_reps: string[];
  };
  surfaces: SeoSurfaceResult[];
  notes: string[];
}

const SEO_DEFAULT_CAP_CENTS = 50;
const MAX_ITERATIONS = 3;
const TOP_CLUSTER_REPS = 12;
const KEYWORD_RESEARCH_LIMIT = 20;

export async function runSeoPipeline(
  input: SeoPipelineInput
): Promise<SeoPipelineResult> {
  const notes: string[] = [];
  const cap = input.cost_cap_cents ?? SEO_DEFAULT_CAP_CENTS;
  let totalCostCents = 0;

  const surfacesToGen: SeoSurfaceSpec[] =
    input.surfaces ??
    input.platforms
      .map((p) => DEFAULT_SURFACES[p])
      .filter((s): s is SeoSurfaceSpec => !!s);

  if (surfacesToGen.length === 0) {
    return {
      status: "skipped",
      total_cost_cents: 0,
      keyword_summary: {
        seed: "",
        expanded_count: 0,
        cluster_count: 0,
        top_reps: [],
      },
      surfaces: [],
      notes: ["no surfaces to generate (platforms unmapped)"],
    };
  }

  const product = input.product;
  const seed = `${product.nameEn} ${product.category}`.replace(/\s+/g, " ").trim();

  // ── 1. expand_seed (free) ──────────────────────────────────────────────
  let expanded: string[] = [seed];
  try {
    const r = await expandSeed(seed, "amazon-us", {
      alphabetTrick: true,
      maxResults: 200,
    });
    expanded = r.phrases.length > 0 ? r.phrases : [seed];
    notes.push(
      `expand_seed → ${r.phrases.length} phrases (${r.errors} errors / ${r.source_calls} calls)`
    );
  } catch (e) {
    notes.push(`expand_seed failed: ${String(e).slice(0, 200)} — using seed only`);
  }

  // ── 2. cluster_keywords (OpenAI embed) ────────────────────────────────
  let clusters: { representative: string; members: string[]; cohesion: number }[] = [];
  if (expanded.length >= 2 && input.openai_api_key) {
    try {
      const { items, costUsd } = await embed(expanded, input.openai_api_key);
      const cents = Math.round(costUsd * 100 * 100) / 100;
      totalCostCents += cents;
      clusters = clusterByCosine(items, 0.78).map((c) => ({
        representative: c.representative,
        members: c.members,
        cohesion: c.cohesion,
      }));
      notes.push(
        `cluster_keywords → ${clusters.length} clusters from ${expanded.length} phrases (${cents}¢)`
      );
    } catch (e) {
      notes.push(`cluster_keywords failed: ${String(e).slice(0, 200)}`);
    }
  } else if (!input.openai_api_key) {
    notes.push("skipped cluster_keywords (no OPENAI_API_KEY)");
  }

  let topReps =
    clusters.length > 0
      ? clusters.slice(0, TOP_CLUSTER_REPS).map((c) => c.representative)
      : expanded.slice(0, TOP_CLUSTER_REPS);

  // ── 3. research_keywords (DataForSEO, top reps only) ──────────────────
  if (
    input.dataforseo_login &&
    input.dataforseo_password &&
    topReps.length > 0 &&
    totalCostCents < cap
  ) {
    try {
      const client = new DataForSEOClient(
        input.dataforseo_login,
        input.dataforseo_password
      );
      const r = await client.amazonRelated(topReps[0], {
        limit: KEYWORD_RESEARCH_LIMIT,
      });
      const cents = Math.round(r.costUsd * 100 * 100) / 100;
      totalCostCents += cents;
      const ranked = r.results
        .filter((k) => k.term && k.term.length > 0)
        .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
        .slice(0, TOP_CLUSTER_REPS)
        .map((k) => k.term);
      const merged = Array.from(new Set([...ranked, ...topReps]));
      topReps = merged.slice(0, TOP_CLUSTER_REPS);
      notes.push(
        `research_keywords → ${ranked.length} ranked terms (${cents}¢)`
      );
    } catch (e) {
      notes.push(
        `research_keywords failed: ${String(e).slice(0, 200)} — proceeding with cluster reps`
      );
    }
  } else if (!input.dataforseo_login || !input.dataforseo_password) {
    notes.push("skipped research_keywords (no DataForSEO credentials)");
  }

  // ── 4. generate + score per surface, with feedback regeneration ───────
  // P1-1 + P1-2 — wire SDK timeout + retry so a slow / flaky Anthropic
  // doesn't burn the whole 30s Worker budget on one surface and so
  // transient 5xx auto-retries with backoff. Tradeoff: each call can
  // take up to 15s × 3 = 45s wall-clock if everything keeps timing out,
  // but that's a fail-fast worst case — the typical retry budget is
  // <1s of extra latency on a transient error.
  const anthropic = new Anthropic({
    apiKey: input.anthropic_api_key,
    maxRetries: 3,
    timeout: 15_000,
  });
  const surfaceResults: SeoSurfaceResult[] = [];

  for (const spec of surfacesToGen) {
    if (totalCostCents >= cap) {
      notes.push(`cost cap ${cap}¢ reached — skipping ${spec.surface}:${spec.language}`);
      continue;
    }

    const cfg = getSeoSurfaceConfig(spec.surface, spec.language);
    const baseUserPrompt = buildUserPrompt({
      productName:
        spec.language === "zh"
          ? (product.nameZh ?? product.nameEn)
          : product.nameEn,
      productCategory: product.category,
      productDescription: product.description ?? undefined,
      keywordReps: topReps,
    });

    let iterations = 0;
    let surfaceCostCents = 0;
    let lastResult: {
      copy: Record<string, unknown> | null;
      raw: string;
      flags: AdContentFlag[];
      violations: string[];
      compliance: SeoComplianceResult;
    } | null = null;

    while (iterations < MAX_ITERATIONS && totalCostCents < cap) {
      iterations++;
      let userMsg = baseUserPrompt;
      if (lastResult && lastResult.compliance.issues.length > 0) {
        userMsg +=
          "\n\nPREVIOUS ATTEMPT FAILED. Fix these issues and regenerate the FULL JSON:\n" +
          lastResult.compliance.issues.map((i) => `- ${i}`).join("\n");
      }

      let resp;
      try {
        resp = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1500,
          system: [
            {
              type: "text",
              text: cfg.systemPrompt,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [{ role: "user", content: userMsg }],
        });
      } catch (e) {
        notes.push(
          `generate_seo_description ${spec.surface} iter ${iterations} failed: ${String(e).slice(0, 200)}`
        );
        break;
      }

      const raw =
        resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "";
      const inputTokens = resp.usage?.input_tokens ?? 0;
      const cachedTokens = resp.usage?.cache_read_input_tokens ?? 0;
      const outputTokens = resp.usage?.output_tokens ?? 0;
      const costUsd =
        ((inputTokens - cachedTokens) * 3 +
          cachedTokens * 0.3 +
          outputTokens * 15) /
        1_000_000;
      const callCents = Math.round(costUsd * 100 * 100) / 100;
      surfaceCostCents += callCents;
      totalCostCents += callCents;

      let parsed: Record<string, unknown> | null = null;
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        } catch {
          parsed = null;
        }
      }

      const allText = parsed
        ? Object.values(parsed)
            .flatMap((v) => (Array.isArray(v) ? v : [v]))
            .filter((x): x is string => typeof x === "string")
            .join(" \n ")
        : raw;
      const flags =
        cfg.flagger === "us-ad"
          ? flagUsAdContent(allText)
          : flagChineseAdLaw(allText);

      const violations = computeViolations(parsed, cfg);

      const compliance = scoreSeoCompliance({
        surface: spec.surface,
        language: spec.language,
        copy: parsed,
        violations,
        flags,
      });

      lastResult = { copy: parsed, raw, flags, violations, compliance };

      if (compliance.rating === "EXCELLENT") break;
    }

    if (lastResult) {
      surfaceResults.push({
        surface: spec.surface,
        language: spec.language,
        copy: lastResult.copy,
        raw_output: lastResult.copy ? undefined : lastResult.raw,
        flags: lastResult.flags,
        violations: lastResult.violations,
        rating: lastResult.compliance.rating,
        issues: lastResult.compliance.issues,
        suggestions: lastResult.compliance.suggestions,
        metrics: lastResult.compliance.metrics,
        iterations,
        cost_cents: surfaceCostCents,
      });
    }
  }

  let status: SeoPipelineResult["status"];
  if (totalCostCents > cap) status = "cost_capped";
  else if (surfaceResults.length === 0) status = "failed";
  else if (surfaceResults.length < surfacesToGen.length) status = "partial";
  else status = "succeeded";

  return {
    status,
    total_cost_cents: totalCostCents,
    keyword_summary: {
      seed,
      expanded_count: expanded.length,
      cluster_count: clusters.length,
      top_reps: topReps,
    },
    surfaces: surfaceResults,
    notes,
  };
}

// Hard-limit deterministic checks per surface — mirrors generate-seo-description
function computeViolations(
  parsed: Record<string, unknown> | null,
  cfg: ReturnType<typeof getSeoSurfaceConfig>
): string[] {
  if (!parsed) return ["LLM did not return parseable JSON"];
  const violations: string[] = [];
  if (cfg.surface === "amazon-us") {
    const t = String(parsed.title ?? "");
    if (t.length > cfg.hardLimits.title_max) {
      violations.push(`title ${t.length} > ${cfg.hardLimits.title_max}`);
    }
    const words = t
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const counts: Record<string, number> = {};
    for (const w of words) counts[w] = (counts[w] ?? 0) + 1;
    const repeated = Object.entries(counts).filter(([, n]) => n > 2);
    if (repeated.length) {
      violations.push(
        `title word repetition: ${repeated.map(([w, n]) => `${w}×${n}`).join(", ")}`
      );
    }
    const bullets = Array.isArray(parsed.bullets) ? parsed.bullets : [];
    if (bullets.length !== cfg.hardLimits.bullet_count) {
      violations.push(
        `bullets count ${bullets.length} != ${cfg.hardLimits.bullet_count}`
      );
    }
    for (const [i, b] of bullets.entries()) {
      if (typeof b === "string" && b.length > cfg.hardLimits.bullet_max) {
        violations.push(`bullet[${i}] ${b.length} > ${cfg.hardLimits.bullet_max}`);
      }
    }
    const st = String(parsed.search_terms ?? "");
    const stBytes = new TextEncoder().encode(st).length;
    if (stBytes > cfg.hardLimits.search_terms_max_bytes) {
      violations.push(
        `search_terms ${stBytes}B > ${cfg.hardLimits.search_terms_max_bytes}B`
      );
    }
  } else if (cfg.surface === "tmall") {
    const t = String(parsed.title ?? "");
    if ([...t].length > cfg.hardLimits.title_max) {
      violations.push(`title ${[...t].length} 字 > ${cfg.hardLimits.title_max}`);
    }
    const bullets = Array.isArray(parsed.bullets) ? parsed.bullets : [];
    if (
      bullets.length < cfg.hardLimits.bullet_min ||
      bullets.length > cfg.hardLimits.bullet_max_count
    ) {
      violations.push(
        `bullets count ${bullets.length} outside ${cfg.hardLimits.bullet_min}–${cfg.hardLimits.bullet_max_count}`
      );
    }
  }
  return violations;
}
