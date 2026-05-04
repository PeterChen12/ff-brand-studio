"use client";

// P2-8 — JSZip is ~95KB and only used inside bundleSku. We dynamic-
// import it on demand so /, /launch, /settings etc. don't pay for it
// in their First Load. Same play for file-saver (small, but keeps
// the import path consistent).
import type { PlatformAssetRow } from "@/db/schema";
import { isImageFormat } from "@/components/library/types";

export interface BundleSku {
  sku: string;
  nameEn: string;
  items: PlatformAssetRow[];
}

const HARD_CAP_BYTES = 200 * 1024 * 1024;

export class BundleTooLargeError extends Error {
  bytes: number;
  constructor(bytes: number) {
    super(`Bundle exceeds 200MB cap (${(bytes / 1_048_576).toFixed(1)}MB).`);
    this.bytes = bytes;
  }
}

function csvEscape(s: string | number | null): string {
  if (s === null || s === undefined) return "";
  const str = String(s);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function manifestRow(group: BundleSku, item: PlatformAssetRow, filename: string): string {
  return [
    csvEscape(group.sku),
    csvEscape(item.platform),
    csvEscape(item.slot),
    csvEscape(filename),
    csvEscape(item.width ?? ""),
    csvEscape(item.height ?? ""),
    csvEscape(item.complianceScore ?? ""),
    csvEscape(item.modelUsed ?? ""),
    csvEscape(item.costCents ?? ""),
    csvEscape(item.createdAt ?? ""),
  ].join(",");
}

export async function bundleSku(group: BundleSku): Promise<void> {
  // Lazy chunks for the heavy bundling deps — only paid when the
  // operator actually clicks "Download bundle".
  const [{ default: JSZip }, { saveAs }] = await Promise.all([
    import("jszip"),
    import("file-saver"),
  ]);
  const zip = new JSZip();
  const folder = zip.folder(group.sku);
  if (!folder) throw new Error("Failed to create zip folder");

  const manifestLines = [
    "sku,platform,slot,filename,width,height,rating,model_used,cost_cents,generated_at",
  ];

  let totalBytes = 0;

  for (const item of group.items) {
    if (!isImageFormat(item.format)) continue;
    const ext = item.format ?? "jpg";
    const filename = `${item.platform}-${item.slot}.${ext}`;
    const res = await fetch(item.r2Url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${item.r2Url}: ${res.status}`);
    }
    const blob = await res.blob();
    totalBytes += blob.size;
    if (totalBytes > HARD_CAP_BYTES) {
      throw new BundleTooLargeError(totalBytes);
    }
    folder.file(filename, blob);
    manifestLines.push(manifestRow(group, item, filename));
  }

  zip.file("manifest.csv", manifestLines.join("\n"));

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  saveAs(blob, `${group.sku}-bundle.zip`);
}

export function downloadAsset(item: PlatformAssetRow, sku: string): void {
  const ext = item.format ?? "jpg";
  const filename = `${sku}-${item.platform}-${item.slot}.${ext}`;
  const a = document.createElement("a");
  a.href = item.r2Url;
  a.download = filename;
  a.rel = "noopener";
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
