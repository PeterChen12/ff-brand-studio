/**
 * Phase G · G06 — dhash unit tests.
 */
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { dhash, hammingDistance, NEAR_DUPLICATE_HAMMING } from "../../src/lib/dhash.js";

async function solidColor(side: number, rgb: [number, number, number]): Promise<Buffer> {
  const data = Buffer.alloc(side * side * 3);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
  }
  return sharp(data, { raw: { width: side, height: side, channels: 3 } })
    .png()
    .toBuffer();
}

async function halfBlackHalfWhite(side: number): Promise<Buffer> {
  const data = Buffer.alloc(side * side * 3);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const v = x < side / 2 ? 0 : 255;
      const idx = (y * side + x) * 3;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
    }
  }
  return sharp(data, { raw: { width: side, height: side, channels: 3 } })
    .png()
    .toBuffer();
}

describe("dhash", () => {
  it("returns a 16-char hex hash", async () => {
    const buf = await solidColor(64, [128, 128, 128]);
    const h = await dhash(buf);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("produces the same hash for identical images", async () => {
    const buf1 = await halfBlackHalfWhite(200);
    const buf2 = await halfBlackHalfWhite(200);
    const h1 = await dhash(buf1);
    const h2 = await dhash(buf2);
    expect(h1).toBe(h2);
  });

  it("produces near-equal hashes for visually similar images (different size, same content)", async () => {
    const small = await halfBlackHalfWhite(100);
    const big = await halfBlackHalfWhite(800);
    const h1 = await dhash(small);
    const h2 = await dhash(big);
    expect(hammingDistance(h1, h2)).toBeLessThanOrEqual(NEAR_DUPLICATE_HAMMING);
  });

  it("produces very different hashes for very different images", async () => {
    const black = await solidColor(200, [0, 0, 0]);
    const halfHalf = await halfBlackHalfWhite(200);
    const h1 = await dhash(black);
    const h2 = await dhash(halfHalf);
    // Solid black vs vertical split should be well outside the near-dup window
    expect(hammingDistance(h1, h2)).toBeGreaterThan(NEAR_DUPLICATE_HAMMING);
  });
});

describe("hammingDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(hammingDistance("ffff0000ffff0000", "ffff0000ffff0000")).toBe(0);
  });

  it("counts single-bit differences correctly", () => {
    // 0xf = 1111, 0xe = 1110 → 1 bit diff
    expect(hammingDistance("f000000000000000", "e000000000000000")).toBe(1);
  });

  it("counts max distance for inverted hashes", () => {
    // 0xffff...ffff vs 0x0000...0000 → all 64 bits differ
    expect(hammingDistance("ffffffffffffffff", "0000000000000000")).toBe(64);
  });

  it("throws on length mismatch", () => {
    expect(() => hammingDistance("abcd", "abcde")).toThrow();
  });
});
