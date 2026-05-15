"use client";

/**
 * Phase H · 2026-05-14 — unified bulk-upload page with smart routing.
 *
 * Before: three surfaces (single / bulk / agentic) confused operators
 * because each had different rules about file layout.
 *
 * Now: one bulk surface that accepts a folder, a zip, OR a loose pile
 * of files. A router inspects the input:
 *
 *   - >= 2 distinct subfolders + >= 70% of images live in a subfolder
 *     ⇒ STRUCTURED: parse client-side, name = meta.json > name.txt > folder
 *
 *   - otherwise (loose images, ambiguous layout, single-folder dump)
 *     ⇒ AGENTIC: upload everything to R2, ask Sonnet to group into
 *     product manifests via /v1/products/agentic-classify, normalize
 *     into the same row shape as structured.
 *
 * Both paths feed the same review panel. Each row carries:
 *   • blocking errors (no images, missing name) → Submit disabled
 *   • soft warnings (no description, name looks like a slug) → yellow
 *
 * Operators can edit name + description inline to clear warnings
 * before submit, so we don't burn tokens on a launch that's missing
 * the inputs that drive listing quality.
 */

import { PageHeader } from "@/components/layout/page-header";
import { UploadModeTabs } from "@/components/products/upload-mode-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardEyebrow,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useApiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/format";
import { compressImage, extractExt, putToR2 } from "@/lib/uploader";
import { unpackZip } from "@/lib/zip-unpacker";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const MAX_PRODUCTS = 50;
const MAX_IMAGES_PER_PRODUCT = 10;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_PER_IMAGE_BYTES = 5 * 1024 * 1024;
const ONBOARD_FEE_CENTS = 50;

type ProductStatus = "queued" | "uploading" | "creating" | "created" | "failed";

type RoutingMode = "structured" | "agentic";

interface BulkProduct {
  id: string;
  folder: string;
  name: string;
  description: string | null;
  // Discriminator: structured rows hold raw Files awaiting upload;
  // agentic rows hold R2 keys we already uploaded during classify.
  pendingImages: File[];
  uploadedKeys: string[];
  // Computed by annotate() — kept on the row so the UI can re-render
  // without a separate memo per product.
  warnings: string[];
  blocking: string | null;
  status: ProductStatus;
  productId?: string;
  error?: string;
  // Only used by agentic rows so operators can spot low-confidence
  // groupings the classifier made.
  classifierConfidence?: number;
  classifierReason?: string;
}

interface ParseResult {
  mode: RoutingMode;
  products: BulkProduct[];
  totalBytes: number;
  errors: string[];
  classifierCostCents: number;
  unassigned: Array<{ path: string; reason: string }>;
}

function isImageFile(file: File): boolean {
  const t = file.type.toLowerCase();
  return t === "image/jpeg" || t === "image/png" || t === "image/webp";
}

