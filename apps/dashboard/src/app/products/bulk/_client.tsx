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
// 15 MB per image (was 5 MB) — matches the worker's per-object cap and stops
// rejecting ordinary 5-6 MB HD photos. compressImage() downscales anything
// larger before the R2 PUT, so this is the validation gate, not a quality knob.
const MAX_PER_IMAGE_BYTES = 15 * 1024 * 1024;
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

// A .docx is a zip with the body text in word/document.xml. Vendors almost
// always send product descriptions as Word docs, so reading them is the
// difference between "No description" on every row and grounded listing copy.
// We strip the OOXML tags, turning </w:p> + <w:br> into line breaks so the
// text stays readable, and decode the handful of XML entities Word emits.
async function readDocxText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const doc = zip.file("word/document.xml");
  if (!doc) return "";
  const xml = await doc.async("string");
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const DESC_TEXT_EXT = /\.(txt|md|markdown|text)$/i;
const DESC_DOCX_EXT = /\.docx$/i;
// Keywords (EN + zh) that mark a file as "this is the description". Vendor
// batches name them all sorts of ways — description.txt, 产品描述.docx,
// <folder name>.md, 说明.txt — so we score candidates instead of demanding an
// exact filename.
const DESC_KEYWORDS =
  /(description|descr|desc|detail|readme|about|copy|文案|描述|说明|详情|介绍|产品)/i;

function isDescriptionCandidate(file: File): boolean {
  const b = basenameOf(file);
  return DESC_TEXT_EXT.test(b) || DESC_DOCX_EXT.test(b);
}

// Resolve a product description from whatever text/Word file the operator
// dropped in the folder — not just a literal `description.txt`. Order:
// keyword-named files first, then a file named like the folder, then a docx
// (vendors default to Word), then the largest remaining candidate. Reads in
// score order and returns the first non-empty body.
async function resolveDescriptionFromFolder(
  group: File[],
  folder: string,
): Promise<string | null> {
  const candidates = group.filter(isDescriptionCandidate);
  if (candidates.length === 0) return null;

  const folderSlug = folder.toLowerCase().replace(/[\s_-]+/g, "");
  const score = (f: File): number => {
    const b = basenameOf(f);
    const stem = b.replace(/\.[^.]+$/, "");
    let s = 0;
    if (DESC_KEYWORDS.test(stem)) s += 100;
    if (stem.replace(/[\s_-]+/g, "") === folderSlug) s += 60;
    if (DESC_DOCX_EXT.test(b)) s += 10; // vendor descriptions are usually Word
    s += Math.min(f.size, 50_000) / 50_000; // tie-break toward more content
    return s;
  };
  candidates.sort((a, b) => score(b) - score(a));

  for (const c of candidates) {
    try {
      const text = DESC_DOCX_EXT.test(basenameOf(c))
        ? await readDocxText(c)
        : await readTextFile(c);
      const trimmed = text.trim();
      if (trimmed) return trimmed;
    } catch {
      // Unreadable candidate (corrupt docx, encoding) — try the next one.
    }
  }
  return null;
}

// Recursively materialise the files from a drag-and-drop. Folder drops arrive
// as FileSystemEntry trees (NOT a flat FileList), and the resulting File
// objects have no webkitRelativePath — so we synthesize one that mirrors what
// the <input webkitdirectory> picker produces (Root/subfolder/file), letting
// the SAME parseStructured() bucketing work for dropped folders.
function walkDropEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: File[],
): Promise<void> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file(
        (file) => {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          try {
            Object.defineProperty(file, "webkitRelativePath", {
              value: rel,
              writable: false,
            });
          } catch {
            // Some browsers make the prop non-configurable; the original
            // (empty) value just routes this file agentic — acceptable.
          }
          out.push(file);
          resolve();
        },
        () => resolve(),
      );
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const all: FileSystemEntry[] = [];
      const dirPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      const readBatch = () => {
        // readEntries returns at most 100 entries per call — loop until empty.
        reader.readEntries(
          async (batch) => {
            if (batch.length === 0) {
              for (const child of all) await walkDropEntry(child, dirPrefix, out);
              resolve();
            } else {
              all.push(...batch);
              readBatch();
            }
          },
          () => resolve(),
        );
      };
      readBatch();
    } else {
      resolve();
    }
  });
}

