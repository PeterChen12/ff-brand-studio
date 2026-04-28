/**
 * Sidecar /force-white — Phase 2 v2 white-bg compliance snap.
 *
 * Pixels with min(r,g,b) >= (255 - tolerance) snap to exactly
 * RGB(255,255,255). Re-encodes the result as PNG and reports the
 * fill percentage so the orchestrator can spot pathological inputs.
 *
 * Mirrors the sharp pipeline that was originally drafted in
 * apps/mcp-server/src/lib/image_post.ts (which never ran in
 * production because sharp can't load inside the Worker).
 */

import sharp from "sharp";
import { getR2, putR2 } from "../r2.js";

interface ForceWhiteBody {
  inputKey: string;
  outputKey: string;
  tolerance?: number;
}

interface ForceWhiteOutput {
  outputKey: string;
  fillPct: number;
  millis: number;
}

export async function handleForceWhite(body: ForceWhiteBody): Promise<ForceWhiteOutput> {
  const t0 = Date.now();
  const tol = body.tolerance ?? 8;
  const input = await getR2(body.inputKey);

  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels; // 4 after ensureAlpha
  const total = info.width * info.height;
  let snapped = 0;

  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (Math.min(r, g, b) >= 255 - tol) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      if (channels === 4) data[i + 3] = 255;
      snapped++;
    }
  }

  const out = await sharp(data, {
    raw: { width: info.width, height: info.height, channels },
  })
    .png({ quality: 95 })
    .toBuffer();

  await putR2(body.outputKey, out, "image/png");

  return {
    outputKey: body.outputKey,
    fillPct: total > 0 ? (snapped / total) * 100 : 0,
    millis: Date.now() - t0,
  };
}