function topFolderOf(file: File): string | null {
  const path = (file as File & { webkitRelativePath?: string })
    .webkitRelativePath;
  if (!path) return null;
  const parts = path.split("/");
  if (parts.length < 3) return null;
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

function detectMode(files: File[]): RoutingMode {
  const images = files.filter(isImageFile);
  if (images.length === 0) return "agentic";
  const folders = new Set<string>();
  let withFolder = 0;
  for (const f of images) {
    const folder = topFolderOf(f);
    if (folder) {
      folders.add(folder);
      withFolder++;
    }
  }
  // Heuristic: at least 2 distinct subfolders AND most images live in
  // one. Anything less and Sonnet does a better job inferring groups.
  if (folders.size >= 2 && withFolder / images.length >= 0.7) {
    return "structured";
  }
  return "agentic";
}

function annotate(p: BulkProduct): BulkProduct {
  const warnings: string[] = [];
  let blocking: string | null = null;
  const imageCount = p.pendingImages.length + p.uploadedKeys.length;
  if (imageCount === 0) {
    blocking = "No images attached — required to generate listings.";
  }
  if (imageCount > MAX_IMAGES_PER_PRODUCT) {
    warnings.push(
      `Only the first ${MAX_IMAGES_PER_PRODUCT} of ${imageCount} images will be used.`,
    );
  }
  const trimmedDesc = (p.description ?? "").trim();
  if (!trimmedDesc) {
    warnings.push(
      "No description — listing copy and grounding will be weak. Add one before launching.",
    );
  } else if (trimmedDesc.length < 40) {
    warnings.push("Description is very short — SEO copy will be thin.");
  }
  const trimmedName = p.name.trim();
  if (trimmedName.length < 2) {
    blocking = blocking ?? "Name is missing or too short.";
  } else if (
    /^(folder|sku[-_]?\d+|product[-_]?\d+|group[-_]?\d+)$/i.test(
      trimmedName.replace(/\s+/g, ""),
    )
  ) {
    warnings.push(
      "Name looks like a folder slug — consider editing to a real product name.",
    );
  }
  if (p.classifierConfidence !== undefined && p.classifierConfidence < 0.7) {
    warnings.push(
      `Classifier is unsure (${p.classifierConfidence.toFixed(2)})${
        p.classifierReason ? ` — ${p.classifierReason}` : ""
      }`,
    );
  }
  return { ...p, warnings, blocking };
}

async function parseStructured(files: File[]): Promise<ParseResult> {
  const buckets = new Map<string, File[]>();
  for (const f of files) {
    const folder = topFolderOf(f);
    if (!folder) continue;
    const arr = buckets.get(folder) ?? [];
    arr.push(f);
    buckets.set(folder, arr);
  }
  const errors: string[] = [];
  if (buckets.size > MAX_PRODUCTS) {
    errors.push(
      `Found ${buckets.size} folders; limit per batch is ${MAX_PRODUCTS}.`,
    );
  }
  const products: BulkProduct[] = [];
  for (const [folder, group] of buckets) {
    const images = group.filter(isImageFile).slice(0, MAX_IMAGES_PER_PRODUCT);
    const meta = group.find((f) => basenameOf(f) === "meta.json");
    const descTxt = group.find((f) => basenameOf(f) === "description.txt");
    const nameTxt = group.find((f) => basenameOf(f) === "name.txt");

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
        // ignore — fall through to txt files
      }
    }
    if (!resolvedDesc && descTxt) {
      resolvedDesc = (await readTextFile(descTxt)).trim() || null;
    }
    if (resolvedName === folder.replace(/[-_]+/g, " ") && nameTxt) {
      const t = (await readTextFile(nameTxt)).trim();
      if (t) resolvedName = t;
    }

    products.push({
      id: `s:${folder}`,
      folder,
      name: resolvedName,
      description: resolvedDesc,
      pendingImages: images,
      uploadedKeys: [],
      warnings: [],
      blocking: null,
      status: "queued",
    });
  }
  products.sort((a, b) => a.folder.localeCompare(b.folder));
  return {
    mode: "structured",
    products,
    totalBytes: 0,
    errors,
    classifierCostCents: 0,
    unassigned: [],
  };
}

type ApiFetch = <T>(input: string, init?: RequestInit) => Promise<T>;

