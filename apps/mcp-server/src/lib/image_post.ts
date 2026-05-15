/**
 * v2 Phase 2 — image post-processing primitives.
 *
 * TS port of `Desktop/ff_brand_studio_v2_test/test_white_bg_compliance.py`.
 * The Python prototype was empirically validated; tolerance, sampling, and
 * fill-measurement parameters here match it exactly.
 *
 * `forceWhiteBackground` is the v2 compliance moat: every image model
 * produces "near-white" output (250–254) that Amazon's listing bot flags as
 * non-compliant. This function snaps any pixel within tolerance of pure
 * white to exact RGB(255,255,255) and re-encodes.
 */

import sharp from "sharp";

export interface ForceWhiteBackgroundOptions {
  /** RGB channel tolerance — pixels with min(r,g,b) >= 255 - tolerance snap to (255,255,255). Default 8. */
  tolerance?: number;
  /** JPEG quality 1-100. Default 92. */
  jpegQuality?: number;
  /** Output format. Default 'jpeg' for Amazon main-image compliance. */
  format?: "jpeg" | "png";
}

/**
 * Phase G · G11 — convenience wrapper that resolves the tolerance from
 * tenant features when present. Use this instead of `forceWhiteBackground`
 * in pipeline call sites that have a tenant context. Brands with
 * off-white pack shots (cream/ivory studio backdrops) can override
 * via `tenant.features.force_white_bg_tolerance` without code change.
 */
export function forceWhiteBackgroundForTenant(
  inputBuffer: Buffer,
  features: { force_white_bg_tolerance?: number } | undefined,
  opts: Omit<ForceWhiteBackgroundOptions, "tolerance"> = {}
): Promise<Buffer> {
  const tenantTolerance = features?.force_white_bg_tolerance;
  return forceWhiteBackground(inputBuffer, {
    ...opts,
    tolerance:
      typeof tenantTolerance === "number" && tenantTolerance >= 0 && tenantTolerance <= 64
        ? tenantTolerance
        : undefined,
  });
}

export async function forceWhiteBackground(
  inputBuffer: Buffer,
  opts: ForceWhiteBackgroundOptions = {}
): Promise<Buffer> {
  const tolerance = opts.tolerance ?? 8;
  const quality = opts.jpegQuality ?? 92;
  const format = opts.format ?? "jpeg";

  const { data, info } = await sharp(inputBuffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  if (channels !== 3) {
    throw new Error(`expected 3 channels (RGB) after removeAlpha, got ${channels}`);
  }
  const minSnap = 255 - tolerance;
  // In-place snap: for each pixel, if all channels >= minSnap, set to (255,255,255)
  for (let i = 0; i < data.length; i += 3) {
    if (data[i] >= minSnap && data[i + 1] >= minSnap && data[i + 2] >= minSnap) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
    }
  }

  const out = sharp(data, { raw: { width, height, channels: 3 } });
  if (format === "jpeg") {
    return out.jpeg({ quality, mozjpeg: true }).toBuffer();
  }
  return out.png({ compressionLevel: 9 }).toBuffer();
}

/**
 * Sample N pixels from the four corner regions (outer 4% inset). At ≥85%
 * fill, these zones are reliably outside the product bbox regardless of
 * orientation — this is the corner-sampling pattern the v2 Python prototype
 * landed on after the random-margin sampling produced false positives.
 */
export interface CornerSampleResult {
  samples: Array<[number, number, number]>;
  off_target_count: number;
  target: [number, number, number];
}

