import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  getSeoSurfaceConfig,
  buildUserPrompt,
  type SeoSurface,
  type SeoLanguage,
} from "@ff/brand-rules";
import { flagUsAdContent, type AdContentFlag } from "../compliance/us_ad_flagger.js";
import { withToolErrorBoundary } from "../lib/tool_boundary.js";

/**
 * v2 SEO Layer · D4 — generate_seo_description
 *
 * Sonnet 4.6 with cached system prompt (per-platform). Hard cost cap:
 * $0.05/call. Output goes through the appropriate ad-content flagger
 * (us-ad for amazon-us / shopify; china-ad for tmall / jd) before
 * returning. Caller (orchestrator) decides whether to halt on flags or
 * iterate via evaluator-optimizer.
 */

const InputSchema = z.object({
  surface: z.enum(["amazon-us", "tmall", "jd", "shopify"]),
  language: z.enum(["en", "zh"]),
  product_name: z.string().min(2).max(200),
  product_category: z.string().min(2).max(80),
  specs: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  keyword_reps: z.array(z.string()).max(20).default([]),
  brand_hint: z.string().max(300).optional(),
});
type Input = z.infer<typeof InputSchema>;

// Minimum-bar Chinese ad-law check using the same allow-list shape as the
// US flagger, so the orchestrator gets a uniform `flags[]` payload.
const ZH_BANNED = [
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
        category: "amazon_tos", // closest existing category — surface-agnostic
        severity: "block",
        matched: m[0],
        rule: re.source,
      });
    }
  }
  return out;
}

export function registerGenerateSeoDescription(
  server: McpServer,
  env: CloudflareBindings
): void {
  server.tool(
    "generate_seo_description",
    "v2 SEO: generate platform-specific SEO copy (title/bullets/description) via Sonnet 4.6 with cached prompt. Output is automatically flagged for US ad-rules (en) or 广告法 (zh). Hard cost cap $0.05/call.",
    InputSchema.shape,
    withToolErrorBoundary("generate_seo_description", async (params: Input) => {
      const cfg = getSeoSurfaceConfig(
        params.surface as SeoSurface,
        params.language as SeoLanguage
      );

      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

      const userMsg = buildUserPrompt({
        productName: params.product_name,
        productCategory: params.product_category,
        specs: params.specs,
        keywordReps: params.keyword_reps,
        brandHint: params.brand_hint,
      });

      // Sonnet 4.6 with cached system prompt — first call warms cache, repeat
      // calls drop input cost ~75%. Cap output to keep total under $0.05.
      const resp = await client.messages.create({
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

      const raw = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "";
      let parsed: Record<string, unknown> | null = null;
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        } catch {
          parsed = null;
        }
      }

      // Concatenate text fields for flagger sweep
      const allText = parsed
        ? Object.values(parsed)
            .flatMap((v) => (Array.isArray(v) ? v : [v]))
            .filter((x): x is string => typeof x === "string")
            .join(" \n ")
        : raw;

      const flags =
        cfg.flagger === "us-ad" ? flagUsAdContent(allText) : flagChineseAdLaw(allText);

      // Hard-limit checks (deterministic, doesn't need LLM)
      const violations: string[] = [];
      if (parsed && cfg.surface === "amazon-us") {
        const t = String(parsed.title ?? "");
        if (t.length > cfg.hardLimits.title_max) violations.push(`title ${t.length} > ${cfg.hardLimits.title_max}`);
        // Word-repetition rule (Jan 2025): no word more than 2× in title
        const words = t.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
        const counts: Record<string, number> = {};
        for (const w of words) counts[w] = (counts[w] ?? 0) + 1;
        const repeated = Object.entries(counts).filter(([, n]) => n > 2);
        if (repeated.length) {
          violations.push(`title word repetition: ${repeated.map(([w, n]) => `${w}×${n}`).join(", ")}`);
        }
        const bullets = Array.isArray(parsed.bullets) ? parsed.bullets : [];
        if (bullets.length !== cfg.hardLimits.bullet_count) {
          violations.push(`bullets count ${bullets.length} != ${cfg.hardLimits.bullet_count}`);
        }
        for (const [i, b] of bullets.entries()) {
          if (typeof b === "string" && b.length > cfg.hardLimits.bullet_max) {
            violations.push(`bullet[${i}] ${b.length} > ${cfg.hardLimits.bullet_max}`);
          }
        }
        const st = String(parsed.search_terms ?? "");
        const stBytes = new TextEncoder().encode(st).length;
        if (stBytes > cfg.hardLimits.search_terms_max_bytes) {
          violations.push(`search_terms ${stBytes}B > ${cfg.hardLimits.search_terms_max_bytes}B`);
        }
      }
      if (parsed && cfg.surface === "tmall") {
        const t = String(parsed.title ?? "");
        if ([...t].length > cfg.hardLimits.title_max) {
          violations.push(`title ${[...t].length} 字 > ${cfg.hardLimits.title_max}`);
        }
        const bullets = Array.isArray(parsed.bullets) ? parsed.bullets : [];
        if (bullets.length < cfg.hardLimits.bullet_min || bullets.length > cfg.hardLimits.bullet_max_count) {
          violations.push(`bullets count ${bullets.length} outside ${cfg.hardLimits.bullet_min}–${cfg.hardLimits.bullet_max_count}`);
        }
      }

      // Cost estimate (Sonnet 4.6: $3/MTok input, $0.30/MTok cache-read, $15/MTok output)
      const inputTokens = resp.usage?.input_tokens ?? 0;
      const cachedTokens = resp.usage?.cache_read_input_tokens ?? 0;
      const outputTokens = resp.usage?.output_tokens ?? 0;
      const costUsd =
        ((inputTokens - cachedTokens) * 3 +
          cachedTokens * 0.3 +
          outputTokens * 15) /
        1_000_000;
      const costCents = Math.round(costUsd * 100 * 100) / 100;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                surface: params.surface,
                language: params.language,
                copy: parsed,
                raw_output: parsed ? undefined : raw,
                flags,
                violations,
                clean: flags.length === 0 && violations.length === 0,
                cost_cents: costCents,
                tokens: { input: inputTokens, cached: cachedTokens, output: outputTokens },
              },
              null,
              2
            ),
          },
        ],
      };
    })
  );
}
