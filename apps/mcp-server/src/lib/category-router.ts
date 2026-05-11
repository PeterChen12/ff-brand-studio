/**
 * Phase E · Iter 03 — route product.category → scene-library group.
 *
 * Today's PRODUCT_CATEGORIES enum (fishing-rod, drinkware, handbag,
 * watch, shoe, apparel, accessory, other) doesn't map cleanly to the
 * scene library's outdoor-fishing / kitchenware / fitness / etc. groups.
 * This router does the mapping with a static lookup for the known
 * categories and a heuristic keyword fallback for "other" + free-form
 * descriptions.
 *
 * No LLM call in v1 — keep this synchronous and cheap. If the keyword
 * fallback proves insufficient, the next iteration can chain a Haiku
 * classifier for the "other" path only.
 */
import type { SceneGroup } from "../pipeline/scene-library.js";

// Static map for the known PRODUCT_CATEGORIES values. NOTE: "other" is
// intentionally absent — it should fall through to the keyword fallback
// so a product like a fishing reel with category="other" + description
// containing "baitcasting reel" still routes to outdoor-fishing.
const CATEGORY_TO_GROUP: Record<string, SceneGroup> = {
  "fishing-rod": "outdoor-fishing",
  drinkware: "drinkware",
  handbag: "handbag",
  watch: "watch",
  shoe: "shoe",
  apparel: "apparel",
  accessory: "watch", // close enough — small surface, macro framing
};

// Lowercase keyword → group. Matched as substring against (category +
// description). First match wins; order matters for overlap (most
// specific groups first).
const KEYWORD_TO_GROUP: Array<[RegExp, SceneGroup]> = [
  [/\b(reel|fishing|tackle|lure|bait|rod|spinning|baitcaster)\b/i, "outdoor-fishing"],
  [/\b(camp|tent|backpack|hiking|outdoor|trail|hammock|cookset)\b/i, "outdoor-camping"],
  [/\b(yoga|dumbbell|kettlebell|gym|fitness|workout|treadmill)\b/i, "fitness"],
  [/\b(knife|pan|skillet|cutting board|cookware|kitchen|spatula|whisk|chef)\b/i, "kitchenware"],
  [/\b(mug|tumbler|bottle|kettle|teapot|cup|flask|glass)\b/i, "drinkware"],
  [/\b(handbag|tote|purse|clutch|backpack-fashion|crossbody)\b/i, "handbag"],
  [/\b(watch|timepiece|chronograph|smartwatch)\b/i, "watch"],
  [/\b(sneaker|loafer|boot|sandal|heel|shoe)\b/i, "shoe"],
  [/\b(shirt|hoodie|jacket|pants|jeans|sweater|tee|dress|apparel)\b/i, "apparel"],
];

/**
 * Maps a product's category (and optional description) onto a
 * scene-library group. Returns "default" when nothing else matches.
 */
export function routeToSceneGroup(
  category: string | null | undefined,
  description?: string | null
): SceneGroup {
  const cat = (category ?? "").trim();
  // 1. Exact match against the known enum.
  if (cat && CATEGORY_TO_GROUP[cat]) return CATEGORY_TO_GROUP[cat];

  // 2. Keyword fallback across (category + description).
  const haystack = `${cat} ${description ?? ""}`.trim();
  if (haystack) {
    for (const [pattern, group] of KEYWORD_TO_GROUP) {
      if (pattern.test(haystack)) return group;
    }
  }

  return "default";
}
