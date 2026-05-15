/**
 * Phase F · Iter 03 — Best-of-input passthrough scoring.
 *
 * When an operator's source reference is already publish-ready (clean
 * white background, generous product fill, ≥2000px on the longest side),
 * the refine pipeline produces a near-duplicate at $0.50 in spend.
 * Skipping that round-trip and writing the reference R2 URL directly
 * as the asset saves the wallet without quality loss.
 *
 * This module exposes pure scoring helpers + the threshold contract.
 * The actual passthrough wiring lives in pipeline/index.ts and is
 * gated by runQualityGate (F1's abstraction). F3 is the first new
 * consumer of that abstraction — proves the API shape with a real
 * caller.
 *
 * Threshold tuning is one-line constant change; no architecture
 * impact if a tenant reports false-passthroughs.
 */
import sharp from "sharp";

/** Pin-#3 strict typing — everything the threshold check needs. */
export interface ReferenceQualityMetrics {
  /** Longest side in pixels (max of width / height). */
  longestSide: number;
  /** Fraction of canvas the product bounding box fills, 0-1. */
  fillRatio: number;
  /** Estimate of "background is white" — fraction of corner pixels that
   *  pass the non-white test, inverted to a 0-1 cleanliness score. */
  whiteness: number;
}

/** Threshold constants — tuned conservatively. If a tenant's clean
 *  studio shots are missing this gate, expand the windows here. */
export const PASSTHROUGH_FILL_MIN = 0.55;
export const PASSTHROUGH_FILL_MAX = 0.78;
export const PASSTHROUGH_WHITENESS_MIN = 0.92;
export const PASSTHROUGH_LONGEST_SIDE_MIN = 2000;

// Phase G · G05 — fail-fast thresholds. References worse than this can't
// produce a usable launch even after refine, so we abort the pipeline
// upfront instead of spending $0.30 to confirm it. Distinct from the
// passthrough thresholds above — those say "good enough to skip cleanup",
// these say "too broken to even try".
export const ABORT_LONGEST_SIDE_MIN = 600;
export const ABORT_FILL_MIN = 0.05;
export const ABORT_WHITENESS_MIN = 0.25;

export function isPublishReadyReference(m: ReferenceQualityMetrics): boolean {
  return (
    m.longestSide >= PASSTHROUGH_LONGEST_SIDE_MIN &&
    m.fillRatio >= PASSTHROUGH_FILL_MIN &&
    m.fillRatio <= PASSTHROUGH_FILL_MAX &&
    m.whiteness >= PASSTHROUGH_WHITENESS_MIN
  );
}

/**
 * Phase G · G05 — true when the reference is so degraded that running
 * the pipeline would burn wallet for nothing. Returns the human-readable
 * reasons alongside so the audit row + error payload can explain.
 */
export function isAbortQuality(m: ReferenceQualityMetrics): {
  abort: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (m.longestSide < ABORT_LONGEST_SIDE_MIN) {
    reasons.push(
      `image too small (${m.longestSide}px < ${ABORT_LONGEST_SIDE_MIN}px). Re-upload at higher resolution.`
    );
  }
  if (m.fillRatio < ABORT_FILL_MIN) {
    reasons.push(
      `no detectable product (fill ${m.fillRatio.toFixed(2)} < ${ABORT_FILL_MIN}). Make sure the photo actually shows the product.`
    );
  }
  if (m.whiteness < ABORT_WHITENESS_MIN) {
    reasons.push(
      `background is heavily non-white (whiteness ${m.whiteness.toFixed(2)} < ${ABORT_WHITENESS_MIN}). Cleanup model can't recover this — provide a cleaner studio shot.`
    );
  }
  return { abort: reasons.length > 0, reasons };
}

/** Human-readable failure reasons; format matches the iterate.ts /
 *  grounding loop reason-strings so audit notes stay consistent. */
