/**
 * Phase F · Iter 01 — Deterministic 32-bit djb2 hash for seeding.
 *
 * Was duplicated as a private helper in pipeline/scene-library.ts and
 * pipeline/prompt-variation.ts (both from phase-e/03). Dedup'd here so
 * any future deterministic-seeding work uses one implementation.
 *
 * Returns a non-negative integer derived from the input string. Same
 * input → same output. Not cryptographically secure; suitable only for
 * deterministic-but-arbitrary picks (e.g. choosing one of N scenes
 * per (productId, slotIndex)).
 */
export function hashSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
