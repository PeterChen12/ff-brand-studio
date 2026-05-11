/**
 * Phase E · Iter 03 — Scene library for category-aware lifestyle prompts.
 *
 * Today `pipeline/derivers/index.ts` hardcodes one lifestyle scene per
 * KindType. Fishing reels classify as `compact_square` and inherit
 * "marble surface with a coffee cup and a notebook" — visibly wrong
 * for an outdoor product.
 *
 * This module is the lookup matrix that replaces the per-kind constants
 * with a per-(scene-group, kind) array. The orchestrator picks the
 * scene-group from the product's category via `category-router.ts`,
 * then `pickScene(group, kind, seed)` deterministically returns one
 * scene from the matching array.
 *
 * Adding a new scene group: append an entry to SCENE_GROUPS. Adding
 * a new scene to an existing group: append to the kind's array.
 * Both are runtime-safe; no schema migration.
 */
import type { KindType } from "@ff/types";

export type SceneGroup =
  | "outdoor-fishing"
  | "outdoor-camping"
  | "kitchenware"
  | "drinkware"
  | "handbag"
  | "watch"
  | "shoe"
  | "apparel"
  | "fitness"
  | "default";

type SceneMatrix = Partial<Record<KindType, string[]>>;

/**
 * Each scene string ends with a period and avoids trailing prompts that
 * the deriver appends ("Identity must match the reference exactly. No
 * text overlays."). Keep scene strings to the SETTING only — no
 * product-name interpolation here; the deriver still wraps them.
 */
const SCENE_GROUPS: Record<SceneGroup, SceneMatrix> = {
  "outdoor-fishing": {
    compact_square: [
      "at the edge of a wooden dock at sunrise with calm lake water and faint morning mist behind.",
      "sitting on a flat rock at a rocky shoreline during golden hour, with shallow water visible.",
      "resting in an open tackle box on weathered planking, with neatly arranged lures around.",
    ],
    long_thin_vertical: [
      "held vertically against a forest-lake background at dawn, soft daylight.",
      "leaning against a wooden dock post with calm water behind and faint morning mist.",
    ],
    long_thin_horizontal: [
      "laid horizontally across a flat dockside table at sunrise with water in the soft background.",
    ],
  },
  "outdoor-camping": {
    compact_square: [
      "on a flat granite ledge at a mountain campsite during golden hour.",
      "resting on a moss-covered log at the edge of a pine forest under soft daylight.",
      "next to a small camp stove on packed earth with low daylight and a faint campfire glow.",
    ],
    multi_component: [
      "arranged on a wool blanket beside a campfire pit with cool blue twilight.",
    ],
  },
  kitchenware: {
    compact_square: [
      "on a clean butcher-block kitchen counter with natural daylight from a side window.",
      "on a marble countertop next to fresh herbs and a wooden cutting board.",
    ],
    multi_component: [
      "laid out on a slate serving board with overhead daylight, no food yet plated.",
    ],
  },
  drinkware: {
    compact_square: [
      "on a wooden café table next to an open notebook, soft daylight from a window.",
      "on a stone tabletop outdoors in dappled morning light with greenery behind.",
    ],
    compact_round: [
      "on a wool felt coaster on a desk, soft window light, no other branded items.",
    ],
  },
  handbag: {
    compact_square: [
      "on a marble surface with a coffee cup and a notebook in soft window light.",
      "resting on the seat of an upholstered chair in a brightly lit entryway.",
      "on a wooden bench next to a folded scarf in early-evening daylight.",
    ],
  },
  watch: {
    compact_square: [
      "on a textured leather mat with soft directional light and a faint shadow.",
      "on a dark walnut surface with macro-style diffuse light from the right.",
    ],
    accessory_small: [
      "on a soft fabric pad with diffuse overhead light, macro framing.",
    ],
  },
  shoe: {
    compact_square: [
      "on a polished concrete floor with a slim shadow, soft warm overhead light.",
      "on a wooden gym floor next to a folded towel, daylight.",
    ],
    apparel_flat: [
      "flat-laid on a clean white textile background with even overhead light.",
    ],
  },
  apparel: {
    apparel_flat: [
      "flat-laid on a clean fabric surface with even daylight, no creases.",
      "draped across a wooden hanger against a soft neutral wall in window light.",
    ],
  },
  fitness: {
    compact_square: [
      "on a rubberized gym floor with a folded towel and water bottle nearby, daylight.",
      "on a wooden bench in a daylit home-gym corner, plants softly out of focus.",
    ],
    long_thin_horizontal: [
      "laid across a yoga mat on a hardwood floor with morning daylight.",
    ],
  },
  default: {
    compact_square: [
      "on a clean studio surface with soft daylight and no other branded items.",
    ],
    compact_round: [
      "on a soft fabric surface with diffuse daylight, macro framing.",
    ],
    long_thin_vertical: [
      "in a clean studio setting with neutral background and daylight.",
    ],
    long_thin_horizontal: [
      "laid horizontally on a clean studio surface with even daylight.",
    ],
    horizontal_thin: [
      "on a neutral studio surface with even daylight, no props.",
    ],
    multi_component: [
      "arranged together on a clean neutral surface with daylight.",
    ],
    apparel_flat: [
      "flat-laid on a clean fabric surface with even daylight.",
    ],
    accessory_small: [
      "on a soft fabric pad with diffuse overhead light, macro framing.",
    ],
  },
};

import { hashSeed } from "../lib/hash-seed.js";

/**
 * Return one scene string for (group, kind), picked deterministically
 * from the seed. Falls back through: requested kind → default group's
 * matching kind → default group's compact_square → a hard fallback.
 */
export function pickScene(
  group: SceneGroup,
  kind: KindType,
  seed: string
): string {
  const candidates =
    SCENE_GROUPS[group]?.[kind] ??
    SCENE_GROUPS.default[kind] ??
    SCENE_GROUPS.default.compact_square ??
    ["in a clean studio setting with daylight."];
  const idx = hashSeed(seed) % candidates.length;
  return candidates[idx];
}

/** Exposed for tests; do not import from app code. */
export const __SCENE_GROUPS_FOR_TEST = SCENE_GROUPS;
