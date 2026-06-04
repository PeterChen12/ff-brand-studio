/**
 * Phase 1 P1.1 / P1.2 — tenant brand profile resolver + prompt formatter.
 *
 * Pre-fix, the brand guardian + hero image + infographic + video prompts
 * all hardcoded Faraday Future brand standards (palette #1C3FAA / etc,
 * "Maison Neue + Source Han Sans SC", "investor-grade" tone, no
 * exclamation marks). This made FF Studio unable to serve any other
 * brand without forking — see audit finding A3.
 *
 * The new `tenants.brand_profile` JSONB column (migration 0027) holds
 * the customizable shape. This module:
 *   - Defines the TypeScript shape
 *   - Provides FF as the hardcoded fallback (only used when
 *     brand_profile IS NULL — see below for the rationale)
 *   - Renders the profile into prompt-ready text via `formatProfileForGuardian`
 *     and `formatProfileForImagePrompt`
 *
 * Decision P1-A (recommend in BFR_ECOSYSTEM_PLAN.md): the fallback is
 * intentionally the FF profile. A non-FF tenant without a defined
 * profile will get FF-flavored outputs — this is a *deliberate* signal
 * to the operator that the tenant hasn't been onboarded yet (catches
 * unmigrated tenants in guardian output rather than silently failing).
 *
 * To onboard a new tenant: insert a brand_profile via PATCH
 * /v1/tenant or POST /v1/tenants/me/brand-profile (Phase 1 P1.7 UI).
 */

export interface BrandProfile {
  name: string;
  palette: {
    primary: BrandColor;
    secondary?: BrandColor;
    accent?: BrandColor;
    neutrals?: BrandColor[];
  };
  typography: {
    heading: TypographyFamily;
    body: TypographyFamily;
  };
  logo_rules: {
    min_height_px: number;
    clear_space_px: number;
    wordmark_text?: string;
    do_not?: string[];
  };
  tone: {
    descriptors: string[];
    forbidden: string[];
    punctuation?: { exclamations_allowed?: boolean };
  };
  guardian_weights: {
    color: number;
    typography: number;
    logo: number;
    image_quality: number;
    copy_tone: number;
  };
  pass_threshold: number;
  sample_assets?: Array<{ kind: string; r2_url: string }>;
}

export interface BrandColor {
  name: string;
  hex: string;
}

export interface TypographyFamily {
  family: string;
  weights?: number[];
}

// Default profile — what the system used to hardcode. Kept here so a
// tenant without a profile (legacy or seed) gets identical outputs to
// pre-refactor behavior. New tenants should override.
export const FF_DEFAULT_PROFILE: BrandProfile = {
  name: "Faraday Future",
  palette: {
    primary: { name: "Brand Navy", hex: "#1C3FAA" },
    secondary: { name: "Electric", hex: "#00A8E8" },
    accent: { name: "Gold", hex: "#C9A84C" },
    neutrals: [{ name: "Carbon", hex: "#0A0A0A" }],
  },
  typography: {
    heading: { family: "Maison Neue", weights: [400, 600, 700] },
    body: { family: "Source Han Sans SC", weights: [400, 500] },
  },
  logo_rules: {
    min_height_px: 80,
    clear_space_px: 24,
    wordmark_text: "FARADAY FUTURE",
    do_not: ["stretch", "recolor outside palette", "place on busy bg"],
  },
  tone: {
    descriptors: ["aspirational", "investor-grade", "premium", "future-forward"],
    forbidden: ["cheap", "affordable", "budget", "discount", "deal", "sale", "low cost", "inexpensive"],
    punctuation: { exclamations_allowed: false },
  },
  guardian_weights: {
    color: 0.2,
    typography: 0.2,
    logo: 0.15,
    image_quality: 0.25,
    copy_tone: 0.2,
  },
  pass_threshold: 70,
  sample_assets: [],
};

/**
 * Coerce a `tenants.brand_profile` JSONB blob into a typed profile.
 * Returns the FF default when input is null/undefined/malformed —
 * malformed means "log + use default" rather than throwing because we
 * never want a bad brand_profile to take down a tenant's launch.
 */
