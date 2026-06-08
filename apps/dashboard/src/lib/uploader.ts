"use client";

/**
 * Phase H1.1 — client-side image compression + direct-to-R2 PUT.
 *
 * Compress every accepted file to ≤2MB / ≤2000px before sending so we
 * never blow the Worker request budget. The PUT bypasses the Worker
 * entirely — straight to the R2 endpoint that the upload-intent
 * endpoint signed for us.
 */

import imageCompression from "browser-image-compression";

export type UploadStage =
  | "idle"
  | "compressing"
  | "uploading"
  | "verifying"
  | "done"
  | "error";

export interface UploadProgressEvent {
  index: number;
  stage: UploadStage;
  bytes_uploaded?: number;
  bytes_total?: number;
  error?: string;
}

export async function compressImage(file: File): Promise<File> {
  // Skip compression if already tiny — saves a few hundred ms on
  // already-optimized assets.
  if (file.size < 500_000) return file;
  return imageCompression(file, {
    maxSizeMB: 2,
    maxWidthOrHeight: 2000,
    useWebWorker: true,
    initialQuality: 0.85,
    fileType: file.type === "image/png" ? "image/png" : "image/jpeg",
  });
}

function putToR2Once(
  presignedUrl: string,
  file: File,
  onProgress?: (uploaded: number, total: number) => void
): Promise<void> {
  // fetch() doesn't expose upload progress; for that we need XHR.
  // The progress callback is best-effort UI feedback, not load-bearing.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", presignedUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        const err = new Error(`R2 PUT ${xhr.status}: ${xhr.responseText.slice(0, 200)}`);
        (err as { status?: number }).status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => {
      const err = new Error("R2 PUT network error");
      (err as { status?: number }).status = 0;
      reject(err);
    };
    xhr.send(file);
  });
}

export async function putToR2(
  presignedUrl: string,
  file: File,
  onProgress?: (uploaded: number, total: number) => void
): Promise<void> {
  // Retry transient R2 failures (network drop / 5xx) with backoff so a flaky
  // connection mid-bulk doesn't leave a product referencing a missing image
  // (which the server then rejects after the wallet is charged). Fail FAST on
  // 4xx — an expired/invalid presigned signature won't succeed on retry of
  // the same URL (the longer TTL below + a future refresh-on-403 cover that).
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [400, 1200];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await putToR2Once(presignedUrl, file, onProgress);
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0;
      const transient = status === 0 || status >= 500;
      if (transient && attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
        continue;
      }
      throw e;
    }
  }
}

export function extractExt(file: File): "jpg" | "jpeg" | "png" | "webp" | null {
  const t = file.type.toLowerCase();
  if (t === "image/jpeg") return "jpg";
  if (t === "image/png") return "png";
  if (t === "image/webp") return "webp";
  return null;
}
