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
import { toast } from "sonner";
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
import { ErrorState } from "@/components/ui/error-state";
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

// Issue 3 — category and image-kind constants used to live here so
// the form could expose them as <select>s. Now derived server-side
// via Sonnet (apps/mcp-server/src/lib/derive-product-metadata.ts);
// the canonical enums live alongside the deriver.

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
  // Issue 3 — category and kind are derived server-side from name +
  // description (Sonnet) instead of asked of the user. Removed from the
  // form. Worker still accepts manual values (integration tests / a
  // future "edit category" page); the dashboard simply omits them.
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((prev) => {
      const next = [...prev];
      const skipped: string[] = [];
      for (const file of accepted) {
        if (next.length >= 10) {
          skipped.push(`${file.name} (cap is 10 files)`);
          continue;
        }
        if (!extractExt(file)) {
          skipped.push(`${file.name} (only JPG/PNG/WEBP allowed)`);
          continue;
        }
        if (file.size > 20_000_000) {
          skipped.push(`${file.name} (>20 MB)`);
          continue;
        }
        next.push({
          id: `${Date.now()}_${file.name}`,
          file,
          previewUrl: URL.createObjectURL(file),
          status: "pending",
        });
      }
      if (skipped.length > 0) {
        toast.error(`Skipped ${skipped.length} file${skipped.length === 1 ? "" : "s"}: ${skipped.join("; ")}`);
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

  const errorFiles = files.filter((f) => f.status === "error");
  const canSubmit =
    !submitting &&
    name.trim().length >= 2 &&
    files.length >= 1 &&
    errorFiles.length === 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);

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

      // P1-3 — per-file try/catch so a single failed upload doesn't
      // tank the whole batch. The worker keeps draining the queue;
      // the failed tile shows its error inline. Submit is blocked
      // (canSubmit re-checks errorFiles) until the user retries or
      // removes the bad ones.
      const queue = files.map((f, i) => ({ f, i, url: intent.urls[i] }));
      const uploadedKeys: string[] = [];
      let failedCount = 0;
      const concurrency = 4;
      let cursor = 0;
      async function worker() {
        while (cursor < queue.length) {
          const item = queue[cursor++];
          if (!item) break;
          const { f, i, url } = item;
          try {
            setFiles((prev) =>
              prev.map((x, idx) =>
                idx === i ? { ...x, status: "compressing", error: undefined } : x
              )
            );
            const compressed = await compressImage(f.file);
            setFiles((prev) =>
              prev.map((x, idx) =>
                idx === i ? { ...x, status: "uploading" } : x
              )
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
          } catch (uploadErr) {
            failedCount++;
            const msg =
              uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
            setFiles((prev) =>
              prev.map((x, idx) =>
                idx === i ? { ...x, status: "error", error: msg } : x
              )
            );
          }
        }
      }
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      if (failedCount > 0) {
        toast.error(
          `${failedCount} of ${files.length} image${files.length === 1 ? "" : "s"} failed to upload — remove or retry.`
        );
        setSubmitting(false);
        return;
      }

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
        category?: string;
        kind?: string;
      }>("/v1/products", {
        method: "POST",
        body: JSON.stringify({
          intent_id: intent.intent_id,
          name_en: trimmedName,
          name_zh: isCjk ? trimmedName : undefined,
          description: description.trim() || undefined,
          // category & kind intentionally omitted — server derives via Sonnet
          uploaded_keys: uploadedKeys,
        }),
      });

      toast.success(`Onboarded "${trimmedName}" — opening launch wizard.`);
      router.push(`/launch?product_id=${created.product_id}`);
    } catch (err) {
      setSubmitError(err);
      setSubmitting(false);
    }
  }

  function retryFile(id: string) {
    setFiles((prev) =>
      prev.map((x) =>
        x.id === id ? { ...x, status: "pending", error: undefined } : x
      )
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Add product · 添加产品"
        title="Onboard a new SKU"
        description="Drop 1-10 reference images plus the basic facts. We'll charge $0.50 to onboard the product, then you can launch it to Amazon and Shopify with one click. Reference images train the model on what your real product looks like."
      />
      <section className="px-6 md:px-12 pt-2 max-w-7xl mx-auto">
        <a
          href="/products/bulk"
          className="md-typescale-label-medium text-primary hover:underline inline-flex items-center gap-1.5"
        >
          Or bulk-upload a folder of SKUs →
        </a>
      </section>
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
                  className="w-full px-4 h-11 rounded-m3-md bg-surface-container-low border ff-hairline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={200}
                  placeholder="渔王 Apex 12英尺海钓鱼竿  ·  CastMaster Apex 12ft Surf Rod"
                  required
                />
                <div className="flex items-baseline justify-between mt-1 gap-3">
                  <span className="md-typescale-body-small text-on-surface-variant">
                    Type whichever language you have on hand. The other will
                    be generated automatically when you launch SEO copy.
                  </span>
                  <span
                    className={cn(
                      "md-typescale-body-small font-mono tabular-nums shrink-0",
                      name.length > 180
                        ? "text-ff-amber"
                        : "text-on-surface-variant/60"
                    )}
                  >
                    {name.length} / 200
                  </span>
                </div>
              </Field>
              <Field label="Description · 产品描述">
                <textarea
                  className="w-full px-4 py-3 rounded-m3-md bg-surface-container-low border ff-hairline focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={10000}
                  rows={6}
                  placeholder="What it does, materials, key features, what's in the box. The richer the input, the sharper the generated SEO copy. Paste a full supplier spec sheet if you have one — we use everything. 描述产品功能、材质、卖点、包装。详细的输入能让生成的SEO文案更精准。"
                />
                <div className="flex items-baseline justify-between mt-1">
                  <span className="md-typescale-body-small text-on-surface-variant">
                    Optional but strongly recommended. Paste your full
                    supplier spec sheet — up to 10,000 characters.
                  </span>
                  <span
                    className={cn(
                      "md-typescale-body-small font-mono tabular-nums",
                      description.length > 9500
                        ? "text-ff-amber"
                        : "text-on-surface-variant/60"
                    )}
                  >
                    {description.length.toLocaleString()} / 10,000
                  </span>
                </div>
              </Field>
              <div className="rounded-m3-md md-surface-container-low border ff-hairline px-4 py-3 md-typescale-body-small text-on-surface-variant flex items-start gap-3">
                <span aria-hidden className="text-primary text-base leading-none mt-0.5">
                  ✦
                </span>
                <span>
                  <span className="text-on-surface md-typescale-label-medium block mb-0.5">
                    Category &amp; image-shape are auto-classified
                  </span>
                  We read your name and description and pick the right
                  category + crop shape for you. You can edit them later
                  on the product page if the AI guesses wrong.
                </span>
              </div>
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
                      onRetry={() => retryFile(f.id)}
                    />
                  ))}
                </div>
              )}
              {errorFiles.length > 0 && (
                <p className="md-typescale-body-small text-error mt-2">
                  {errorFiles.length} image{errorFiles.length === 1 ? "" : "s"}{" "}
                  failed to upload. Remove or click "retry" before submitting.
                </p>
              )}
            </CardContent>
          </Card>

          {submitError !== null && (
            <div className="col-span-12">
              <ErrorState
                title="Couldn't onboard this product"
                error={submitError}
                onRetry={() => setSubmitError(null)}
              />
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
  onRetry,
}: {
  file: PendingFile;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const pct =
    file.bytesUploaded && file.bytesTotal
      ? Math.round((file.bytesUploaded / file.bytesTotal) * 100)
      : null;
  return (
    <div
      className="relative group rounded-m3-sm overflow-hidden border ff-hairline aspect-square"
      title={file.error ?? file.file.name}
    >
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
      {(file.status === "pending" || file.status === "error") && (
        <div className="absolute top-1 right-1 flex gap-1">
          {file.status === "error" && (
            <button
              type="button"
              onClick={onRetry}
              className="h-6 px-2 rounded-full bg-primary/90 text-primary-on text-[0.625rem] font-mono hover:bg-primary"
              aria-label="Retry"
              title="Retry upload"
            >
              ↻
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="h-6 w-6 rounded-full bg-black/60 text-white text-xs hover:bg-black"
            aria-label="Remove"
            title="Remove"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
