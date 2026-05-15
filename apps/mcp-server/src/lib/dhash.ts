/**
 * Phase G · G06 — Perceptual difference-hash for cross-slot dedup
 * detection.
 *
 * dHash(9×8): resize image to 9 wide × 8 tall greyscale, then for each
 * row compare adjacent pixels — 64 bits encoded as a 16-char hex string.
 * Hamming distance between two hashes correlates with perceptual
 * similarity (≤8 bit-diff = near-duplicate; ≤4 = visually identical).
 *
 * Why dHash and not pHash: dHash is robust to resize/JPEG artifacts and
 * needs ~5ms per image via sharp resize+raw. pHash requires DCT which
 * isn't natively in sharp without a wasm port.
 */
import sharp from "sharp";

const DHASH_WIDTH = 9;
const DHASH_HEIGHT = 8;

export async function dhash(imageBuffer: Buffer): Promise<string> {
  const { data } = await sharp(imageBuffer)
    .removeAlpha()
    .greyscale()
    .resize(DHASH_WIDTH, DHASH_HEIGHT, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 64 bits = 8 bytes. Each row produces 8 comparison bits.
  const bits: number[] = [];
  for (let y = 0; y < DHASH_HEIGHT; y++) {
    for (let x = 0; x < DHASH_WIDTH - 1; x++) {
      const idx = y * DHASH_WIDTH + x;
      bits.push(data[idx] > data[idx + 1] ? 1 : 0);
    }
  }
  // Pack to hex
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
    hex += nibble.toString(16);
  }
  return hex;
}

/** Hamming distance — number of differing bits between two dhash hex strings. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new Error(`hash length mismatch: ${a.length} vs ${b.length}`);
  }
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    // Brian Kernighan's bit-count
    let v = xor;
    while (v) {
      distance += v & 1;
      v >>>= 1;
    }
  }
  return distance;
}

/** Threshold below which two dhashes are considered near-duplicates. */
export const NEAR_DUPLICATE_HAMMING = 8;
