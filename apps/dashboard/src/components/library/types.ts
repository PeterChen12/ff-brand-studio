import type { PlatformAssetRow } from "@/db/schema";

export interface SkuGroupShape {
  sku: string;
  nameEn: string;
  nameZh: string | null;
  category: string;
  sellerName: string | null;
  items: PlatformAssetRow[];
}

export function isImageFormat(format: string | null): boolean {
  return (
    format === "jpg" ||
    format === "jpeg" ||
    format === "png" ||
    format === "webp" ||
    format === null
  );
}

export function assetFilename(item: PlatformAssetRow, sku: string): string {
  const ext = item.format ?? "jpg";
  return `${sku}-${item.platform}-${item.slot}.${ext}`;
}