async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  // webkitGetAsEntry() MUST be called synchronously before any await — the
  // DataTransferItemList is emptied once the drop handler yields. Capture all
  // entries first, then traverse.
  const entries: FileSystemEntry[] = [];
  const items = dt.items;
  if (items && items.length && typeof items[0].webkitGetAsEntry === "function") {
    for (let i = 0; i < items.length; i++) {
      const e = items[i].webkitGetAsEntry?.();
      if (e) entries.push(e);
    }
  }
  if (entries.length === 0) {
    // No entry API (or plain file drop) — fall back to the flat file list.
    return dt.files ? Array.from(dt.files) : [];
  }
  const out: File[] = [];
  const onlyDir =
    entries.length === 1 && entries[0].isDirectory ? entries[0] : null;
  if (onlyDir) {
    // One folder dropped → its name is the root, children are products
    // (mirrors picking the parent folder in the file dialog).
    await walkDropEntry(onlyDir, "", out);
  } else {
    // Multiple folders / loose files → wrap under a synthetic root so each
    // top-level folder becomes a product bucket.
    for (const e of entries) await walkDropEntry(e, "DroppedBatch", out);
  }
  return out;
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
        // ignore — fall through to description files
      }
    }
    // Fall back to any description file in the folder — .txt, .md, .docx, or a
    // file named after the product — not just a literal description.txt.
    if (!resolvedDesc) {
      resolvedDesc = await resolveDescriptionFromFolder(group, folder);
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
  const [dragOver, setDragOver] = useState(false);

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

  // Shared ingest path for BOTH the file pickers and drag-and-drop. Takes a
  // flat File[] (drop traversal + picker both produce this) and runs the same
  // unzip → validate → route → annotate pipeline.
  const ingest = useCallback(
    async (input: File[]) => {
      if (input.length === 0) return;
      setParsing(true);
      setCompleted(false);
      setParsingNote("Reading files…");
      try {
        // Step 1 — unpack zip if a single .zip is dropped
        let files: File[];
        const onlyFile = input.length === 1 ? input[0] : null;
        if (onlyFile && /\.zip$/i.test(onlyFile.name)) {
          setParsingNote("Unpacking zip…");
          const unpacked = await unpackZip(onlyFile);
          files = unpacked.files.map((u) => u.file);
        } else {
          files = input;
        }

        // Step 2 — batch-level validation
        let totalBytes = 0;
        const errors: string[] = [];
        for (const f of files) {
          totalBytes += f.size;
          if (isImageFile(f) && f.size > MAX_PER_IMAGE_BYTES) {
            errors.push(
              `${f.name}: ${(f.size / 1_048_576).toFixed(1)} MB exceeds the 15 MB per-image cap`,
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

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;
      void ingest(Array.from(fileList));
    },
    [ingest],
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (parsing) return;
      // Must read the entries synchronously (filesFromDrop captures them before
      // its first await) — the DataTransfer is emptied once the handler yields.
      const files = await filesFromDrop(e.dataTransfer);
      if (files.length === 0) {
        toast.error(
          "Couldn't read the dropped item. Try the pickers below, or drop a folder / .zip.",
        );
        return;
      }
      void ingest(files);
    },
    [ingest, parsing],
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
    // No intent_id (the shared classify intent isn't per-product); the
    // server validates the keys by tenant-prefix. The Idempotency-Key
    // (stable per product, derived from its first R2 key) makes the
    // apiFetch auto-retry safe — a lost response won't double-charge.
    if (p.uploadedKeys.length > 0) {
      setProductStatus(p.id, { status: "creating" });
      const created = await apiFetch<{ product_id: string; sku: string }>(
        "/v1/products",
        {
          method: "POST",
          headers: { "Idempotency-Key": `product:${p.uploadedKeys[0]}` },
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
        // Idempotency-Key keyed on the (unique, per-product) intent id so
        // the apiFetch auto-retry can't double-charge / duplicate on a
        // lost response.
        headers: { "Idempotency-Key": `product:${intent.intent_id}` },
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

  // Bounded-concurrency pool (D2, 2026-06-08). The old sequential loop took
  // ~N × per-product time and timed out the browser/Worker on 20+ products.
  // Run a few uploads at once instead. Kept modest (3) so we stay well under
  // the Worker rate limit — paired with the apiFetch 429/5xx auto-retry, this
  // absorbs bursts without a server-side change. Each create carries a stable
  // Idempotency-Key, so a retried request can't double-charge.
  const SUBMIT_CONCURRENCY = 3;

  async function submitAll() {
    setSubmitting(true);
    setCompleted(false);
    // D6-lite: skip rows already created (e.g. a re-submit after a partial
    // failure) so we never re-charge / duplicate a product within the session.
    const queue = products.filter((p) => !p.blocking && p.status !== "created");
    let cursor = 0;
    const runNext = async (): Promise<void> => {
      while (cursor < queue.length) {
        const p = queue[cursor++];
        try {
          await uploadOne(p);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setProductStatus(p.id, { status: "failed", error: msg });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(SUBMIT_CONCURRENCY, queue.length) }, () => runNext())
    );
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
            {/* Drop zone — drag a product folder or .zip anywhere in here.
                Folder drops are traversed via the FileSystem entry API so
                nested subfolders + their description files come through. */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!parsing) setDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragOver(false);
              }}
              onDrop={onDrop}
              className={cn(
                "rounded-m3-md border-2 border-dashed transition-colors p-4",
                dragOver
                  ? "border-primary bg-primary-container/20"
                  : "border-outline-variant",
              )}
            >
              <div className="text-center mb-3 md-typescale-body-small text-on-surface-variant">
                <span aria-hidden className="mr-1">
                  ⬇
                </span>
                Drag &amp; drop a product folder or a <code>.zip</code> here — or
                choose below
              </div>
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
                {`MyBatch/                 ← pick this folder (or drag it in)
├─ sku-001/
│  ├─ hero.jpg           ← image (required, ≤10/product)
│  ├─ side.jpg
│  ├─ description.docx   ← optional description (.docx / .txt / .md)
│  └─ meta.json          ← optional: {"name": "...", "description": "..."}
├─ sku-002/
│  ├─ front.png
│  └─ 产品说明.md        ← any .txt/.md/.docx works (incl. folder-named)
└─ ...

Resolution order for name: meta.json > name.txt > folder name
Description: meta.json > any .txt/.md/.docx in the folder (keyword- or
folder-named files win) > none

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