async function classifyAgentic(
  files: File[],
  apiFetch: ApiFetch,
): Promise<ParseResult> {
  const imageFiles = files.filter(isImageFile);
  const errors: string[] = [];
  if (imageFiles.length === 0) {
    errors.push("No supported image files found.");
    return {
      mode: "agentic",
      products: [],
      totalBytes: 0,
      errors,
      classifierCostCents: 0,
      unassigned: [],
    };
  }

  const exts = imageFiles
    .map((f) => extractExt(f))
    .filter((x): x is "jpg" | "jpeg" | "png" | "webp" => !!x);
  const intent = await apiFetch<{
    intent_id: string;
    urls: { key: string; putUrl: string; publicUrl: string }[];
  }>("/v1/products/upload-intent", {
    method: "POST",
    body: JSON.stringify({ extensions: exts }),
  });

  const entries: Array<{ path: string; kind: "image"; r2_key: string }> = [];
  for (let i = 0; i < imageFiles.length; i++) {
    const f = imageFiles[i];
    const url = intent.urls[i];
    const compressed = await compressImage(f);
    await putToR2(url.putUrl, compressed);
    const path =
      (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
      f.name;
    entries.push({ path, kind: "image", r2_key: url.key });
  }

  const resp = await apiFetch<{
    products: Array<{
      name: string;
      description?: string;
      references: string[];
      confidence: number;
      reason?: string;
    }>;
    unassigned: Array<{ path: string; r2_key: string; reason: string }>;
    cost_cents: number;
  }>("/v1/products/agentic-classify", {
    method: "POST",
    body: JSON.stringify({ files: entries }),
  });

  const products: BulkProduct[] = resp.products
    .slice(0, MAX_PRODUCTS)
    .map((p, i) => ({
      id: `a:${i}:${p.name}`,
      folder: `Group ${i + 1}`,
      name: p.name,
      description: p.description ?? null,
      pendingImages: [],
      uploadedKeys: p.references,
      warnings: [],
      blocking: null,
      status: "queued",
      classifierConfidence: p.confidence,
      classifierReason: p.reason,
    }));

  if (resp.products.length > MAX_PRODUCTS) {
    errors.push(
      `Classifier produced ${resp.products.length} groups; only the first ${MAX_PRODUCTS} are kept.`,
    );
  }

  return {
    mode: "agentic",
    products,
    totalBytes: 0,
    errors,
    classifierCostCents: resp.cost_cents,
    unassigned: resp.unassigned.map((u) => ({
      path: u.path,
      reason: u.reason,
    })),
  };
}

export default function BulkUploadPageInner() {
  const apiFetch = useApiFetch();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const looseInputRef = useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsingNote, setParsingNote] = useState<string>("");
  const [products, setProducts] = useState<BulkProduct[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const blockingCount = useMemo(
    () => products.filter((p) => p.blocking).length,
    [products],
  );
  const warningCount = useMemo(
    () => products.reduce((n, p) => n + p.warnings.length, 0),
    [products],
  );
  const eligibleCount = products.length - blockingCount;
  const estimatedFeeCents = eligibleCount * ONBOARD_FEE_CENTS;

  const onPick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;
      setParsing(true);
      setCompleted(false);
      setParsingNote("Reading files…");
      try {
        // Step 1 — unpack zip if a single .zip is dropped
        let files: File[];
        const onlyFile = fileList.length === 1 ? fileList[0] : null;
        if (onlyFile && /\.zip$/i.test(onlyFile.name)) {
          setParsingNote("Unpacking zip…");
          const unpacked = await unpackZip(onlyFile);
          files = unpacked.files.map((u) => u.file);
        } else {
          files = Array.from(fileList);
        }

        // Step 2 — batch-level validation
        let totalBytes = 0;
        const errors: string[] = [];
        for (const f of files) {
          totalBytes += f.size;
          if (isImageFile(f) && f.size > MAX_PER_IMAGE_BYTES) {
            errors.push(
              `${f.name}: ${(f.size / 1_048_576).toFixed(1)} MB exceeds 5 MB cap`,
            );
          }
        }
        if (totalBytes > MAX_TOTAL_BYTES) {
          errors.push(
            `Total ${(totalBytes / 1_048_576).toFixed(1)} MB exceeds the 100 MB batch cap.`,
          );
        }
        const imageFiles = files.filter(isImageFile);
        if (imageFiles.length === 0) {
          errors.push(
            "No image files found. Bulk upload needs at least one .jpg / .png / .webp.",
          );
        }
        if (errors.length > 0) {
          setParsed({
            mode: "structured",
            products: [],
            totalBytes,
            errors,
            classifierCostCents: 0,
            unassigned: [],
          });
          setProducts([]);
          return;
        }

        // Step 3 — route to the right parser
        const mode = detectMode(files);
        let result: ParseResult;
        if (mode === "structured") {
          setParsingNote(
            `Parsing folder layout (${imageFiles.length} images)…`,
          );
          result = await parseStructured(files);
        } else {
          setParsingNote(
            `Uploading ${imageFiles.length} images for AI organization…`,
          );
          result = await classifyAgentic(files, apiFetch);
        }
        result.totalBytes = totalBytes;
        // Apply warnings + blocking annotations
        result.products = result.products.map(annotate);
        setParsed(result);
        setProducts(result.products);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(msg);
        setParsed({
          mode: "structured",
          products: [],
          totalBytes: 0,
          errors: [msg],
          classifierCostCents: 0,
          unassigned: [],
        });
        setProducts([]);
      } finally {
        setParsing(false);
        setParsingNote("");
      }
    },
    [apiFetch],
  );

  function reset() {
    setParsed(null);
    setProducts([]);
    setCompleted(false);
    setEditingId(null);
    if (folderInputRef.current) folderInputRef.current.value = "";
    if (zipInputRef.current) zipInputRef.current.value = "";
    if (looseInputRef.current) looseInputRef.current.value = "";
  }

  function setProductStatus(id: string, patch: Partial<BulkProduct>) {
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  }

  function setProductField(id: string, patch: Partial<BulkProduct>) {
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? annotate({ ...p, ...patch }) : p)),
    );
  }

  async function uploadOne(p: BulkProduct): Promise<void> {
    setProductStatus(p.id, { status: "uploading", error: undefined });
    const isCjk = /[一-鿿㐀-䶿]/.test(p.name);

    // Agentic path — images already in R2; create the product directly.
    if (p.uploadedKeys.length > 0) {
      setProductStatus(p.id, { status: "creating" });
      const created = await apiFetch<{ product_id: string; sku: string }>(
        "/v1/products",
        {
          method: "POST",
          body: JSON.stringify({
            name_en: p.name,
            name_zh: isCjk ? p.name : undefined,
            description: p.description ?? undefined,
            uploaded_keys: p.uploadedKeys,
          }),
        },
      );
      setProductStatus(p.id, {
        status: "created",
        productId: created.product_id,
      });
      return;
    }

    // Structured path — upload via fresh intent + presigned PUTs.
    const exts = p.pendingImages
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
    for (let i = 0; i < p.pendingImages.length; i++) {
      const url = intent.urls[i];
      const compressed = await compressImage(p.pendingImages[i]);
      await putToR2(url.putUrl, compressed);
      uploadedKeys[i] = url.key;
    }
    setProductStatus(p.id, { status: "creating" });
    const created = await apiFetch<{ product_id: string; sku: string }>(
      "/v1/products",
      {
        method: "POST",
        body: JSON.stringify({
          intent_id: intent.intent_id,
          name_en: p.name,
          name_zh: isCjk ? p.name : undefined,
          description: p.description ?? undefined,
          uploaded_keys: uploadedKeys,
        }),
      },
    );
    setProductStatus(p.id, {
      status: "created",
      productId: created.product_id,
    });
  }

  async function submitAll() {
    setSubmitting(true);
    setCompleted(false);
    for (const p of products) {
      if (p.blocking) continue;
      try {
        await uploadOne(p);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setProductStatus(p.id, { status: "failed", error: msg });
      }
    }
    setSubmitting(false);
    setCompleted(true);
  }

  return (
    <>
      <PageHeader
        eyebrow="Bulk upload · 批量添加"
        title="Onboard a batch of products"
        description={`Drop a folder where each subfolder is one product, a zip of the same, or just a pile of images and let AI group them. We charge $${(
          ONBOARD_FEE_CENTS / 100
        ).toFixed(
          2,
        )} per onboarded product · cap ${MAX_PRODUCTS} products / 100 MB per batch.`}
      />
      <UploadModeTabs />

      <section className="px-6 md:px-12 py-12 max-w-7xl mx-auto space-y-6">
        {/* Pickers */}
        <Card>
          <CardHeader>
            <div>
              <CardEyebrow>Step 01 · 选择文件</CardEyebrow>
              <CardTitle className="mt-1.5">Pick your files</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <PickerCard
                htmlFor="bulk-folder-input"
                icon="🗂"
                title="Folder"
                subtitle="Subfolder = product"
                disabled={parsing}
              />
              <PickerCard
                htmlFor="bulk-zip-input"
                icon="📦"
                title=".zip"
                subtitle="Same layout, zipped"
                disabled={parsing}
              />
              <PickerCard
                htmlFor="bulk-loose-input"
                icon="✨"
                title="Loose files"
                subtitle="Let AI organize"
                disabled={parsing}
              />
            </div>
            <input
              ref={folderInputRef}
              type="file"
              /* @ts-expect-error webkitdirectory is non-standard but supported */
              webkitdirectory=""
              directory=""
              multiple
              onChange={onPick}
              className="hidden"
              id="bulk-folder-input"
            />
            <input
              ref={zipInputRef}
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              onChange={onPick}
              className="hidden"
              id="bulk-zip-input"
            />
            <input
              ref={looseInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              onChange={onPick}
              className="hidden"
              id="bulk-loose-input"
            />

            {parsing && (
              <div className="rounded-m3-md md-surface-container-low border ff-hairline px-4 py-3 md-typescale-body-medium text-on-surface-variant">
                <span className="ff-stamp-label mr-2">Working</span>
                {parsingNote || "…"}
              </div>
            )}

            <details className="rounded-m3-sm md-surface-container-low border ff-hairline">
              <summary className="px-4 py-2 cursor-pointer md-typescale-label-medium">
                Folder layout reference (for Folder + .zip modes)
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
Resolution order for description: meta.json > description.txt > none

Loose-files mode skips this — Sonnet groups files by filename + visual cues.`}
              </pre>
            </details>
          </CardContent>
        </Card>

        {/* Batch-level errors */}
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
                ← Pick different files
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
                  <CardEyebrow>
                    Step 02 · 预览 ·{" "}
                    {parsed.mode === "structured"
                      ? "Structured parse"
                      : "AI-organized"}
                  </CardEyebrow>
                  <CardTitle className="mt-1.5">
                    {products.length} product{products.length === 1 ? "" : "s"}{" "}
                    detected · {(parsed.totalBytes / 1_048_576).toFixed(1)} MB
                  </CardTitle>
                  <div className="md-typescale-body-medium text-on-surface-variant mt-0.5">
                    {blockingCount > 0 && (
                      <span className="text-error mr-3">
                        {blockingCount} blocking
                      </span>
                    )}
                    {warningCount > 0 && (
                      <span className="text-ff-amber mr-3">
                        {warningCount} warning
                        {warningCount === 1 ? "" : "s"}
                      </span>
                    )}
                    {blockingCount === 0 && warningCount === 0 && (
                      <span className="text-ff-jade-deep">
                        ✓ All rows ready
                      </span>
                    )}
                  </div>
                </div>
                <Badge variant="neutral" size="sm">
                  Onboard fee · {formatCents(estimatedFeeCents)}
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="md-surface-container-low border ff-hairline rounded-m3-md overflow-hidden divide-y ff-hairline">
                  {products.map((p) => (
                    <ProductRow
                      key={p.id}
                      product={p}
                      editing={editingId === p.id}
                      onEditStart={() => setEditingId(p.id)}
                      onEditCancel={() => setEditingId(null)}
                      onSave={(name, description) => {
                        setProductField(p.id, {
                          name,
                          description: description.trim() || null,
                        });
                        setEditingId(null);
                      }}
                    />
                  ))}
                </div>
                {parsed.mode === "agentic" && parsed.unassigned.length > 0 && (
                  <details className="mt-3 rounded-m3-sm md-surface-container-low border ff-hairline">
                    <summary className="px-4 py-2 cursor-pointer md-typescale-label-medium">
                      {parsed.unassigned.length} unassigned file
                      {parsed.unassigned.length === 1 ? "" : "s"}
                    </summary>
                    <ul className="px-4 pb-3 pt-1 font-mono text-[0.6875rem] text-on-surface-variant space-y-1">
                      {parsed.unassigned.slice(0, 20).map((u) => (
                        <li key={u.path}>
                          · {u.path} — {u.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </CardContent>
              <CardFooter>
                <span className="md-typescale-label-small">
                  ${(ONBOARD_FEE_CENTS / 100).toFixed(2)} × {eligibleCount} ={" "}
                  {formatCents(estimatedFeeCents)}
                  {parsed.classifierCostCents > 0 && (
                    <> · classifier {formatCents(parsed.classifierCostCents)}</>
                  )}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={reset}
                    className="md-typescale-label-medium text-on-surface-variant hover:underline"
                    disabled={submitting}
                  >
                    Start over
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
                        : blockingCount > 0
                          ? `Onboard ${eligibleCount} (${blockingCount} skipped)`
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
      </section>
    </>
  );
}

function PickerCard({
  htmlFor,
  icon,
  title,
  subtitle,
  disabled,
}: {
  htmlFor: string;
  icon: string;
  title: string;
  subtitle: string;
  disabled: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        "flex flex-col items-center justify-center gap-1 px-4 py-6 rounded-m3-md border-2 border-dashed cursor-pointer transition-colors",
        disabled
          ? "border-outline-variant md-surface-container-low pointer-events-none opacity-50"
          : "border-primary/40 hover:border-primary hover:bg-primary-container/20",
      )}
    >
      <span className="text-2xl" aria-hidden>
        {icon}
      </span>
      <span className="md-typescale-label-large text-on-surface">{title}</span>
      <span className="md-typescale-body-small text-on-surface-variant/70 font-mono text-center">
        {subtitle}
      </span>
    </label>
  );
}

function ProductRow({
  product,
  editing,
  onEditStart,
  onEditCancel,
  onSave,
}: {
  product: BulkProduct;
  editing: boolean;
  onEditStart: () => void;
  onEditCancel: () => void;
  onSave: (name: string, description: string) => void;
}) {
  const [draftName, setDraftName] = useState(product.name);
  const [draftDesc, setDraftDesc] = useState(product.description ?? "");
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
  const imageCount = product.pendingImages.length + product.uploadedKeys.length;

  return (
    <div
      className={cn(
        "px-5 py-3 flex items-start gap-4",
        product.blocking && "bg-error-container/20",
        !product.blocking && product.warnings.length > 0 && "bg-ff-amber/5",
      )}
    >
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="space-y-2">
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              className="w-full px-3 h-9 rounded-m3-sm bg-surface-container-low border ff-hairline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary md-typescale-label-large"
              placeholder="Product name"
              maxLength={200}
            />
            <textarea
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-m3-sm bg-surface-container-low border ff-hairline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary md-typescale-body-medium resize-y"
              placeholder="Description (highly recommended — drives SEO quality)"
              maxLength={10000}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => onSave(draftName, draftDesc)}>
                Save
              </Button>
              <button
                type="button"
                onClick={() => {
                  setDraftName(product.name);
                  setDraftDesc(product.description ?? "");
                  onEditCancel();
                }}
                className="px-3 h-8 rounded-m3-full md-typescale-label-medium text-on-surface-variant hover:text-on-surface"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="md-typescale-label-large text-on-surface">
                {product.name || "(no name)"}
              </span>
              <span className="md-typescale-body-small font-mono text-[0.6875rem] text-on-surface-variant">
                {product.folder}
              </span>
              {product.classifierConfidence !== undefined && (
                <span className="md-typescale-body-small font-mono text-[0.6875rem] text-on-surface-variant">
                  · conf {product.classifierConfidence.toFixed(2)}
                </span>
              )}
            </div>
            <div className="md-typescale-body-small text-on-surface-variant mt-0.5">
              {imageCount} image{imageCount === 1 ? "" : "s"}
              {product.description &&
                ` · "${product.description.slice(0, 80)}${
                  product.description.length > 80 ? "…" : ""
                }"`}
            </div>
            {product.blocking && (
              <div className="mt-1 md-typescale-body-small text-error font-mono">
                ✗ {product.blocking}
              </div>
            )}
            {product.warnings.length > 0 && (
              <ul className="mt-1 md-typescale-body-small text-ff-amber font-mono space-y-0.5">
                {product.warnings.map((w) => (
                  <li key={w}>⚠ {w}</li>
                ))}
              </ul>
            )}
            {product.error && (
              <div className="mt-1 md-typescale-body-small text-error font-mono">
                {product.error}
              </div>
            )}
          </>
        )}
      </div>
      <div className="flex flex-col items-end gap-2 shrink-0">
        <Badge variant={tone} size="sm">
          {statusLabel[product.status]}
        </Badge>
        {!editing && product.status === "queued" && (
          <button
            type="button"
            onClick={onEditStart}
            className="md-typescale-label-medium text-primary hover:underline"
          >
            ✎ Edit
          </button>
        )}
      </div>
    </div>
  );
}
