/**
 * Sidecar /derive — kind-aware crops.
 *
 * Reads the cleanup.png from R2, produces 4 outputs:
 *  studio.png  — canonical 1:1 white-bg
 *  crop_A.png, crop_B.png, crop_C.png — per-kind detail crops
 *
 * The crop strategies map 1:1 to the Phase I plan's kind table. Each
 * region is a percentage of the source's bounding extent so the same
 * code works regardless of input resolution.
 */

import sharp from "sharp";
import { getR2, putR2 } from "../r2.js";

interface DeriveBody {
  inputKey: string;
  outputPrefix: string;
  kind: string;
  paddingPct?: number;
}

interface DeriveOutput {
  studioKey: string;
  cropAKey: string;
  cropBKey: string;
  cropCKey: string;
  detectedAspect: number;
  millis: number;
}

const TARGET_SIZE = 2000;

interface CropSpec {
  /** Bounding box as fractions of the source dimensions: {x, y, w, h} 0..1. */
  x: number;
  y: number;
  w: number;
  h: number;
}

function cropsForKind(kind: string): { A: CropSpec; B: CropSpec; C: CropSpec } {
  switch (kind) {
    case "long_thin_vertical":
      return {
        A: { x: 0.0, y: 0.0, w: 1.0, h: 0.34 },     // top third
        B: { x: 0.0, y: 0.33, w: 1.0, h: 0.34 },    // mid third
        C: { x: 0.0, y: 0.66, w: 1.0, h: 0.34 },    // bottom third
      };
    case "long_thin_horizontal":
      return {
        A: { x: 0.0, y: 0.0, w: 0.34, h: 1.0 },
        B: { x: 0.33, y: 0.0, w: 0.34, h: 1.0 },
        C: { x: 0.66, y: 0.0, w: 0.34, h: 1.0 },
      };
    case "compact_square":
      return {
        A: { x: 0.0, y: 0.0, w: 0.55, h: 1.0 },     // left half
        B: { x: 0.45, y: 0.0, w: 0.55, h: 1.0 },    // right half
        C: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },      // center band
      };
    case "compact_round":
      return {
        A: { x: 0.0, y: 0.0, w: 1.0, h: 0.55 },     // top arc
        B: { x: 0.0, y: 0.45, w: 1.0, h: 0.55 },    // bottom arc
        C: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },      // center
      };
    case "horizontal_thin":
      return {
        A: { x: 0.0, y: 0.0, w: 0.4, h: 1.0 },
        B: { x: 0.3, y: 0.0, w: 0.4, h: 1.0 },
        C: { x: 0.6, y: 0.0, w: 0.4, h: 1.0 },
      };
    case "multi_component":
      return {
        A: { x: 0.0, y: 0.0, w: 0.55, h: 1.0 },     // primary component
        B: { x: 0.45, y: 0.0, w: 0.55, h: 1.0 },    // secondary
        C: { x: 0.0, y: 0.0, w: 1.0, h: 1.0 },      // both, full frame
      };
    case "apparel_flat":
      return {
        A: { x: 0.0, y: 0.0, w: 1.0, h: 1.0 },      // full
        B: { x: 0.25, y: 0.0, w: 0.5, h: 0.4 },     // collar zoom
        C: { x: 0.25, y: 0.6, w: 0.5, h: 0.4 },     // hem zoom
      };
    case "accessory_small":
      return {
        A: { x: 0.0, y: 0.1, w: 0.6, h: 0.8 },      // side profile
        B: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 },      // 3/4 angle (shifted)
        C: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 },      // detail zoom
      };
    default:
      // Safe fallback: same as compact_square
      return {
        A: { x: 0.0, y: 0.0, w: 0.55, h: 1.0 },
        B: { x: 0.45, y: 0.0, w: 0.55, h: 1.0 },
        C: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
      };
  }
}

async function makeStudio(input: Buffer, paddingPct: number): Promise<Buffer> {
  // Center on a TARGET_SIZE square white canvas, sized to fill paddingPct of
  // the canvas's shortest dimension. Preserves aspect ratio.
  const meta = await sharp(input).metadata();
  const srcW = meta.width ?? TARGET_SIZE;
  const srcH = meta.height ?? TARGET_SIZE;
  const innerSize = Math.round(TARGET_SIZE * (paddingPct / 100));
  const aspect = srcW / srcH;

  let resizeW: number;
  let resizeH: number;
  if (aspect >= 1) {
    resizeW = innerSize;
    resizeH = Math.round(innerSize / aspect);
  } else {
    resizeH = innerSize;
    resizeW = Math.round(innerSize * aspect);
  }

  const resized = await sharp(input)
    .resize(resizeW, resizeH, { fit: "inside", withoutEnlargement: false })
    .toBuffer();

  return sharp({
    create: {
      width: TARGET_SIZE,
      height: TARGET_SIZE,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite([
      {
        input: resized,
        top: Math.round((TARGET_SIZE - resizeH) / 2),
        left: Math.round((TARGET_SIZE - resizeW) / 2),
      },
    ])
    .png({ quality: 95 })
    .toBuffer();
}

async function makeCrop(input: Buffer, spec: CropSpec): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  const srcW = meta.width ?? TARGET_SIZE;
  const srcH = meta.height ?? TARGET_SIZE;
  const left = Math.max(0, Math.floor(spec.x * srcW));
  const top = Math.max(0, Math.floor(spec.y * srcH));
  const width = Math.max(1, Math.floor(spec.w * srcW));
  const height = Math.max(1, Math.floor(spec.h * srcH));

  const cropped = await sharp(input)
    .extract({
      left,
      top,
      width: Math.min(width, srcW - left),
      height: Math.min(height, srcH - top),
    })
    .toBuffer();

  // Place inside a TARGET_SIZE square white canvas with 8% padding.
  return sharp({
    create: {
      width: TARGET_SIZE,
      height: TARGET_SIZE,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite([
      {
        input: await sharp(cropped)
          .resize(Math.round(TARGET_SIZE * 0.92), Math.round(TARGET_SIZE * 0.92), {
            fit: "inside",
            withoutEnlargement: false,
          })
          .toBuffer(),
        gravity: "center",
      },
    ])
    .png({ quality: 95 })
    .toBuffer();
}

export async function handleDerive(body: DeriveBody): Promise<DeriveOutput> {
  const t0 = Date.now();
  const input = await getR2(body.inputKey);

  const meta = await sharp(input).metadata();
  const aspect = (meta.width ?? 1) / (meta.height ?? 1);

  const paddingPct = body.paddingPct ?? 92;
  const specs = cropsForKind(body.kind);

  const [studio, cropA, cropB, cropC] = await Promise.all([
    makeStudio(input, paddingPct),
    makeCrop(input, specs.A),
    makeCrop(input, specs.B),
    makeCrop(input, specs.C),
  ]);

  const prefix = body.outputPrefix.replace(/\/$/, "");
  const studioKey = `${prefix}/studio.png`;
  const cropAKey = `${prefix}/crop_A.png`;
  const cropBKey = `${prefix}/crop_B.png`;
  const cropCKey = `${prefix}/crop_C.png`;

  await Promise.all([
    putR2(studioKey, studio, "image/png"),
    putR2(cropAKey, cropA, "image/png"),
    putR2(cropBKey, cropB, "image/png"),
    putR2(cropCKey, cropC, "image/png"),
  ]);

  return {
    studioKey,
    cropAKey,
    cropBKey,
    cropCKey,
    detectedAspect: aspect,
    millis: Date.now() - t0,
  };
}