// Phase G · G10 — mulberry32 seeded PRNG. Used by sampleCornerPixels so
// QA runs on the same buffer always produce the same off-target count.
// Why this matters: Math.random() made retries flaky — same image could
// pass once and fail next time. mulberry32 has good statistical
// properties for sub-1k samples and fits in 6 lines.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function sampleCornerPixels(
  imageBuffer: Buffer,
  totalSampleCount: number = 20,
  target: [number, number, number] = [255, 255, 255],
  cornerInsetRatio: number = 0.04,
  /** Optional seed for deterministic sampling. Default 0x46466253 ("FFbs"). */
  seed: number = 0x46466253
): Promise<CornerSampleResult> {
  const { data, info } = await sharp(imageBuffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const samplesPerCorner = Math.floor(totalSampleCount / 4);
  const insetW = Math.floor(W * cornerInsetRatio);
  const insetH = Math.floor(H * cornerInsetRatio);

  const corners: Array<[number, number, number, number]> = [
    [0, 0, insetH, insetW], // TL
    [0, W - insetW, insetH, W], // TR
    [H - insetH, 0, H, insetW], // BL
    [H - insetH, W - insetW, H, W], // BR
  ];

  const rand = mulberry32(seed);
  const samples: Array<[number, number, number]> = [];
  for (const [y0, x0, y1, x1] of corners) {
    for (let i = 0; i < samplesPerCorner; i++) {
      const y = y0 + Math.floor(rand() * (y1 - y0));
      const x = x0 + Math.floor(rand() * (x1 - x0));
      const idx = (y * W + x) * 3;
      samples.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
  }
  const off = samples.filter(
    ([r, g, b]) => r !== target[0] || g !== target[1] || b !== target[2]
  );
  return { samples, off_target_count: off.length, target };
}

/**
 * Measure product fill as max(bbox_w/W, bbox_h/H) — matches Amazon's intent.
 * "Non-white" = any pixel where any channel is < `nonWhiteThreshold` (default
 * 240). Tolerant of slight compression artifacts at product edges.
 *
 * Phase G · G07 — was a JS pixel walk (~600ms on 3000×3000). Now delegates
 * to libvips via sharp's native stats() + trim(), ~12ms on the same input.
 * Output matches the prior implementation byte-for-byte on Amazon-shaped
 * white-bg fixtures (see image_post.test.ts).
 */
export async function measureProductFill(
  imageBuffer: Buffer,
  nonWhiteThreshold: number = 240
): Promise<{ fill_pct: number; bbox_w: number; bbox_h: number; canvas_w: number; canvas_h: number }> {
  const meta = await sharp(imageBuffer).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (W === 0 || H === 0) {
    return { fill_pct: 0, bbox_w: 0, bbox_h: 0, canvas_w: W, canvas_h: H };
  }

  // Fast path — if every channel's min is at-or-above the threshold, the
  // image has no "non-white" pixel anywhere. sharp.trim() in that case
  // would leave the buffer untouched (and we'd over-report fill).
  const stats = await sharp(imageBuffer).removeAlpha().stats();
  const allWhite = stats.channels.every((c) => c.min >= nonWhiteThreshold);
  if (allWhite) {
    return { fill_pct: 0, bbox_w: 0, bbox_h: 0, canvas_w: W, canvas_h: H };
  }

  // sharp.trim's threshold is "max channel distance from background that
  // we still consider background". The prior JS walk marked a pixel as
  // foreground if ANY channel was < nonWhiteThreshold. So a pixel at
  // (nonWhiteThreshold, 255, 255) was background. Sharp's per-pixel
  // condition: max(|255-r|, |255-g|, |255-b|) <= threshold ⇒ trim.
  // Mapping: threshold = 255 - nonWhiteThreshold gives the same boundary.
  const trimThreshold = 255 - nonWhiteThreshold;
  try {
    const { info } = await sharp(imageBuffer)
      .removeAlpha()
      .trim({
        background: { r: 255, g: 255, b: 255 },
        threshold: trimThreshold,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const bbox_w = info.width;
    const bbox_h = info.height;
    const fill_pct = Math.max(bbox_w / W, bbox_h / H) * 100;
    return { fill_pct, bbox_w, bbox_h, canvas_w: W, canvas_h: H };
  } catch (err) {
    // Sharp throws if trim would reduce the image to zero — interpret as
    // "no detectable product" and report 0% rather than crashing the
    // QA pipeline.
    if (err instanceof Error && /trim/i.test(err.message)) {
      return { fill_pct: 0, bbox_w: 0, bbox_h: 0, canvas_w: W, canvas_h: H };
    }
    throw err;
  }
}

/**
 * High-level Amazon main-image compliance check given an image buffer.
 * Returns the same shape as the Python prototype's validate_amazon_main_image.
 */
export interface AmazonMainCheckResult {
  rating: "EXCELLENT" | "FAIR" | "POOR";
  issues: string[];
  metrics: {
    width: number;
    height: number;
    file_size_bytes: number;
    fill_pct: number;
    bg_off_target_count: number;
    bg_samples_total: number;
  };
}

export async function checkAmazonMainImage(
  imageBuffer: Buffer,
  opts: { minFillPct?: number; minLongestSide?: number } = {}
): Promise<AmazonMainCheckResult> {
  const minFill = opts.minFillPct ?? 85.0;
  const minSide = opts.minLongestSide ?? 2000;

  const meta = await sharp(imageBuffer).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const fileSize = imageBuffer.byteLength;

  const issues: string[] = [];

  if (Math.max(W, H) < minSide) {
    issues.push(`longest side ${Math.max(W, H)}px < ${minSide}px`);
  }

  const corner = await sampleCornerPixels(imageBuffer);
  if (corner.off_target_count > 0) {
    issues.push(
      `${corner.off_target_count}/${corner.samples.length} corner samples != (255,255,255)`
    );
  }

  const fill = await measureProductFill(imageBuffer);
  if (fill.fill_pct < minFill) {
    issues.push(
      `product fill ${fill.fill_pct.toFixed(1)}% < ${minFill.toFixed(1)}%`
    );
  }

  let rating: AmazonMainCheckResult["rating"] = "EXCELLENT";
  if (issues.length === 0) {
    rating = "EXCELLENT";
  } else if (
    issues.length === 1 &&
    issues[0].includes("corner samples")
  ) {
    rating = "FAIR";
  } else {
    rating = "POOR";
  }

  return {
    rating,
    issues,
    metrics: {
      width: W,
      height: H,
      file_size_bytes: fileSize,
      fill_pct: fill.fill_pct,
      bg_off_target_count: corner.off_target_count,
      bg_samples_total: corner.samples.length,
    },
  };
}
