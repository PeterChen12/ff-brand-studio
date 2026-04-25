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

export async function sampleCornerPixels(
  imageBuffer: Buffer,
  totalSampleCount: number = 20,
  target: [number, number, number] = [255, 255, 255],
  cornerInsetRatio: number = 0.04
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

  const samples: Array<[number, number, number]> = [];
  // Seeded RNG isn't strictly needed; corner regions are reliably bg, any
  // sample in the inset hits real background.
  for (const [y0, x0, y1, x1] of corners) {
    for (let i = 0; i < samplesPerCorner; i++) {
      const y = y0 + Math.floor(Math.random() * (y1 - y0));
      const x = x0 + Math.floor(Math.random() * (x1 - x0));
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
 * "Non-white" = any pixel where any channel is < 240. Tolerant of slight
 * compression artifacts at product edges.
 */
export async function measureProductFill(
  imageBuffer: Buffer,
  nonWhiteThreshold: number = 240
): Promise<{ fill_pct: number; bbox_w: number; bbox_h: number; canvas_w: number; canvas_h: number }> {
  const { data, info } = await sharp(imageBuffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;

  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 3;
      if (
        data[idx] < nonWhiteThreshold ||
        data[idx + 1] < nonWhiteThreshold ||
        data[idx + 2] < nonWhiteThreshold
      ) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return { fill_pct: 0, bbox_w: 0, bbox_h: 0, canvas_w: W, canvas_h: H };
  }
  const bbox_w = maxX - minX + 1;
  const bbox_h = maxY - minY + 1;
  const fill_pct = Math.max(bbox_w / W, bbox_h / H) * 100;
  return { fill_pct, bbox_w, bbox_h, canvas_w: W, canvas_h: H };
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
