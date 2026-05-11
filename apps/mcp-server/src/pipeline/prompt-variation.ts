/**
 * Phase E · Iter 03 — Per-slot stylistic variation.
 *
 * Even with a scene library, every lifestyle slot for the same kind
 * + group lands on the same scene string. Layering a lighting +
 * angle + depth variant on top gives within-product diversity AND
 * across-product diversity (different productIds hash to different
 * variant combinations).
 *
 * Pure deterministic — no Math.random. Same (seed, slotIndex) →
 * same output. This is what keeps QA reproducible.
 */

const LIGHTING = [
  "soft daylight",
  "golden hour warm light",
  "overcast diffuse light",
  "early-morning low light",
];

const ANGLES = [
  "three-quarter view",
  "straight-on front view",
  "slight top-down angle",
  "low eye-level angle",
];

const DEPTH = [
  "shallow depth of field with the product crisp",
  "everything in sharp focus",
  "subtle background blur",
];

function hashSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export interface VariationModifiers {
  lighting: string;
  angle: string;
  depth: string;
}

export function pickVariation(seed: string, slotIndex = 0): VariationModifiers {
  const h = hashSeed(`${seed}#${slotIndex}`);
  return {
    lighting: LIGHTING[h % LIGHTING.length],
    angle: ANGLES[(h >> 4) % ANGLES.length],
    depth: DEPTH[(h >> 8) % DEPTH.length],
  };
}

/**
 * Compose the final lifestyle prompt. The scene describes WHERE the
 * product sits; the variation describes HOW it's photographed.
 */
export function composeLifestylePrompt(args: {
  productName: string;
  scene: string;
  variation: VariationModifiers;
}): string {
  const { productName, scene, variation } = args;
  return `
The ${productName} ${scene}
${variation.lighting}, ${variation.angle}, ${variation.depth}.
No other branded products visible. Identity must match the reference
exactly. No text, no overlays, no on-screen labels.
`.trim();
}
