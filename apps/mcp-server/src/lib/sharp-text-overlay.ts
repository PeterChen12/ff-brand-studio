/**
 * Phase F · Iter 07 MVP — In-worker sharp text overlay helper.
 *
 * Composites text blocks onto a base image via sharp + SVG. Uses
 * web-safe font fallback chains so we DON'T bundle font files (which
 * would push the worker bundle past Cloudflare's 10MB limit). The
 * existing composite.ts sidecar handles bundled-font rendering for
 * A+ slots; this helper is for in-worker use cases where the sidecar
 * round-trip is overkill.
 *
 * Not currently wired into any pipeline stage. Ships as a building
 * block for future iterations that need to add text to lifestyle /
 * banner slots without invoking the sidecar.
 *
 * Why no font bundling: subset Inter + Noto Sans SC (CJK) alone is
 * ~3MB. Cloudflare's gzipped worker cap is 10MB. We're at ~3.5MB
 * today; bundling fonts would gate other features. The web-safe
 * fallback chain ("Inter, Helvetica, Arial, sans-serif") renders
 * acceptably on every system sharp runs on.
 */
import sharp from "sharp";

export interface TextBlock {
  /** The text to render. CJK supported via fallback fonts. */
  text: string;
  /** Anchor point on the base image, normalized 0-1. */
  anchorX: number;
  anchorY: number;
  /** Pixel font size on the OUTPUT image. */
  fontSize: number;
  /** Font weight 100-900. Defaults 600. */
  fontWeight?: number;
  /** Hex color e.g. "#FFFFFF". Defaults "#000000". */
  color?: string;
  /** Optional drop-shadow rgba (e.g. "rgba(0,0,0,0.5)"). */
  shadow?: string;
  /** Hard max width in pixels; text wraps. Default no wrap. */
  maxWidth?: number;
  /** Horizontal alignment relative to anchor. Default "left". */
  align?: "left" | "center" | "right";
}

export interface ComposeTextOverlayInput {
  /** Source PNG/JPEG buffer to composite onto. */
  baseBuffer: Buffer;
  /** One or more text blocks to overlay. */
  blocks: TextBlock[];
  /** Output format. Default "png". */
  format?: "png" | "jpeg" | "webp";
}

const WEB_SAFE_FONT_STACK =
  "'Inter', 'Helvetica Neue', 'Helvetica', 'Arial', " +
  "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build the SVG that sharp will composite. Each text block becomes
 * one <text> element. Multi-line wrapping is naive — splits on word
 * boundaries when maxWidth is exceeded (no proper text shaping).
 */
function buildSvgOverlay(width: number, height: number, blocks: TextBlock[]): string {
  const elements = blocks
    .map((b) => {
      const x = Math.round(b.anchorX * width);
      const y = Math.round(b.anchorY * height);
      const weight = b.fontWeight ?? 600;
      const fill = b.color ?? "#000000";
      const align = b.align ?? "left";
      const textAnchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
      const shadow = b.shadow
        ? `<filter id="s${x}_${y}" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="${escapeXml(b.shadow)}" /></filter>`
        : "";
      const filterAttr = b.shadow ? ` filter="url(#s${x}_${y})"` : "";
      // Naive wrap: if maxWidth, split on words and group into <tspan>
      // lines at fontSize * 1.2 leading. No proper text-shaping.
      if (b.maxWidth) {
        const charsPerLine = Math.max(1, Math.floor(b.maxWidth / (b.fontSize * 0.55)));
        const words = b.text.split(/\s+/);
        const lines: string[] = [];
        let current = "";
        for (const w of words) {
          if ((current + " " + w).trim().length <= charsPerLine) {
            current = (current + " " + w).trim();
          } else {
            if (current) lines.push(current);
            current = w;
          }
        }
        if (current) lines.push(current);
        const tspans = lines
          .map(
            (line, i) =>
              `<tspan x="${x}" dy="${i === 0 ? 0 : Math.round(b.fontSize * 1.2)}">${escapeXml(line)}</tspan>`
          )
          .join("");
        return `${shadow}<text x="${x}" y="${y}" font-family="${WEB_SAFE_FONT_STACK}" font-size="${b.fontSize}" font-weight="${weight}" fill="${fill}" text-anchor="${textAnchor}"${filterAttr}>${tspans}</text>`;
      }
      return `${shadow}<text x="${x}" y="${y}" font-family="${WEB_SAFE_FONT_STACK}" font-size="${b.fontSize}" font-weight="${weight}" fill="${fill}" text-anchor="${textAnchor}"${filterAttr}>${escapeXml(b.text)}</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${elements}</svg>`;
}

export async function composeTextOverlay(input: ComposeTextOverlayInput): Promise<Buffer> {
  const meta = await sharp(input.baseBuffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) {
    throw new Error("composeTextOverlay: base image has zero dimension");
  }
  const svg = buildSvgOverlay(width, height, input.blocks);
  const pipeline = sharp(input.baseBuffer).composite([
    { input: Buffer.from(svg), blend: "over" },
  ]);
  switch (input.format ?? "png") {
    case "jpeg":
      return pipeline.jpeg({ quality: 92 }).toBuffer();
    case "webp":
      return pipeline.webp({ quality: 92 }).toBuffer();
    default:
      return pipeline.png().toBuffer();
  }
}

/** Exposed for tests; do not import from production code. */
export const __buildSvgOverlay_forTest = buildSvgOverlay;