export function failureReasons(m: ReferenceQualityMetrics): string[] {
  const reasons: string[] = [];
  if (m.longestSide < PASSTHROUGH_LONGEST_SIDE_MIN) {
    reasons.push(`resolution too low (${m.longestSide}px < ${PASSTHROUGH_LONGEST_SIDE_MIN}px)`);
  }
  if (m.fillRatio < PASSTHROUGH_FILL_MIN) {
    reasons.push(`product fill too low (${m.fillRatio.toFixed(2)} < ${PASSTHROUGH_FILL_MIN})`);
  } else if (m.fillRatio > PASSTHROUGH_FILL_MAX) {
    reasons.push(`product fill too high (${m.fillRatio.toFixed(2)} > ${PASSTHROUGH_FILL_MAX})`);
  }
  if (m.whiteness < PASSTHROUGH_WHITENESS_MIN) {
    reasons.push(`background not white enough (${m.whiteness.toFixed(2)} < ${PASSTHROUGH_WHITENESS_MIN})`);
  }
  return reasons;
}

/**
 * Slot allowlist — only white-bg / main-hero slots support passthrough
 * since they're the only ones where the deliverable is "a clean product
 * shot on white". Lifestyle, banner, composite slots always generate.
 */
const PASSTHROUGH_ALLOWED_SLOTS = new Set(["studio", "refine_studio", "amazon-main", "shopify-main"]);

export function passthroughAllowedForSlot(slot: string): boolean {
  return PASSTHROUGH_ALLOWED_SLOTS.has(slot);
}

/**
 * Score a reference image buffer via sharp. Returns metrics suitable
 * for `isPublishReadyReference`. ~50ms on a 3000×3000 buffer; reads
 * pixels once via the existing measureProductFill helper.
 *
 * Corner-whiteness is approximated by sampling the four corner regions
 * (each 5% of canvas width) and counting near-white pixels. This is
 * cheap and stable; a proper saliency model is a future iteration.
 */
export async function scoreReference(
  imageBuffer: Buffer,
  cornerSizePct: number = 5
): Promise<ReferenceQualityMetrics> {
  const meta = await sharp(imageBuffer).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const longestSide = Math.max(W, H);

  // Reuse the existing pixel walk to get bbox; gives us fillRatio.
  const { data, info } = await sharp(imageBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const cw = info.width;
  const ch = info.height;
  const cornerPx = Math.max(1, Math.floor(Math.min(cw, ch) * (cornerSizePct / 100)));

  let nonWhiteX_min = cw;
  let nonWhiteX_max = -1;
  let nonWhiteY_min = ch;
  let nonWhiteY_max = -1;
  let cornerWhitePx = 0;
  let cornerTotalPx = 0;

  for (let y = 0; y < ch; y++) {
    const inTopCorner = y < cornerPx;
    const inBotCorner = y >= ch - cornerPx;
    for (let x = 0; x < cw; x++) {
      const idx = (y * cw + x) * 3;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const isNonWhite = r < 240 || g < 240 || b < 240;

      if (isNonWhite) {
        if (x < nonWhiteX_min) nonWhiteX_min = x;
        if (x > nonWhiteX_max) nonWhiteX_max = x;
        if (y < nonWhiteY_min) nonWhiteY_min = y;
        if (y > nonWhiteY_max) nonWhiteY_max = y;
      }

      // Corner sampling for whiteness
      const inLeftCorner = x < cornerPx;
      const inRightCorner = x >= cw - cornerPx;
      if ((inTopCorner || inBotCorner) && (inLeftCorner || inRightCorner)) {
        cornerTotalPx++;
        if (!isNonWhite) cornerWhitePx++;
      }
    }
  }

  const bbox_w = nonWhiteX_max < 0 ? 0 : nonWhiteX_max - nonWhiteX_min + 1;
  const bbox_h = nonWhiteY_max < 0 ? 0 : nonWhiteY_max - nonWhiteY_min + 1;
  const fillRatio = cw === 0 || ch === 0 ? 0 : Math.max(bbox_w / cw, bbox_h / ch);
  const whiteness = cornerTotalPx === 0 ? 0 : cornerWhitePx / cornerTotalPx;

  return { longestSide, fillRatio, whiteness };
}
