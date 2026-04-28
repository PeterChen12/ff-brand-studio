/**
 * Phase K3 — R2 export bundler.
 *
 * Builds a ZIP in-memory (no streaming — runs inside the Worker so we
 * keep the SKU asset count small enough to fit) and writes it to
 * tenant/<tid>/exports/<runId>/bundle.zip. Returns a 7-day presigned
 * URL the operator can hand to whoever uploads to Amazon / Shopify.
 *
 * The CSV manifest follows the Amazon Inventory File minimum columns
 * + Shopify product CSV minimums per the inbox file's hard
 * constraints. Both are flat text — Excel / Google Sheets / vendor
 * uploaders can ingest them as-is.
 */

import { and, eq, isNotNull, inArray } from "drizzle-orm";
import {
  platformAssets,
  platformListings,
  productVariants,
  products,
  type Product,
} from "../../db/schema.js";
import type { DbClient } from "../../db/client.js";
import { presignGetUrl } from "./presign-get.js";

interface ExportInput {
  tenantId: string;
  productId: string;
  /** External run id we use as the export folder name. */
  runId: string;
}

interface ExportResult {
  ok: boolean;
  zipKey?: string;
  presignedUrl?: string;
  manifestColumns?: string[];
  fileCount?: number;
  reason?: string;
}

const AMAZON_INVENTORY_COLUMNS = [
  "sku",
  "product-id",
  "product-id-type",
  "price",
  "minimum-seller-allowed-price",
  "maximum-seller-allowed-price",
  "item-condition",
  "quantity",
  "add-delete",
  "will-ship-internationally",
  "expedited-shipping",
  "item-name",
  "main-image-url",
  "other-image-url-1",
  "other-image-url-2",
  "other-image-url-3",
  "other-image-url-4",
  "other-image-url-5",
  "swatch-image-url",
  "product-description",
  "bullet-point-1",
  "bullet-point-2",
  "bullet-point-3",
  "bullet-point-4",
  "bullet-point-5",
  "search-terms",
];

const SHOPIFY_PRODUCT_COLUMNS = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Vendor",
  "Type",
  "Tags",
  "Published",
  "Variant SKU",
  "Variant Price",
  "Image Src",
  "Image Position",
  "SEO Title",
  "SEO Description",
];

