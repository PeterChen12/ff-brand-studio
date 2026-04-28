/**
 * Sidecar /composite-text — overlay 3 spec strings on a hero shot.
 *
 * Layout: 2000×2000 PNG. Background hero from R2; SVG overlay places
 * three spec rows along a tasteful asymmetric column. Watermark in
 * the bottom-right at 8% opacity. Pure XML — no fonts loaded; we use
 * CSS-safe sans-serif fallback so Render's container doesn't need
 * ttf packs.
 */

import sharp from "sharp";
import { getR2, putR2 } from "../r2.js";

interface CompositeTextBody {
  backgroundKey: string;
  outputKey: string;
  specs: string[];
  brandHex: string;
  watermarkText?: string;
}

interface CompositeTextOutput {
  outputKey: string;
  millis: number;
}

const SIZE = 2000;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildOverlaySvg(specs: string[], brandHex: string, watermarkText: string): Buffer {
  const safe = specs.map(escapeXml);
  const wm = escapeXml(watermarkText);

  // Place the column on the right ~30% of the canvas; centered vertically.
  const colX = Math.round(SIZE * 0.62);
  const colW = Math.round(SIZE * 0.34);
  const baseY = Math.round(SIZE * 0.32);
  const rowGap = Math.round(SIZE * 0.18);

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <filter id="textShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="3" />
    </filter>
  </defs>

  <rect x="${colX - 30}" y="${baseY - 60}" width="${colW + 60}" height="${rowGap * 3 + 40}"
        fill="#ffffff" fill-opacity="0.86" rx="18" />

  <line x1="${colX}" y1="${baseY - 18}" x2="${colX + 80}" y2="${baseY - 18}"
        stroke="${brandHex}" stroke-width="6" stroke-linecap="round" />

  ${safe
    .map((s, i) => {
      const y = baseY + i * rowGap;
      return `
    <text x="${colX}" y="${y}" font-family="Georgia,'Times New Roman',serif"
          font-size="62" font-weight="500" fill="#0e0e0d" letter-spacing="-1">${s}</text>
    <line x1="${colX}" y1="${y + 18}" x2="${colX + colW - 30}" y2="${y + 18}"
          stroke="${brandHex}" stroke-opacity="0.25" stroke-width="2" />`;
    })
    .join("")}

  <text x="${SIZE - 80}" y="${SIZE - 60}" font-family="Helvetica,Arial,sans-serif"
        font-size="36" font-weight="700" fill="#000000" fill-opacity="0.08"
        text-anchor="end">${wm}</text>
</svg>
  `.trim();

  return Buffer.from(svg);
}

export async function handleCompositeText(body: CompositeTextBody): Promise<CompositeTextOutput> {
  const t0 = Date.now();
  const bg = await getR2(body.backgroundKey);

  // Normalize background to 2000² so the SVG coordinates match.
  const normalized = await sharp(bg)
    .resize(SIZE, SIZE, { fit: "cover", position: "centre" })
    .png({ quality: 95 })
    .toBuffer();

  const overlay = buildOverlaySvg(
    body.specs,
    body.brandHex,
    body.watermarkText ?? "FF"
  );

  const out = await sharp(normalized)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png({ quality: 95 })
    .toBuffer();

  await putR2(body.outputKey, out, "image/png");

  return { outputKey: body.outputKey, millis: Date.now() - t0 };
}
