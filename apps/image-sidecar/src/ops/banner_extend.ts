/**
 * Sidecar /banner-extend — produces a 16:9 hero from a 1:1 studio
 * shot by extending the canvas with a brand-color gradient on each
 * side. Used for Shopify's banner slot.
 */

import sharp from "sharp";
import { getR2, putR2 } from "../r2.js";

interface BannerBody {
  inputKey: string;
  outputKey: string;
  aspect?: string;
  brandHex: string;
}

interface BannerOutput {
  outputKey: string;
  millis: number;
}

function parseAspect(aspect: string | undefined): { w: number; h: number } {
  if (!aspect) return { w: 16, h: 9 };
  const m = aspect.match(/^(\d+):(\d+)$/);
  if (!m) return { w: 16, h: 9 };
  return { w: Number(m[1]), h: Number(m[2]) };
}

export async function handleBannerExtend(body: BannerBody): Promise<BannerOutput> {
  const t0 = Date.now();
  const input = await getR2(body.inputKey);
  const meta = await sharp(input).metadata();
  const srcW = meta.width ?? 2000;
  const srcH = meta.height ?? 2000;

  const aspect = parseAspect(body.aspect);
  // Target height = 1080; width = 1920 for 16:9.
  const targetH = 1080;
  const targetW = Math.round((targetH * aspect.w) / aspect.h);

  // Resize source to fit fully inside, then place on a colored canvas.
  const innerH = Math.round(targetH * 0.92);
  const innerW = Math.round((innerH * srcW) / srcH);
  const resized = await sharp(input)
    .resize(innerW, innerH, { fit: "inside" })
    .toBuffer();

  // Build a left→right gradient SVG with the brand color in the centre
  // and a slight darkening at the edges for depth.
  const gradientSvg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${targetW}" height="${targetH}" viewBox="0 0 ${targetW} ${targetH}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="${targetW}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${body.brandHex}" stop-opacity="0.92" />
      <stop offset="0.5" stop-color="${body.brandHex}" stop-opacity="1.0" />
      <stop offset="1" stop-color="${body.brandHex}" stop-opacity="0.92" />
    </linearGradient>
  </defs>
  <rect width="${targetW}" height="${targetH}" fill="url(#g)" />
</svg>
  `.trim());

  const gradient = await sharp(gradientSvg).png().toBuffer();

  const out = await sharp(gradient)
    .composite([
      {
        input: resized,
        top: Math.round((targetH - innerH) / 2),
        left: Math.round((targetW - innerW) / 2),
      },
    ])
    .png({ quality: 95 })
    .toBuffer();

  await putR2(body.outputKey, out, "image/png");

  return { outputKey: body.outputKey, millis: Date.now() - t0 };
}