function csvEscape(s: unknown): string {
  if (s === null || s === undefined) return "";
  const str = String(s);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function buildAmazonRow(
  product: Product,
  listing: { copy: unknown } | null,
  imageUrls: string[]
): string {
  const copy = (listing?.copy ?? {}) as Record<string, unknown>;
  const bullets = Array.isArray(copy.bullets) ? copy.bullets : [];
  const row: Record<string, unknown> = {
    sku: product.sku,
    "product-id": product.sku,
    "product-id-type": "1",
    price: "",
    "minimum-seller-allowed-price": "",
    "maximum-seller-allowed-price": "",
    "item-condition": "11",
    quantity: "",
    "add-delete": "a",
    "will-ship-internationally": "",
    "expedited-shipping": "",
    "item-name": copy.title ?? product.nameEn,
    "main-image-url": imageUrls[0] ?? "",
    "other-image-url-1": imageUrls[1] ?? "",
    "other-image-url-2": imageUrls[2] ?? "",
    "other-image-url-3": imageUrls[3] ?? "",
    "other-image-url-4": imageUrls[4] ?? "",
    "other-image-url-5": imageUrls[5] ?? "",
    "swatch-image-url": "",
    "product-description": copy.description ?? "",
    "bullet-point-1": bullets[0] ?? "",
    "bullet-point-2": bullets[1] ?? "",
    "bullet-point-3": bullets[2] ?? "",
    "bullet-point-4": bullets[3] ?? "",
    "bullet-point-5": bullets[4] ?? "",
    "search-terms": copy.search_terms ?? "",
  };
  return AMAZON_INVENTORY_COLUMNS.map((c) => csvEscape(row[c])).join(",");
}

function buildShopifyRows(
  product: Product,
  listing: { copy: unknown } | null,
  imageUrls: string[]
): string[] {
  const copy = (listing?.copy ?? {}) as Record<string, unknown>;
  const baseRow: Record<string, unknown> = {
    Handle: product.sku.toLowerCase(),
    Title: copy.h1 ?? product.nameEn,
    "Body (HTML)": copy.description_md ?? "",
    Vendor: "FF",
    Type: product.category,
    Tags: "",
    Published: "TRUE",
    "Variant SKU": product.sku,
    "Variant Price": "",
    "Image Src": imageUrls[0] ?? "",
    "Image Position": "1",
    "SEO Title": copy.h1 ?? product.nameEn,
    "SEO Description": copy.meta_description ?? "",
  };
  const rows: string[] = [SHOPIFY_PRODUCT_COLUMNS.map((c) => csvEscape(baseRow[c])).join(",")];
  for (let i = 1; i < imageUrls.length; i++) {
    const r: Record<string, unknown> = {
      ...baseRow,
      Title: "",
      "Body (HTML)": "",
      Vendor: "",
      Type: "",
      Tags: "",
      Published: "",
      "Variant SKU": "",
      "Variant Price": "",
      "Image Src": imageUrls[i],
      "Image Position": String(i + 1),
      "SEO Title": "",
      "SEO Description": "",
    };
    rows.push(SHOPIFY_PRODUCT_COLUMNS.map((c) => csvEscape(r[c])).join(","));
  }
  return rows;
}

/**
 * Minimal ZIP writer (store-only, no compression). Avoids pulling jszip
 * into the Worker — we hand the bytes back to the operator to unzip
 * locally where size doesn't matter.
 */
function buildZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  // ZIP central-directory + local-file headers, store mode (no deflate).
  // Format spec: APPNOTE.TXT 6.3.10 §4.3.7 / §4.3.12
  const enc = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const cdChunks: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    // Local file header
    const lfh = new Uint8Array(30 + nameBytes.length);
    const lfhView = new DataView(lfh.buffer);
    lfhView.setUint32(0, 0x04034b50, true); // signature
    lfhView.setUint16(4, 20, true); // version
    lfhView.setUint16(6, 0, true); // flags
    lfhView.setUint16(8, 0, true); // method (store)
    lfhView.setUint16(10, 0, true); // mtime
    lfhView.setUint16(12, 0, true); // mdate
    lfhView.setUint32(14, crc, true);
    lfhView.setUint32(18, size, true);
    lfhView.setUint32(22, size, true);
    lfhView.setUint16(26, nameBytes.length, true);
    lfhView.setUint16(28, 0, true); // extra
    lfh.set(nameBytes, 30);

    localChunks.push(lfh);
    localChunks.push(f.data);

    // Central directory header
    const cdh = new Uint8Array(46 + nameBytes.length);
    const cdhView = new DataView(cdh.buffer);
    cdhView.setUint32(0, 0x02014b50, true);
    cdhView.setUint16(4, 20, true);
    cdhView.setUint16(6, 20, true);
    cdhView.setUint16(8, 0, true);
    cdhView.setUint16(10, 0, true);
    cdhView.setUint16(12, 0, true);
    cdhView.setUint16(14, 0, true);
    cdhView.setUint32(16, crc, true);
    cdhView.setUint32(20, size, true);
    cdhView.setUint32(24, size, true);
    cdhView.setUint16(28, nameBytes.length, true);
    cdhView.setUint16(30, 0, true);
    cdhView.setUint16(32, 0, true);
    cdhView.setUint16(34, 0, true);
    cdhView.setUint16(36, 0, true);
    cdhView.setUint32(38, 0, true);
    cdhView.setUint32(42, offset, true);
    cdh.set(nameBytes, 46);
    cdChunks.push(cdh);

    offset += lfh.length + size;
  }

  // EOCD
  const cdSize = cdChunks.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, cdSize, true);
  eocdView.setUint32(16, offset, true);

  const total =
    localChunks.reduce((s, c) => s + c.length, 0) + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of localChunks) {
    out.set(c, p);
    p += c.length;
  }
  for (const c of cdChunks) {
    out.set(c, p);
    p += c.length;
  }
  out.set(eocd, p);
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export async function exportSkuToR2(
  env: CloudflareBindings,
  db: DbClient,
  input: ExportInput
): Promise<ExportResult> {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, input.productId), eq(products.tenantId, input.tenantId)))
    .limit(1);
  if (!product) return { ok: false, reason: "product_not_found" };

  const variants = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(eq(productVariants.productId, product.id));
  const variantIds = variants.map((v) => v.id);
  if (variantIds.length === 0) return { ok: false, reason: "no_variants" };

  const assets = await db
    .select()
    .from(platformAssets)
    .where(
      and(
        inArray(platformAssets.variantId, variantIds),
        isNotNull(platformAssets.approvedAt)
      )
    );

  const listings = await db
    .select()
    .from(platformListings)
    .where(
      and(
        inArray(platformListings.variantId, variantIds),
        isNotNull(platformListings.approvedAt)
      )
    );

  const amazonListing = listings.find((l) => l.surface === "amazon-us") ?? null;
  const shopifyListing = listings.find((l) => l.surface === "shopify") ?? null;

  const amazonImages = assets
    .filter((a) => a.platform === "amazon")
    .sort((a, b) => slotOrderAmazon(a.slot) - slotOrderAmazon(b.slot))
    .map((a) => a.r2Url);
  const shopifyImages = assets
    .filter((a) => a.platform === "shopify")
    .sort((a, b) => slotOrderShopify(a.slot) - slotOrderShopify(b.slot))
    .map((a) => a.r2Url);

  // Build CSVs.
  const amazonCsv = [
    AMAZON_INVENTORY_COLUMNS.join(","),
    buildAmazonRow(product, amazonListing, amazonImages),
  ].join("\n");
  const shopifyCsv = [
    SHOPIFY_PRODUCT_COLUMNS.join(","),
    ...buildShopifyRows(product, shopifyListing, shopifyImages),
  ].join("\n");

  // Pull image bytes for the ZIP. Cap at first 8 per platform so the
  // Worker memory stays bounded.
  const imageEntries: Array<{ name: string; data: Uint8Array }> = [];
  async function pullInto(key: string, prefix: string): Promise<void> {
    const obj = await env.R2.get(key);
    if (!obj) return;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    imageEntries.push({ name: `${prefix}/${key.split("/").pop()}`, data: bytes });
  }
  for (const a of assets.slice(0, 16)) {
    // R2 key is the URL path after the public host
    const url = a.r2Url;
    const r2Public = (env.R2_PUBLIC_URL ?? "").replace(/\/$/, "");
    const key = url.replace(`${r2Public}/`, "").replace(/^https?:\/\/[^/]+\//, "");
    await pullInto(key, `${a.platform}/${a.slot}`);
  }

  const enc = new TextEncoder();
  const zip = buildZip([
    { name: `${product.sku}/amazon.csv`, data: enc.encode(amazonCsv) },
    { name: `${product.sku}/shopify.csv`, data: enc.encode(shopifyCsv) },
    {
      name: `${product.sku}/manifest.json`,
      data: enc.encode(
        JSON.stringify(
          {
            sku: product.sku,
            tenant_id: input.tenantId,
            run_id: input.runId,
            generated_at: new Date().toISOString(),
            asset_count: assets.length,
            listing_surfaces: listings.map((l) => l.surface),
          },
          null,
          2
        )
      ),
    },
    ...imageEntries,
  ]);

  const zipKey = `tenant/${input.tenantId}/exports/${input.runId}/${product.sku}-bundle.zip`;
  await env.R2.put(zipKey, zip, {
    httpMetadata: { contentType: "application/zip" },
  });

  const presignedUrl = await presignGetUrl(env, zipKey, 7 * 24 * 3600);

  return {
    ok: true,
    zipKey,
    presignedUrl,
    manifestColumns: [...AMAZON_INVENTORY_COLUMNS, ...SHOPIFY_PRODUCT_COLUMNS],
    fileCount: 3 + imageEntries.length,
  };
}

const AMAZON_SLOT_ORDER = [
  "main",
  "lifestyle",
  "a_plus_feature_1",
  "a_plus_feature_2",
  "a_plus_feature_3_grid",
  "close_up",
  "comparison_grid",
];
const SHOPIFY_SLOT_ORDER = ["main", "lifestyle", "detail", "close_up", "banner"];

function slotOrderAmazon(slot: string): number {
  const i = AMAZON_SLOT_ORDER.indexOf(slot);
  return i === -1 ? 100 : i;
}
function slotOrderShopify(slot: string): number {
  const i = SHOPIFY_SLOT_ORDER.indexOf(slot);
  return i === -1 ? 100 : i;
}
