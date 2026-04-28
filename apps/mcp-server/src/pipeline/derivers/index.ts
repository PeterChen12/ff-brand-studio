/**
 * Phase I — Kind-aware Derivers.
 *
 * One Deriver per Kind. Each carries:
 *  - paddingPct: how tight the canonical studio crop sits in 1:1 frame
 *  - clipThreshold: per-kind override; default 0.78 per ADR-0003
 *  - keyFeatures: identity-defining attributes the refine prompt must preserve
 *  - negativePrompts: things the model commonly hallucinates that we ban
 *  - refinePrompt(args): emits the dual-reference prompt for FAL
 *  - visionChecklist: one yes/no question per item; vision adjudicator returns details
 *  - lifestylePrompt(args): kind-specific lifestyle prompt for I5.4
 *
 * All prompts follow the production rule (lykan_upload's notes): be
 * geometry-specific, never use vague styling words like "premium" or
 * "luxury". Specifics > vibes.
 */

import type { KindType } from "@ff/types";

export interface RefinePromptArgs {
  productName: string;
  productNameZh?: string | null;
  category: string;
  brandHex?: string;
}

export interface LifestylePromptArgs extends RefinePromptArgs {}

export interface Deriver {
  kind: KindType;
  paddingPct: number;
  clipThreshold: number;
  keyFeatures: string[];
  negativePrompts: string[];
  refinePrompt(args: RefinePromptArgs): string;
  visionChecklist: string[];
  lifestylePrompt(args: LifestylePromptArgs): string;
}

const COMMON_NEGATIVES = [
  "no text",
  "no logos",
  "no watermarks",
  "no dimension labels",
  "no shadows on background",
  "no gradients on background",
  "no AI artifacts",
  "no halo around the product",
];

function bannedBlock(extras: string[]): string {
  return ["ABSOLUTELY NO:", ...COMMON_NEGATIVES, ...extras].map(s =>
    s.startsWith("ABSOLUTELY") ? s : `  - ${s}`
  ).join("\n");
}

const longThinVertical: Deriver = {
  kind: "long_thin_vertical",
  paddingPct: 94,
  clipThreshold: 0.78,
  keyFeatures: [
    "exact rod diameter taper from butt to tip",
    "guide ring spacing and count",
    "reel seat hardware shape and color",
    "grip material texture (cork / EVA pattern)",
    "rod section count visible at the joints",
  ],
  negativePrompts: [
    "do not bend or curve the rod",
    "do not add a fish or angler",
    "do not change rod color or pattern",
  ],
  refinePrompt: ({ productName, category }) => `
Studio product photograph of ${productName} (${category}).
Match the framing of the second reference (the crop oracle).
Match the identity of the first reference (the studio source).
Key features to preserve exactly:
  - exact rod diameter taper from butt to tip
  - guide ring spacing and count
  - reel seat hardware shape and color
  - grip material texture (cork or EVA pattern)
  - rod section count visible at the joints
Pure white seamless background (#FFFFFF). Product centered, vertical orientation.
${bannedBlock([
  "do not bend or curve the rod",
  "do not add a fish or an angler",
  "do not re-color the rod or grip",
])}
`.trim(),
  visionChecklist: [
    "Does the rod's identity match the studio reference (color, pattern, finish)?",
    "Is the guide ring count and spacing the same as the reference?",
    "Is the reel seat hardware shape unchanged?",
    "Is the rod centered on a true white background with no halo?",
    "Is there NO text, logo, watermark, or dimension label visible?",
  ],
  lifestylePrompt: ({ productName }) => `
The ${productName} held by an angler at sunrise on a quiet lake.
Soft natural light, calm water, distant tree line.
The rod identity must match the reference image exactly.
No text, no overlays, no on-screen labels, no other branded products.
`.trim(),
};

const longThinHorizontal: Deriver = {
  kind: "long_thin_horizontal",
  paddingPct: 94,
  clipThreshold: 0.78,
  keyFeatures: [
    "complete length visible end to end",
    "any tip or handle hardware preserved",
    "surface finish and graphics unchanged",
  ],
  negativePrompts: ["do not foreshorten the length", "do not add accessory items"],
  refinePrompt: ({ productName, category }) => `
Studio product photograph of ${productName} (${category}).
Match the framing of the second reference (the crop oracle).
Match the identity of the first reference (the studio source).
Key features to preserve exactly:
  - complete length visible end to end
  - any tip or handle hardware
  - surface finish, graphics, and color exactly as in the reference
Pure white seamless background (#FFFFFF). Product centered, horizontal orientation.
${bannedBlock([
  "do not foreshorten the length",
  "do not add accessory items or staging props",
])}
`.trim(),
  visionChecklist: [
    "Is the full length visible without foreshortening?",
    "Do hardware (tips, handles) match the reference?",
    "Is the surface graphic unchanged?",
    "Is the background a true uniform white?",
    "Is there NO text, logo, watermark, or label?",
  ],
  lifestylePrompt: ({ productName }) => `
The ${productName} in active use in a clean outdoor setting.
Soft daylight, no other branded products visible.
Identity must match the reference exactly. No text overlays.
`.trim(),
};

