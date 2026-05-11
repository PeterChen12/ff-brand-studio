/**
 * Phase F · Iter 04 — Compliance defect router.
 *
 * Classifies dual_judge rejection reasons into typed defect categories
 * and routes each to a specialist correction prompt. Beats the generic
 * "append reasons verbatim" regen pattern because each defect category
 * has its own targeted directive that the diffusion model responds to
 * better than the verbose reason text.
 *
 * Priority order matters when multiple defects classify — text first
 * (most embarrassing), then bg, then cropped, then color, then geometry.
 *
 * Pure functions; no I/O. Unit-testable.
 */

export type DefectCategory =
  | "text_in_image"
  | "bg_not_white"
  | "cropped_subject"
  | "wrong_color"
  | "melted_geometry"
  | "generic";

/** Priority-ordered match patterns. First match wins; ties go in the
 *  order declared here. Text first because hallucinated text is the
 *  most visually embarrassing failure mode. */
const DEFECT_PATTERNS: Array<[DefectCategory, RegExp]> = [
  ["text_in_image", /\b(text|watermark|logo|caption|character|label|scanline|garbled)\b/i],
  ["bg_not_white", /\b(?:background|bg)\b.*(?:not.*white|color banding|gradient seams|halo|seam)|\bhalo\b.*\b(?:pixels|masking|product)\b|\bcolor banding\b|\bgradient seams?\b/i],
  ["cropped_subject", /\b(cropped|cut off|out of frame|partial|missing.*end|chopped)\b/i],
  ["wrong_color", /(wrong.*color|recolor|color mismatch|hue.*off|tint)/i],
  ["melted_geometry", /\b(melted|warped|impossible|extra fingers|duplicated|smudged)\b/i],
];

/**
 * Classify a single reason string into a defect category. Returns
 * "generic" when no specific pattern matches.
 */
export function classifyReason(reason: string): DefectCategory {
  for (const [category, pattern] of DEFECT_PATTERNS) {
    if (pattern.test(reason)) return category;
  }
  return "generic";
}

/**
 * Classify a list of reasons. Returns the highest-priority category
 * found across all reasons. Used to pick the primary specialist
 * prompt; remaining reasons get appended for defense in depth.
 */
export function pickPrimaryDefect(reasons: string[]): DefectCategory {
  // The priority order is the declared order of DEFECT_PATTERNS.
  for (const [category, pattern] of DEFECT_PATTERNS) {
    if (reasons.some((r) => pattern.test(r))) return category;
  }
  return "generic";
}

/** Specialist prompt prefixes per defect category. */
const SPECIALIST_PROMPTS: Record<DefectCategory, string> = {
  text_in_image:
    "ABSOLUTE PRIORITY: previous attempt added text/watermarks/logos. " +
    "Generate this image with ZERO text, ZERO letters, ZERO numbers, " +
    "ZERO logos that weren't physically printed on the product. The only " +
    "text allowed is text physically present on the actual product as " +
    "shown in the reference image.",
  bg_not_white:
    "ABSOLUTE PRIORITY: previous attempt had a non-pure-white background. " +
    "Re-render with PURE WHITE seamless background (#FFFFFF) at every " +
    "pixel of the background. Zero color banding, zero gradient, zero " +
    "halo or seam around the product. The product itself stays identical " +
    "to the reference.",
  cropped_subject:
    "ABSOLUTE PRIORITY: previous attempt cropped part of the product. " +
    "Re-render with the FULL product visible end-to-end. Center the " +
    "product with generous frame fill (0.55-0.75 of frame); nothing cut " +
    "off at any edge.",
  wrong_color:
    "ABSOLUTE PRIORITY: previous attempt mis-colored the product. " +
    "Match the EXACT color of the reference image. Do not re-tint, " +
    "do not re-saturate, do not adjust hue. Keep every other detail " +
    "identical to the reference.",
  melted_geometry:
    "ABSOLUTE PRIORITY: previous attempt produced AI geometry artifacts. " +
    "Re-render with clean geometry — no duplicated parts, no warping, " +
    "no impossible reflections, no melted features. Hold the identity " +
    "of the reference exactly.",
  generic: "", // empty — falls back to existing reason-append behavior
};

/**
 * Build the corrected refine prompt for the next iteration. Prepends
 * the specialist directive (if any) to the base prompt; appends the
 * full reason list as defense-in-depth.
 */
export function buildSpecialistPrompt(
  basePrompt: string,
  reasons: string[]
): { prompt: string; category: DefectCategory } {
  const category = pickPrimaryDefect(reasons);
  const directive = SPECIALIST_PROMPTS[category];
  const reasonBlock = reasons.length
    ? "\nPrior attempt was rejected for these reasons — fix each:\n" +
      reasons.map((r) => `  - ${r}`).join("\n")
    : "";
  const prefix = directive ? `${directive}\n\n` : "";
  return { prompt: `${prefix}${basePrompt}${reasonBlock}`, category };
}
