"use client";

/**
 * Issue 4 — bulk folder upload.
 *
 * Each top-level subfolder in the picked directory becomes one product.
 * Per folder:
 *   - 1-10 image files (jpg/png/webp) → reference images
 *   - optional `meta.json`        → { "name": "...", "description": "..." }
 *   - optional `description.txt`  → product description (raw text)
 *   - optional `name.txt`         → product name (raw text)
 *
 * Caps (validated client-side before any upload):
 *   - 50 products per batch
 *   - 10 images per product (matches single-onboard limit)
 *   - 100 MB total raw bundle (post-compression typically smaller)
 *   - 5 MB per image (matches existing upload-intent server check)
 *
 * The submit phase loops the existing /v1/products/upload-intent +
 * /v1/products endpoints once per product. Each row charges $0.50
 * separately so the wallet ledger stays accurate; we don't need a
 * batch-create endpoint for MVP.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useApiFetch } from "@/lib/api";
import {
  compressImage,
  putToR2,
  extractExt,
} from "@/lib/uploader";
import { formatCents } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardContent,
  CardEyebrow,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

const MAX_PRODUCTS = 50;
const MAX_IMAGES_PER_PRODUCT = 10;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_PER_IMAGE_BYTES = 5 * 1024 * 1024; // matches server intent check
const ONBOARD_FEE_CENTS = 50;

type ProductStatus =
  | "queued"
  | "uploading"
  | "creating"
  | "created"
  | "failed";

interface BulkProduct {
  folder: string;             // top-level folder name
  name: string;               // resolved name (meta.json > name.txt > folder)
  description: string | null; // resolved description (meta.json > description.txt > null)
  images: File[];             // image files for this product
  warnings: string[];         // validation warnings (image-count, etc.)
  status: ProductStatus;
  productId?: string;
  error?: string;
}

interface ParseResult {
  products: BulkProduct[];
  totalBytes: number;
  errors: string[]; // batch-level errors (over caps, no folders, etc.)
}

function isImageFile(file: File): boolean {
  const t = file.type.toLowerCase();
  return t === "image/jpeg" || t === "image/png" || t === "image/webp";
}

function topFolderOf(file: File): string | null {
  // webkitRelativePath looks like: "BulkBatch/sku-001/hero.jpg"
  // We want the IMMEDIATE child of the picked directory — index [1].
  // If only one path segment, treat the file as a stray (skip).
  const path = (file as File & { webkitRelativePath?: string })
    .webkitRelativePath;
  if (!path) return null;
  const parts = path.split("/");
  if (parts.length < 3) return null; // root-level file in picked dir, skip
  return parts[1];
}

function basenameOf(file: File): string {
  const path = (file as File & { webkitRelativePath?: string })
    .webkitRelativePath;
  if (!path) return file.name;
  const parts = path.split("/");
  return parts[parts.length - 1].toLowerCase();
}

async function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(file);
  });
}

async function parseFolders(fileList: FileList): Promise<ParseResult> {
  const buckets = new Map<string, File[]>();
  let totalBytes = 0;
  const errors: string[] = [];
  for (let i = 0; i < fileList.length; i++) {
    const f = fileList[i];
    const folder = topFolderOf(f);
    if (!folder) continue;
    if (f.size > MAX_PER_IMAGE_BYTES && isImageFile(f)) {
      errors.push(
        `${folder}/${f.name}: ${(f.size / 1_048_576).toFixed(1)} MB exceeds 5 MB per-image cap`
      );
      continue;
    }
    totalBytes += f.size;
    const arr = buckets.get(folder) ?? [];
    arr.push(f);
    buckets.set(folder, arr);
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    errors.push(
      `Total ${(totalBytes / 1_048_576).toFixed(
        1
      )} MB exceeds the 100 MB batch cap. Split into smaller batches or remove larger files.`
    );
  }
  if (buckets.size === 0) {
    errors.push(
      "No subfolders found. Place each product in its own folder, e.g. /BulkBatch/sku-001/hero.jpg"
    );
  }
  if (buckets.size > MAX_PRODUCTS) {
    errors.push(
      `Found ${buckets.size} folders; limit per batch is ${MAX_PRODUCTS}.`
    );
  }

  const products: BulkProduct[] = [];
  for (const [folder, files] of buckets) {
    const images = files.filter(isImageFile).slice(0, MAX_IMAGES_PER_PRODUCT);
    const meta = files.find((f) => basenameOf(f) === "meta.json");
    const descTxt = files.find((f) => basenameOf(f) === "description.txt");
    const nameTxt = files.find((f) => basenameOf(f) === "name.txt");

    let resolvedName = folder.replace(/[-_]+/g, " ");
    let resolvedDesc: string | null = null;
    if (meta) {
      try {
        const parsed = JSON.parse(await readTextFile(meta)) as {
          name?: string;
          description?: string;
        };
        if (typeof parsed.name === "string" && parsed.name.trim()) {
          resolvedName = parsed.name.trim();
        }
        if (
          typeof parsed.description === "string" &&
          parsed.description.trim()
        ) {
          resolvedDesc = parsed.description.trim();
        }
      } catch {
        // Bad JSON falls back to other sources
      }
    }
    if (!resolvedDesc && descTxt) {
      resolvedDesc = (await readTextFile(descTxt)).trim() || null;
    }
    if (resolvedName === folder.replace(/[-_]+/g, " ") && nameTxt) {
      const t = (await readTextFile(nameTxt)).trim();
      if (t) resolvedName = t;
    }

    const warnings: string[] = [];
    if (images.length === 0) {
      warnings.push("No image files — folder will be skipped.");
    } else if (files.filter(isImageFile).length > MAX_IMAGES_PER_PRODUCT) {
      warnings.push(
        `Trimmed to first ${MAX_IMAGES_PER_PRODUCT} of ${
          files.filter(isImageFile).length
        } images.`
      );
    }
    if (resolvedName.length < 2) {
      warnings.push("Name too short; using folder name.");
      resolvedName = folder;
    }

    products.push({
      folder,
      name: resolvedName,
      description: resolvedDesc,
      images,
      warnings,
      status: "queued",
    });
  }

  // Sort folders alphabetically for predictable display
  products.sort((a, b) => a.folder.localeCompare(b.folder));

  return { products, totalBytes, errors };
}

export default function BulkUploadPageInner() {
  const apiFetch = useApiFetch();
  const inputRef = useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [products, setProducts] = useState<BulkProduct[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  const eligibleCount = useMemo(
    () => products.filter((p) => p.images.length > 0).length,
    [products]
  );
  const skippedCount = products.length - eligibleCount;
  const estimatedFeeCents = eligibleCount * ONBOARD_FEE_CENTS;

  const onPick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;
      setParsing(true);
      setCompleted(false);
      try {
        const result = await parseFolders(fileList);
        setParsed(result);
        setProducts(result.products);
      } finally {
        setParsing(false);
      }
    },
    []
  );

  function reset() {
    setParsed(null);
    setProducts([]);
    setCompleted(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function setProductStatus(
    folder: string,
    patch: Partial<BulkProduct>
  ): void {
    setProducts((prev) =>
      prev.map((p) => (p.folder === folder ? { ...p, ...patch } : p))
    );
  }

  async function uploadOne(product: BulkProduct): Promise<void> {
    setProductStatus(product.folder, { status: "uploading", error: undefined });
    const exts = product.images
      .map(extractExt)
      .filter((x): x is "jpg" | "jpeg" | "png" | "webp" => !!x);
    const intent = await apiFetch<{
      intent_id: string;
      urls: { key: string; putUrl: string; publicUrl: string }[];
    }>("/v1/products/upload-intent", {
      method: "POST",
      body: JSON.stringify({ extensions: exts }),
    });

    const uploadedKeys: string[] = [];
    for (let i = 0; i < product.images.length; i++) {
      const url = intent.urls[i];
      const compressed = await compressImage(product.images[i]);
      await putToR2(url.putUrl, compressed);
      uploadedKeys[i] = url.key;
    }

    setProductStatus(product.folder, { status: "creating" });
    const isCjk = /[一-鿿㐀-䶿]/.test(product.name);
    const created = await apiFetch<{
      product_id: string;
      sku: string;
    }>("/v1/products", {
      method: "POST",
      body: JSON.stringify({
        intent_id: intent.intent_id,
        name_en: product.name,
        name_zh: isCjk ? product.name : undefined,
        description: product.description ?? undefined,
        // Server derives category + kind via Sonnet (Issue 3)
        uploaded_keys: uploadedKeys,
      }),
    });
    setProductStatus(product.folder, {
      status: "created",
      productId: created.product_id,
    });
  }

  async function submitAll() {
    setSubmitting(true);
    setCompleted(false);
    for (const product of products) {
      if (product.images.length === 0) continue;
      try {
        // Re-read latest snapshot in case state changed; we use folder
        // as the stable key.
        await uploadOne(product);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setProductStatus(product.folder, {
          status: "failed",
          error: msg,
        });
      }
    }
    setSubmitting(false);
    setCompleted(true);
  }

  return (
    <>
      <PageHeader
        eyebrow="Bulk add · 批量添加"
        title="Onboard a batch of SKUs"
        description={`Drop a folder where each subfolder is one product. We charge $${(
          ONBOARD_FEE_CENTS / 100
        ).toFixed(
          2
        )} per onboarded SKU. Cap: ${MAX_PRODUCTS} products and 100 MB total per batch.`}
      />

      <section className="px-6 md:px-12 py-12 max-w-7xl mx-auto space-y-6">
        {/* Folder picker + format help */}
        <Card>
          <CardHeader>
            <div>
              <CardEyebrow>Step 01 · 选择文件夹</CardEyebrow>
              <CardTitle className="mt-1.5">Pick a folder</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <input
              ref={inputRef}
              type="file"
              // @ts-expect-error - webkitdirectory is a standard browser
              // attribute that React's typed as non-standard; the cast
              // keeps TS happy without `as any`.
              webkitdirectory=""
              directory=""
              multiple
              onChange={onPick}
              className="hidden"
              id="bulk-folder-input"
            />
            <label
              htmlFor="bulk-folder-input"
              className={cn(
                "flex flex-col items-center justify-center gap-2 px-6 py-12 rounded-m3-md border-2 border-dashed cursor-pointer transition-colors",
                parsed
                  ? "border-outline-variant md-surface-container-low"
                  : "border-primary/40 hover:border-primary hover:bg-primary-container/20"
              )}
            >
              <span className="md-typescale-label-large text-on-surface">
                {parsing
                  ? "Reading folder…"
                  : parsed
                    ? "Replace with another folder"
                    : "Click to pick a folder"}
              </span>
              <span className="md-typescale-body-small text-on-surface-variant/70 font-mono">
                JPG · PNG · WEBP · ≤5 MB each · ≤100 MB total · ≤
                {MAX_PRODUCTS} products
              </span>
            </label>

            <details className="rounded-m3-sm md-surface-container-low border ff-hairline">
              <summary className="px-4 py-2 cursor-pointer md-typescale-label-medium">
                Folder layout reference
              </summary>
              <pre className="px-4 pb-3 pt-1 font-mono text-[0.6875rem] text-on-surface-variant whitespace-pre overflow-x-auto">
{`MyBatch/                 ← pick this folder
├─ sku-001/
│  ├─ hero.jpg           ← image (required, ≤10/product)
│  ├─ side.jpg
│  ├─ description.txt    ← optional product description
│  └─ meta.json          ← optional: {"name": "...", "description": "..."}
├─ sku-002/
│  ├─ front.png
│  └─ name.txt           ← optional fallback name
└─ ...

Resolution order for name: meta.json > name.txt > folder name
Resolution order for description: meta.json > description.txt > none`}
              </pre>
            </details>
          </CardContent>
        </Card>

        {/* Validation errors */}
        {parsed && parsed.errors.length > 0 && (
          <Card>
            <CardHeader>
              <div>
                <CardEyebrow className="text-error">
                  ⚠ Cannot proceed
                </CardEyebrow>
                <CardTitle className="mt-1.5">
                  Resolve these before uploading
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 md-typescale-body-medium font-mono">
                {parsed.errors.map((e) => (
                  <li key={e} className="text-error">
                    · {e}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={reset}
                className="mt-3 md-typescale-label-medium text-primary hover:underline"
              >
                ← Pick a different folder
              </button>
            </CardContent>
          </Card>
        )}

        {/* Preview + submit */}
        {parsed && parsed.errors.length === 0 && products.length > 0 && (
          <>
            <Card>
              <CardHeader>
                <div>
                  <CardEyebrow>Step 02 · 预览</CardEyebrow>
                  <CardTitle className="mt-1.5">
                    {eligibleCount} eligible products · {(
                      parsed.totalBytes / 1_048_576
                    ).toFixed(1)}
                    {" MB"}
                  </CardTitle>
                  {skippedCount > 0 && (
                    <div className="md-typescale-body-medium text-on-surface-variant mt-0.5">
                      {skippedCount} folder{skippedCount === 1 ? "" : "s"} will
                      be skipped (no images)
                    </div>
                  )}
                </div>
                <Badge variant="neutral" size="sm">
                  Estimated fee · {formatCents(estimatedFeeCents)}
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="md-surface-container-low border ff-hairline rounded-m3-md overflow-hidden divide-y ff-hairline">
                  {products.map((p) => (
                    <ProductRow key={p.folder} product={p} />
                  ))}
                </div>
              </CardContent>
              <CardFooter>
                <span className="md-typescale-label-small">
                  $0.50 × {eligibleCount} = {formatCents(estimatedFeeCents)}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={reset}
                    className="md-typescale-label-medium text-on-surface-variant hover:underline"
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <Button
                    type="button"
                    variant="accent"
                    size="lg"
                    onClick={submitAll}
                    disabled={submitting || eligibleCount === 0 || completed}
                  >
                    {submitting
                      ? "Uploading…"
                      : completed
                        ? "Done"
                        : `Onboard ${eligibleCount} →`}
                  </Button>
                </div>
              </CardFooter>
            </Card>

            {completed && (
              <Card>
                <CardHeader>
                  <div>
                    <CardEyebrow className="text-ff-jade-deep">
                      Batch complete · 完成
                    </CardEyebrow>
                    <CardTitle className="mt-1.5">
                      {products.filter((p) => p.status === "created").length} of{" "}
                      {eligibleCount} created
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="flex items-center gap-3">
                  <Link
                    href="/launch"
                    className="md-typescale-label-medium text-primary hover:underline"
                  >
                    Launch all in batch →
                  </Link>
                  <span className="text-on-surface-variant/40">·</span>
                  <Link
                    href="/library"
                    className="md-typescale-label-medium text-primary hover:underline"
                  >
                    View library →
                  </Link>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* When parsed but every folder skipped */}
        {parsed &&
          parsed.errors.length === 0 &&
          eligibleCount === 0 &&
          products.length > 0 && (
            <Card>
              <CardContent>
                <p className="md-typescale-body-medium text-error">
                  No folders contain images. Make sure each subfolder has at
                  least one .jpg / .png / .webp file.
                </p>
              </CardContent>
            </Card>
          )}
      </section>
    </>
  );
}

function ProductRow({ product }: { product: BulkProduct }) {
  const tone =
    product.status === "created"
      ? "passed"
      : product.status === "failed"
        ? "flagged"
        : product.status === "queued"
          ? "neutral"
          : "pending";
  const statusLabel: Record<ProductStatus, string> = {
    queued: "queued",
    uploading: "uploading…",
    creating: "creating…",
    created: "✓ created",
    failed: "✗ failed",
  };
  return (
    <div className="px-5 py-3 flex items-start gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="md-typescale-label-large text-on-surface">
            {product.name}
          </span>
          <span className="md-typescale-body-small font-mono text-[0.6875rem] text-on-surface-variant">
            {product.folder}
          </span>
        </div>
        <div className="md-typescale-body-small text-on-surface-variant mt-0.5">
          {product.images.length} image{product.images.length === 1 ? "" : "s"}
          {product.description &&
            ` · "${product.description.slice(0, 80)}${product.description.length > 80 ? "…" : ""}"`}
        </div>
        {product.warnings.length > 0 && (
          <ul className="mt-1 md-typescale-body-small text-ff-amber font-mono">
            {product.warnings.map((w) => (
              <li key={w}>· {w}</li>
            ))}
          </ul>
        )}
        {product.error && (
          <div className="mt-1 md-typescale-body-small text-error font-mono">
            {product.error}
          </div>
        )}
      </div>
      <Badge variant={tone} size="sm">
        {statusLabel[product.status]}
      </Badge>
    </div>
  );
}