const compactSquare: Deriver = {
  kind: "compact_square",
  paddingPct: 92,
  clipThreshold: 0.78,
  keyFeatures: [
    "hardware metal color and shape",
    "stitch pattern visible on the seams",
    "leather or fabric grain texture",
    "strap/handle attachment points",
    "logo or monogram pattern (if present in reference)",
  ],
  negativePrompts: [
    "do not re-shape the silhouette",
    "do not invent logos or monograms not in the reference",
    "do not re-color the leather or fabric",
  ],
  refinePrompt: ({ productName, category }) => `
Studio product photograph of ${productName} (${category}).
Match the framing of the second reference (the crop oracle).
Match the identity of the first reference (the studio source).
Key features to preserve exactly:
  - hardware metal color and shape
  - stitch pattern visible on the seams
  - leather or fabric grain texture
  - strap or handle attachment hardware
  - logo or monogram pattern only as shown in the reference
Pure white seamless background (#FFFFFF). Product centered, even fill of the frame.
${bannedBlock([
  "do not re-shape the silhouette",
  "do not invent logos, monograms, or charms not present in the reference",
  "do not re-color the leather or fabric",
])}
`.trim(),
  visionChecklist: [
    "Does the silhouette match the reference (handle shape, body shape)?",
    "Is the hardware (zippers, clasps, rings) metal color the same as the reference?",
    "Are the stitch patterns and seams unchanged?",
    "Is the leather/fabric grain texture preserved?",
    "Are NO new logos or monograms invented?",
    "Is the background a uniform true white with no shadow halo?",
  ],
  lifestylePrompt: ({ productName }) => `
The ${productName} styled on a marble surface with a coffee cup and a notebook.
Daylight from a window, no harsh shadows. No text, no overlays.
The product identity must match the reference image exactly.
`.trim(),
};

const compactRound: Deriver = {
  kind: "compact_round",
  paddingPct: 92,
  clipThreshold: 0.78,
  keyFeatures: [
    "circumference and crown shape",
    "brim curvature (if hat) or rim profile",
    "embroidery, patches, or weave pattern",
    "color uniformity around the round",
  ],
  negativePrompts: ["do not re-shape the crown", "do not invent embroidery"],
  refinePrompt: ({ productName, category }) => `
Studio product photograph of ${productName} (${category}).
Match the framing of the second reference (the crop oracle).
Match the identity of the first reference (the studio source).
Key features to preserve exactly:
  - circumference and crown shape
  - brim curvature or rim profile
  - embroidery, patches, or weave pattern as in reference
  - color uniformity all the way around
Pure white seamless background (#FFFFFF). Product centered.
${bannedBlock([
  "do not re-shape the crown or brim",
  "do not invent embroidery or patches",
  "do not re-color the cap",
])}
`.trim(),
  visionChecklist: [
    "Does the crown shape match the reference?",
    "Is the brim curvature unchanged?",
    "Are the embroidery and patches identical to the reference?",
    "Is the color uniform around the cap?",
    "Background true white, no halo?",
  ],
  lifestylePrompt: ({ productName }) => `
The ${productName} resting on a wooden table next to a casual outfit.
Daylight, natural setting, no other branded items. No text overlays.
`.trim(),
};

const horizontalThin: Deriver = {
  kind: "horizontal_thin",
  paddingPct: 94,
  clipThreshold: 0.78,
  keyFeatures: [
    "left-to-right proportions",
    "any visible attachment points or hardware",
    "surface graphic continuity",
  ],
  negativePrompts: ["do not crop the ends", "do not change orientation"],
  refinePrompt: ({ productName, category }) => `
Studio product photograph of ${productName} (${category}).
Match the framing of the second reference (the crop oracle).
Match the identity of the first reference (the studio source).
Key features to preserve exactly:
  - left-to-right proportions
  - any visible attachment points or hardware
  - surface graphic continuity end to end
Pure white seamless background (#FFFFFF). Horizontal orientation, centered.
${bannedBlock([
  "do not crop the ends",
  "do not change orientation",
  "do not invent decorative elements",
])}
`.trim(),
  visionChecklist: [
    "Are both ends fully visible without cropping?",
    "Are hardware and attachment points unchanged?",
    "Is the surface graphic continuous from end to end?",
    "Background true white?",
    "No text or logos added?",
  ],
  lifestylePrompt: ({ productName }) => `
The ${productName} in use in a clean outdoor or studio setting.
Natural daylight, no other branded items. Identity matches reference exactly.
No text overlays.
`.trim(),
};