export function resolveBrandProfile(raw: unknown): BrandProfile {
  if (!raw || typeof raw !== "object") return FF_DEFAULT_PROFILE;
  const r = raw as Partial<BrandProfile>;
  // Minimum viable validation: must have name + palette.primary. We
  // intentionally don't enforce every field — partial overrides are
  // OK (e.g. only customize tone, inherit palette).
  if (typeof r.name !== "string") return FF_DEFAULT_PROFILE;
  if (!r.palette || typeof (r.palette as { primary?: BrandColor }).primary?.hex !== "string") {
    return FF_DEFAULT_PROFILE;
  }
  return {
    name: r.name,
    palette: { ...FF_DEFAULT_PROFILE.palette, ...r.palette },
    typography: { ...FF_DEFAULT_PROFILE.typography, ...(r.typography ?? {}) },
    logo_rules: { ...FF_DEFAULT_PROFILE.logo_rules, ...(r.logo_rules ?? {}) },
    tone: { ...FF_DEFAULT_PROFILE.tone, ...(r.tone ?? {}) },
    guardian_weights: { ...FF_DEFAULT_PROFILE.guardian_weights, ...(r.guardian_weights ?? {}) },
    pass_threshold: typeof r.pass_threshold === "number" ? r.pass_threshold : FF_DEFAULT_PROFILE.pass_threshold,
    sample_assets: r.sample_assets ?? [],
  };
}

/**
 * Render the profile into the system-prompt section a guardian Claude
 * call expects. Replaces the prior hardcoded GUARDIAN_SYSTEM string.
 */
export function formatProfileForGuardian(profile: BrandProfile): string {
  const palette = [
    profile.palette.primary && `Primary: ${profile.palette.primary.name} ${profile.palette.primary.hex}`,
    profile.palette.secondary && `Secondary: ${profile.palette.secondary.name} ${profile.palette.secondary.hex}`,
    profile.palette.accent && `Accent: ${profile.palette.accent.name} ${profile.palette.accent.hex}`,
    ...(profile.palette.neutrals ?? []).map((n) => `Neutral: ${n.name} ${n.hex}`),
  ]
    .filter(Boolean)
    .join(" | ");

  const headingWeights = profile.typography.heading.weights?.join(", ") ?? "any";
  const bodyWeights = profile.typography.body.weights?.join(", ") ?? "any";
  const tone = profile.tone.descriptors.join(", ");
  const forbidden = profile.tone.forbidden.join(", ");
  const exclam = profile.tone.punctuation?.exclamations_allowed === false
    ? "NO exclamation marks."
    : "Exclamation marks allowed in moderation.";

  const w = profile.guardian_weights;
  const weightsPct = `color ${Math.round(w.color * 100)}%, typography ${Math.round(w.typography * 100)}%, logo ${Math.round(w.logo * 100)}%, image quality ${Math.round(w.image_quality * 100)}%, copy tone ${Math.round(w.copy_tone * 100)}%`;

  return [
    `You are the ${profile.name} Brand Guardian — an expert visual compliance reviewer trained on ${profile.name} brand guidelines.`,
    ``,
    `BRAND STANDARDS:`,
    `- Palette: ${palette}`,
    `- Typography: ${profile.typography.heading.family} (headings, weights ${headingWeights}), ${profile.typography.body.family} (body, weights ${bodyWeights})`,
    `- Logo: min ${profile.logo_rules.min_height_px}px tall, ${profile.logo_rules.clear_space_px}px clear space${profile.logo_rules.wordmark_text ? `, wordmark "${profile.logo_rules.wordmark_text}"` : ""}${profile.logo_rules.do_not?.length ? `; do not: ${profile.logo_rules.do_not.join(", ")}` : ""}`,
    `- Imagery: studio-grade or cinematic quality. No blur, compression artifacts, amateur lighting, or stock-photo feel.`,
    `- Copy tone: ${tone}. ${exclam} NEVER use: ${forbidden}.`,
    `- Scoring weights: ${weightsPct}.`,
    `- Pass threshold: ${profile.pass_threshold}/100. Critical violations cap score at 40.`,
    ``,
    `You will receive an asset (image URL or copy text) and must return a JSON scorecard ONLY — no prose, no markdown, pure JSON.`,
  ].join("\n");
}

/**
 * Compact one-line brand context for image / video / infographic
 * generation prompts. Image models perform best with terse, comma-
 * separated descriptors rather than full sentences.
 */
export function formatProfileForImagePrompt(profile: BrandProfile): string {
  const palette = [
    profile.palette.primary?.hex,
    profile.palette.secondary?.hex,
    profile.palette.accent?.hex,
  ].filter(Boolean) as string[];
  const fonts = `${profile.typography.heading.family}/${profile.typography.body.family}`;
  const tone = profile.tone.descriptors.slice(0, 3).join(", ");
  return `${profile.name} brand. Palette: ${palette.join(", ")}. Fonts: ${fonts}. Tone: ${tone}.`;
}

/**
 * Wordmark / brand name string for prompts that need it (infographics,
 * video, "include logo" hero variants).
 */
export function brandWordmark(profile: BrandProfile): string {
  return profile.logo_rules.wordmark_text ?? profile.name.toUpperCase();
}
