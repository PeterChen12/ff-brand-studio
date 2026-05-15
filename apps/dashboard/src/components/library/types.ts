import type { PlatformAssetRow } from "@/db/schema";

export interface SkuGroupShape {
  sku: string;
  nameEn: string;
  nameZh: string | null;
  category: string;
  sellerName: string | null;
  isSample: boolean;
  items: PlatformAssetRow[];
}

// v2 Phase 3 adapter writes uppercase ("JPEG"); the legacy worker
// pipeline writes lowercase ("jpg"). The DB column is free-form text,
// so normalize before comparing — case-sensitive checks silently
// turn into "format text shown as a label" + "drawer renders empty".
export function isImageFormat(format: string | null): boolean {
  if (format === null) return true;
  const f = format.toLowerCase();
  return f === "jpg" || f === "jpeg" || f === "png" || f === "webp";
}

export function assetFilename(item: PlatformAssetRow, sku: string): string {
  const raw = item.format ?? "jpg";
  // Always emit a lowercase extension regardless of how the DB stored it.
  const ext = raw.toLowerCase();
  return `${sku}-${item.platform}-${item.slot}.${ext}`;
}