const multiComponent: Deriver = {
  kind: "multi_component",
  paddingPct: 92,
  clipThreshold: 0.76, // slightly lower — multi-piece sets have more layout variance
  keyFeatures: [
    "all components visible in the frame",
    "relative size of components preserved",
    "color and material of each component matches reference",
  ],
  negativePrompts: [
    "do not omit any component",
    "do not invent additional components",
    "do not stack components in a way the reference does not show",
  ],
  refinePrompt: ({ productName, category }) => `
Studio product photograph of a multi-component ${productName} (${category}) set.
Match the framing of the second reference (the crop oracle).
Match the identity of the first reference (the studio source).
Key features to preserve exactly:
  - all components from the reference are visible in the frame
  - relative size of components is preserved
  - color and material of each component matches the reference
Pure white seamless background (#FFFFFF). Components arranged as in the reference.
${bannedBlock([
  "do not omit any component shown in the reference",
  "do not invent additional components",
  "do not re-stack components in arrangements not present in the reference",
])}
`.trim(),
  visionChecklist: [
    "Are all components from the reference present in the generated image?",
    "Is the relative size of components correct?",
    "Are colors and materials of every component preserved?",
    "Is the arrangement plausible vs the reference?",
    "Background true white?",
  ],
  lifestylePrompt: ({ productName }) => `
The ${productName} set arranged in a tabletop scene with natural daylight.
All components from the reference visible. No text, no other brands.
`.trim(),
};

const apparelFlat: Deriver = {
  kind: "apparel_flat",
  paddingPct: 92,
  clipThreshold: 0.78,
  keyFeatures: [
    "neckline shape (crew, V, scoop)",
    "sleeve length and cuff style",
    "graphic placement and exact dimensions on the chest",
    "fabric weave or knit pattern visible at the seams",
    "color exactness — no tonal drift",
  ],
  negativePrompts: [
    "do not change the neckline style",
    "do not change sleeve length",
    "do not invent or move the chest graphic",
  ],
  refinePrompt: ({ productName, category }) => `
Studio flat-lay photograph of ${productName} (${category}).
Match the framing of the second reference (the crop oracle).
Match the identity of the first reference (the studio source).
Key features to preserve exactly:
  - neckline shape (crew, V, scoop, etc.)
  - sleeve length and cuff style
  - graphic placement and dimensions on the chest exactly as in reference
  - fabric weave or knit pattern at the seams
  - color exactness, no tonal drift
Pure white seamless background (#FFFFFF). Flat lay, garment laid open with arms extended.
${bannedBlock([
  "do not change the neckline style",
  "do not change sleeve length or cuff style",
  "do not move, recolor, or re-letter any chest graphic",
  "do not add wrinkles not present in the reference",
])}
`.trim(),
  visionChecklist: [
    "Is the neckline style identical to the reference?",
    "Are the sleeves the same length and cuff as the reference?",
    "Is the chest graphic placed and sized exactly as in the reference?",
    "Is the fabric weave / knit visible at the seams?",
    "Is the garment color a true match (no tonal drift)?",
    "Background uniform white, no shadow halo?",
  ],
  lifestylePrompt: ({ productName }) => `
The ${productName} worn by a model in a clean studio environment.
Natural daylight, neutral background, no other branded items visible.
The garment identity (neckline, sleeves, graphic) must match the reference exactly.
No text, no overlays.
`.trim(),
};

const accessorySmall: Deriver = {
  kind: "accessory_small",
  paddingPct: 90,
  clipThreshold: 0.78,
  keyFeatures: [
    "metal color and finish (gold, silver, rose, gunmetal)",
    "stone color, cut, and setting style (if present)",
    "engraving or pattern detail on visible surfaces",
    "clasp or fastening type",
  ],
  negativePrompts: [
    "do not invent stones, engravings, or charms",
    "do not change metal finish",
  ],
  refinePrompt: ({ productName, category }) => `
Studio macro photograph of ${productName} (${category}).
Match the framing of the second reference (the crop oracle).
Match the identity of the first reference (the studio source).
Key features to preserve exactly:
  - metal color and finish (gold, silver, rose, gunmetal — match the reference)
  - any stone color, cut, and setting style as in the reference
  - engraving or pattern detail on visible surfaces
  - clasp or fastening type
Pure white seamless background (#FFFFFF). Centered with even fill, sharp focus.
${bannedBlock([
  "do not invent stones, engravings, or charms",
  "do not change metal finish or color",
  "do not add reflections that obscure detail",
])}
`.trim(),
  visionChecklist: [
    "Does the metal color and finish match the reference?",
    "Are stones (color, cut, setting) preserved exactly?",
    "Are engravings or patterns reproduced as in the reference?",
    "Is the clasp or fastening identical?",
    "Background true white?",
  ],
  lifestylePrompt: ({ productName }) => `
The ${productName} resting on a soft fabric surface with diffuse daylight.
Macro framing. No text, no on-screen labels, no other products.
Identity matches the reference exactly.
`.trim(),
};

export const DERIVERS: Record<KindType, Deriver> = {
  long_thin_vertical: longThinVertical,
  long_thin_horizontal: longThinHorizontal,
  compact_square: compactSquare,
  compact_round: compactRound,
  horizontal_thin: horizontalThin,
  multi_component: multiComponent,
  apparel_flat: apparelFlat,
  accessory_small: accessorySmall,
};

export function getDeriver(kind: KindType): Deriver {
  return DERIVERS[kind] ?? DERIVERS.compact_square;
}
