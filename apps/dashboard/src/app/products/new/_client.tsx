"use client";

/**
 * Phase H1 — self-serve product upload.
 *
 * Drop 1-10 reference images, fill in basic metadata, charge $0.50,
 * land in /launch?product_id=...
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { useApiFetch } from "@/lib/api";
import { compressImage, putToR2, extractExt } from "@/lib/uploader";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardContent,
  CardEyebrow,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

interface PendingFile {
  id: string;
  file: File;
  previewUrl: string;
  status: "pending" | "compressing" | "uploading" | "uploaded" | "error";
  bytesUploaded?: number;
  bytesTotal?: number;
  error?: string;
  uploadedKey?: string;
}

const CATEGORIES = [
  "fishing-rod",
  "drinkware",
  "handbag",
  "watch",
  "shoe",
  "apparel",
  "accessory",
  "other",
] as const;

const KINDS = [
  { value: "long_thin_vertical", label: "Long & vertical (rod, umbrella, pole)" },
  { value: "long_thin_horizontal", label: "Long & horizontal (skis, paddle)" },
  { value: "compact_square", label: "Compact square (handbag, drinkware, watch)" },
  { value: "compact_round", label: "Compact round (hat, beanie)" },
  { value: "horizontal_thin", label: "Horizontal thin (1.5–2.0 aspect)" },
  { value: "multi_component", label: "Multi-component set" },
  { value: "apparel_flat", label: "Apparel flat-lay (t-shirt, hoodie)" },
  { value: "accessory_small", label: "Accessory small (jewelry, keychain)" },
] as const;

const KIND_DEFAULT_FROM_UI_CATEGORY: Record<string, (typeof KINDS)[number]["value"]> = {
  "fishing-rod": "long_thin_vertical",
  drinkware: "compact_square",
  handbag: "compact_square",
  watch: "compact_square",
  shoe: "compact_square",
  apparel: "apparel_flat",
  accessory: "accessory_small",
  other: "compact_square",
};

export default function NewProductPageInner() {
  const router = useRouter();
  const apiFetch = useApiFetch();

  const [files, setFiles] = useState<PendingFile[]>([]);
  // Single bilingual name field (Issue 1). Detected language drives
  // which DB column carries the value alongside the always-populated
  // name_en — see handleSubmit. The "name_en is required" Zod schema
  // is preserved without migration; for Chinese inputs we duplicate
  // the value into name_en too so the NOT NULL column stays satisfied.
  const [name, setName] = useState("");
  // Issue 2 — optional long-form description. Drives SEO copy quality.
  // Cap matches Amazon listing-description max (2000 chars) and is
  // enforced by Zod server-side too.
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("fishing-rod");
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>(
    KIND_DEFAULT_FROM_UI_CATEGORY["fishing-rod"]
  );
  const [kindManuallySet, setKindManuallySet] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((prev) => {
      const next = [...prev];
      for (const file of accepted) {
        if (next.length >= 10) break;
        if (!extractExt(file)) continue;
        if (file.size > 20_000_000) continue;
        next.push({
          id: `${Date.now()}_${file.name}`,
          file,
          previewUrl: URL.createObjectURL(file),
          status: "pending",
        });
      }
      return next;
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/webp": [".webp"],
    },
    maxFiles: 10,
  });

  function removeFile(id: string) {
    setFiles((prev) => {
      const f = prev.find((x) => x.id === id);
      if (f) URL.revokeObjectURL(f.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  }

  const canSubmit =
    !submitting && name.trim().length >= 2 && category && files.length >= 1;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      // 1. Mint upload intent
      const exts = files
        .map((f) => extractExt(f.file))
        .filter((x): x is "jpg" | "jpeg" | "png" | "webp" => !!x);
      const intent = await apiFetch<{
        intent_id: string;
        urls: { key: string; putUrl: string; publicUrl: string }[];
      }>("/v1/products/upload-intent", {
        method: "POST",
        body: JSON.stringify({ extensions: exts }),
      });

      // 2. Compress + upload each file in parallel (max 4 at once)
      const queue = files.map((f, i) => ({ f, i, url: intent.urls[i] }));
      const uploadedKeys: string[] = [];
      const concurrency = 4;
      let cursor = 0;
      async function worker() {
        while (cursor < queue.length) {
          const item = queue[cursor++];
          if (!item) break;
          const { f, i, url } = item;
          setFiles((prev) =>
            prev.map((x, idx) => (idx === i ? { ...x, status: "compressing" } : x))
          );
          const compressed = await compressImage(f.file);
          setFiles((prev) =>
            prev.map((x, idx) => (idx === i ? { ...x, status: "uploading" } : x))
          );
          await putToR2(url.putUrl, compressed, (uploaded, total) => {
            setFiles((prev) =>
              prev.map((x, idx) =>
                idx === i ? { ...x, bytesUploaded: uploaded, bytesTotal: total } : x
              )
            );
          });
          setFiles((prev) =>
            prev.map((x, idx) =>
              idx === i ? { ...x, status: "uploaded", uploadedKey: url.key } : x
            )
          );
          uploadedKeys[i] = url.key;
        }
      }
      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      // 3. Finalize the product create
      // Detect CJK ideographs to route the single-field name into the
      // right DB column. name_en stays always-populated (required by
      // the Zod schema and the NOT NULL column constraint); when the
      // input is Chinese we duplicate it into name_zh too so the SEO
      // step has a language hint at launch time.
      const trimmedName = name.trim();
      const isCjk = /[一-鿿㐀-䶿]/.test(trimmedName);
      const created = await apiFetch<{
        product_id: string;
        sku: string;
        variant_id: string;
      }>("/v1/products", {
        method: "POST",
        body: JSON.stringify({
          intent_id: intent.intent_id,
          name_en: trimmedName,
          name_zh: isCjk ? trimmedName : undefined,
          description: description.trim() || undefined,
          category,
          kind,
          uploaded_keys: uploadedKeys,
        }),
      });

      router.push(`/launch?product_id=${created.product_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Add product · 添加产品"
        title="Onboard a new SKU"
        description="Drop 1-10 reference images plus the basic facts. We'll charge $0.50 to onboard the product, then you can launch it to Amazon and Shopify with one click. Reference images train the model on what your real product looks like."
      />
      <section className="px-6 md:px-12 py-12 max-w-7xl mx-auto">
        <form onSubmit={handleSubmit} className="grid grid-cols-12 gap-6">
          <Card className="col-span-12 md:col-span-7">
            <CardHeader>
              <div>
                <CardEyebrow>Product details · 详情</CardEyebrow>
                <CardTitle className="mt-1.5">Basic facts</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field label="Product name · 产品名 (Chinese or English)" required>
                <input
                  className="w-full px-4 h-11 rounded-m3-md bg-surface-container-low border ff-hairline focus:outline-none focus:ring-2 focus:ring-primary"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={200}
                  placeholder="渔王 Apex 12英尺海钓鱼竿  ·  CastMaster Apex 12ft Surf Rod"
                  required
                />
                <span className="md-typescale-body-small text-on-surface-variant block mt-1">
                  Type whichever language you have on hand. The other will
                  be generated automatically when you launch SEO copy.
                </span>
              </Field>
              <Field label="Description · 产品描述">
                <textarea
                  className="w-full px-4 py-3 rounded-m3-md bg-surface-container-low border ff-hairline focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={2000}
                  rows={5}
                  placeholder="What it does, materials, key features, what's in the box. The richer the input, the sharper the generated SEO copy. 描述产品功能、材质、卖点、包装。详细的输入能让生成的SEO文案更精准。"
                />
                <div className="flex items-baseline justify-between mt-1">
                  <span className="md-typescale-body-small text-on-surface-variant">
                    Optional but strongly recommended for high-quality
                    listings. Up to 2000 characters.
                  </span>
                  <span className="md-typescale-body-small font-mono text-on-surface-variant/60 tabular-nums">
                    {description.length} / 2000
                  </span>
                </div>
              </Field>
              <Field label="Category" required>
                <select
                  className="w-full px-4 h-11 rounded-m3-md bg-surface-container-low border ff-hairline focus:outline-none focus:ring-2 focus:ring-primary"
                  value={category}
                  onChange={(e) => {
                    const next = e.target.value;
                    setCategory(next);
                    if (!kindManuallySet) {
                      const suggested = KIND_DEFAULT_FROM_UI_CATEGORY[next];
                      if (suggested) setKind(suggested);
                    }
                  }}
                  required
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Image kind" required>
                <select
                  className="w-full px-4 h-11 rounded-m3-md bg-surface-container-low border ff-hairline focus:outline-none focus:ring-2 focus:ring-primary"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as (typeof KINDS)[number]["value"]);
                    setKindManuallySet(true);
                  }}
                  required
                >
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <div className="flex items-baseline justify-between gap-3 mt-1">
                  <span className="md-typescale-body-small text-on-surface-variant">
                    Drives the shape-aware crops. Auto-suggested from category;
                    override if your product is unusual.
                  </span>
                  {kindManuallySet && (
                    <button
                      type="button"
                      onClick={() => {
                        const suggested = KIND_DEFAULT_FROM_UI_CATEGORY[category];
                        if (suggested) setKind(suggested);
                        setKindManuallySet(false);
                      }}
                      className="md-typescale-body-small text-primary hover:underline shrink-0"
                    >
                      Reset to category default
                    </button>
                  )}
                </div>
              </Field>
            </CardContent>
            <CardFooter>
              <span className="md-typescale-label-small">$0.50 onboard fee</span>
              <Button
                type="submit"
                variant="accent"
                size="lg"
                disabled={!canSubmit}
              >
                {submitting ? "Onboarding…" : "Add product →"}
              </Button>
            </CardFooter>
          </Card>

          <Card className="col-span-12 md:col-span-5">
            <CardHeader>
              <div>
                <CardEyebrow>Reference images · 参考图</CardEyebrow>
                <CardTitle className="mt-1.5">{files.length} / 10</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div
                {...getRootProps()}
                className={cn(
                  "rounded-m3-md border-2 border-dashed px-6 py-12 text-center cursor-pointer transition-colors",
                  isDragActive
                    ? "border-primary bg-primary-container/20"
                    : "border-outline-variant hover:border-primary hover:bg-surface-container-low"
                )}
              >
                <input {...getInputProps()} />
                <div className="md-typescale-label-large text-on-surface-variant">
                  {isDragActive
                    ? "Drop here · 放下"
                    : "Drag images, or click to pick · 拖入或点击"}
                </div>
                <div className="md-typescale-body-small text-on-surface-variant/70 mt-2 font-mono">
                  JPG · PNG · WEBP · ≤20MB each · 1-10 files
                </div>
              </div>

              {files.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mt-4">
                  {files.map((f) => (
                    <FileTile
                      key={f.id}
                      file={f}
                      onRemove={() => removeFile(f.id)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {error && (
            <div className="col-span-12 rounded-m3-md border border-error/40 bg-error-container/40 px-5 py-4">
              <span className="ff-stamp-label">upload error</span>
              <span className="ml-3 md-typescale-body-medium font-mono text-error-on-container">
                {error}
              </span>
            </div>
          )}
        </form>
      </section>
    </>
  );
}

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="ff-stamp-label">
        {label}
        {required && <span className="text-primary ml-1">*</span>}
      </span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

function FileTile({
  file,
  onRemove,
}: {
  file: PendingFile;
  onRemove: () => void;
}) {
  const pct =
    file.bytesUploaded && file.bytesTotal
      ? Math.round((file.bytesUploaded / file.bytesTotal) * 100)
      : null;
  return (
    <div className="relative group rounded-m3-sm overflow-hidden border ff-hairline aspect-square">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={file.previewUrl}
        alt=""
        className="w-full h-full object-cover"
      />
      <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 via-transparent to-transparent">
        <div className="px-2 py-1 text-[0.6875rem] font-mono text-white">
          <Badge
            variant={
              file.status === "uploaded"
                ? "passed"
                : file.status === "error"
                  ? "flagged"
                  : "pending"
            }
            size="sm"
          >
            {file.status === "uploading" && pct !== null
              ? `${pct}%`
              : file.status}
          </Badge>
        </div>
      </div>
      {file.status === "pending" && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white text-xs hover:bg-black"
          aria-label="Remove"
        >
          ×
        </button>
      )}
    </div>
  );
}
