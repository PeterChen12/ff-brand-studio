import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  forceWhiteBackground,
  sampleCornerPixels,
  measureProductFill,
  checkAmazonMainImage,
} from "../../src/lib/image_post.js";

/**
 * Synthetic test fixtures generated in-memory:
 *  - mostlyWhite(n=8): n×n canvas where every pixel is RGB(247,247,247)
 *    (within the default tolerance=8 of pure white)
 *  - whiteWithBlackSquare: 2000×2000 white canvas with a 1700×1700 black
 *    rectangle centered (matches Amazon main-image profile: white bg + product)
 */
function mostlyWhitePng(side: number, fillRgb: [number, number, number] = [247, 247, 247]): Promise<Buffer> {
  const data = Buffer.alloc(side * side * 3);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = fillRgb[0];
    data[i + 1] = fillRgb[1];
    data[i + 2] = fillRgb[2];
  }
  return sharp(data, { raw: { width: side, height: side, channels: 3 } })
    .png()
    .toBuffer();
}

async function whiteWithCenteredBlackSquare(
  canvasSide: number,
  productSide: number
): Promise<Buffer> {
  const data = Buffer.alloc(canvasSide * canvasSide * 3, 255);
  const start = Math.floor((canvasSide - productSide) / 2);
  for (let y = start; y < start + productSide; y++) {
    for (let x = start; x < start + productSide; x++) {
      const idx = (y * canvasSide + x) * 3;
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
    }
  }
  return sharp(data, {
    raw: { width: canvasSide, height: canvasSide, channels: 3 },
  })
    .jpeg({ quality: 92 })
    .toBuffer();
}

describe("forceWhiteBackground", () => {
  it("snaps near-white pixels (247,247,247) to exact (255,255,255)", async () => {
    const input = await mostlyWhitePng(64, [247, 247, 247]);
    const output = await forceWhiteBackground(input, { tolerance: 8 });
    const { data } = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    // Sample 10 random pixels — all should be exactly (255,255,255)
    for (let i = 0; i < 10; i++) {
      const idx = i * 3;
      expect(data[idx]).toBe(255);
      expect(data[idx + 1]).toBe(255);
      expect(data[idx + 2]).toBe(255);
    }
  });

  it("does NOT modify pixels outside the tolerance band", async () => {
    const input = await mostlyWhitePng(64, [200, 200, 200]); // gray, not near-white
    const output = await forceWhiteBackground(input, { tolerance: 8, format: "png" });
    const { data } = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    // Should still be gray (PNG is lossless so values are preserved exactly)
    expect(data[0]).toBeLessThan(255);
    expect(data[0]).toBeGreaterThan(180);
  });

  it("encodes JPEG by default", async () => {
    const input = await mostlyWhitePng(64, [255, 255, 255]);
    const output = await forceWhiteBackground(input);
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("jpeg");
  });

  it("can encode PNG when requested", async () => {
    const input = await mostlyWhitePng(64, [255, 255, 255]);
    const output = await forceWhiteBackground(input, { format: "png" });
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("png");
  });
});

describe("sampleCornerPixels", () => {
  it("reports 0 off-target on a pure-white canvas", async () => {
    const buf = await whiteWithCenteredBlackSquare(2000, 1700);
    const result = await sampleCornerPixels(buf);
    expect(result.off_target_count).toBe(0);
    expect(result.samples.length).toBeGreaterThanOrEqual(20);
  });
});

describe("measureProductFill", () => {
  it("reports ~85% fill for a 1700px square on a 2000px canvas", async () => {
    const buf = await whiteWithCenteredBlackSquare(2000, 1700);
    const result = await measureProductFill(buf);
    expect(result.fill_pct).toBeGreaterThan(82);
    expect(result.fill_pct).toBeLessThan(88);
    expect(result.canvas_w).toBe(2000);
  });

  it("reports 0% on a fully white canvas", async () => {
    const buf = await mostlyWhitePng(500, [255, 255, 255]);
    const result = await measureProductFill(buf);
    expect(result.fill_pct).toBe(0);
  });
});

describe("checkAmazonMainImage", () => {
  it("rates EXCELLENT for a 2000×2000 white-bg with ≥85% fill", async () => {
    const buf = await whiteWithCenteredBlackSquare(2000, 1750);
    const result = await checkAmazonMainImage(buf);
    expect(result.rating).toBe("EXCELLENT");
    expect(result.issues).toEqual([]);
  });

  it("rates POOR when below the 2000px floor", async () => {
    const buf = await whiteWithCenteredBlackSquare(800, 700);
    const result = await checkAmazonMainImage(buf);
    expect(result.rating).toBe("POOR");
    expect(result.issues.some((i) => i.includes("longest side"))).toBe(true);
  });

  it("rates POOR on a low-fill canvas", async () => {
    const buf = await whiteWithCenteredBlackSquare(2000, 1000); // 50% fill
    const result = await checkAmazonMainImage(buf);
    expect(result.rating).toBe("POOR");
    expect(result.issues.some((i) => i.includes("product fill"))).toBe(true);
  });
});
