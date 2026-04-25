/**
 * v2 Phase 4 — US ad-content flagger.
 *
 * Pure-pattern classifier for Amazon ToS / FTC violations. Phase 4 follow-up
 * upgrades to a Sonnet 4.6 call with the same pattern list as the system
 * prompt for nuance (irony, context). Pattern-level matches catch ~90% of
 * the obvious cases at $0/call.
 */

export interface AdContentFlag {
  category: "amazon_tos" | "ftc" | "health" | "ai_disclosure";
  severity: "block" | "warn";
  matched: string;
  rule: string;
}

const AMAZON_TOS_BANNED: RegExp[] = [
  /\b(best|#1|number\s*one|top[\s-]rated|world's\s*finest|leading)\b/i,
  /\bguaranteed\b/i,
  /\bmoney[\s-]back\s+guarantee\b/i,
  /\b(eco[\s-]friendly|all[\s-]natural|chemical[\s-]free|non[\s-]toxic)\b/i,
  /\b(better than|outperforms)\b/i,
  /\breview\b/i,
];

const FTC_BANNED: RegExp[] = [
  /\bfeatured by\b/i,
  /\bas\s+seen\s+on\b/i,
  /\b(doctor|expert)\s+recommended\b/i,
  /\btestimonial\b/i,
];

const HEALTH_BANNED: RegExp[] = [
  /\b(cure|treat|heal|prevent|diagnose)\b/i,
  /\bFDA[\s-]approved\b/i,
  /\bclinically\s+proven\b/i,
  /\blose\s+\d+\s*(lbs|pounds|kg)\b/i,
];

function findFlags(
  text: string,
  patterns: RegExp[],
  category: AdContentFlag["category"],
  severity: AdContentFlag["severity"]
): AdContentFlag[] {
  const results: AdContentFlag[] = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      results.push({
        category,
        severity,
        matched: match[0],
        rule: pattern.source,
      });
    }
  }
  return results;
}

export function flagUsAdContent(text: string): AdContentFlag[] {
  return [
    ...findFlags(text, AMAZON_TOS_BANNED, "amazon_tos", "block"),
    ...findFlags(text, FTC_BANNED, "ftc", "warn"),
    ...findFlags(text, HEALTH_BANNED, "health", "block"),
  ];
}

/** Sonnet 4.6 system prompt for the upgraded LLM-based flagger (Phase 4 follow). */
export const US_AD_FLAGGER_SYSTEM_PROMPT = `You audit ecommerce copy for compliance with US ad rules. Flag any of:
- Amazon ToS: superlatives without proof, "guaranteed", competitor comparisons by name, review/testimonial references, "money-back guarantee" without backing policy.
- FTC Endorsement Guides: undisclosed material connections, fake testimonials, "as seen on", expert/doctor endorsements without substantiation.
- Health/supplement: drug claims (cure/treat/heal/prevent/diagnose), unapproved FDA references, weight-loss claims with specific amounts.
- AI-disclosure readiness: any AI-generated photo/video that depicts the product in a way that may be material — flag for EU AI Act Art. 50 (binding 2026-08).

Return JSON: { flags: [{ category, severity, matched_phrase, rule_description }] }. Empty array if clean.

Cost target: <$0.001 per call. Use prompt caching for this system prompt.`;
