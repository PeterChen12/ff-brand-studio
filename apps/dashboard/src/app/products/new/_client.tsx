"use client";

/**
 * Phase H1 — self-serve product upload + Phase H · 2026-05-13 consolidated
 * quick-launch flow.
 *
 * Single form: image drop + name + description → ONE button "Launch".
 * Tenant defaults silently drive marketplaces / output language /
 * quality preset (set in Settings → Brand profile). Button shows live
 * pipeline-phase progress during the 90-120s run. On success, redirects
 * to /library?focus=<product_id> which auto-opens the just-launched
 * product in a storefront-style detail view.
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
import { ErrorState } from "@/components/ui/error-state";
import { useApiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useTenant } from "@/lib/tenant-context";
import { compressImage, extractExt, putToR2 } from "@/lib/uploader";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

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

// Phase-to-percent mapping for the launch progress UI. Derived from
// the setPhase() calls in pipeline/index.ts plus the SEO/grounding
// stages that fire after the production pipeline in launch_pipeline.ts.
const PHASE_PERCENT: Record<string, number> = {
  // Pre-launch (client-side)
  uploading: 5,
  creating: 10,
  // Production pipeline phases (server-side)
  passthrough: 13,
  cleanup: 18,
  derive: 28,
  refine_all_crops: 55,
  lifestyle: 70,
  composites: 80,
  banner: 87,
  write_slots: 92,
  // SEO + grounding (in launch_pipeline.ts after the production pipeline)
  seo: 96,
  grounding: 98,
  // Terminal states
  succeeded: 100,
  hitl_blocked: 100,
  cost_capped: 100,
  failed: 100,
};

const PHASE_LABEL: Record<string, string> = {
  uploading: "Uploading images",
  creating: "Creating product",
  passthrough: "Checking input quality",
  cleanup: "Cleaning up reference",
  derive: "Deriving crops",
  refine_all_crops: "Refining all crops",
  lifestyle: "Rendering lifestyle scene",
  composites: "Building infographic slots",
  banner: "Building hero banner",
  write_slots: "Writing platform assets",
  seo: "Generating listing copy",
  grounding: "Fact-checking claims",
  succeeded: "Done",
  hitl_blocked: "Needs review",
  cost_capped: "Hit budget cap",
  failed: "Failed",
};

type LaunchStage =
  | { kind: "idle" }
  | { kind: "uploading"; uploadedCount: number; totalCount: number }
  | { kind: "creating" }
  | { kind: "launching"; runId: string; phase: string; elapsedMs: number }
  | { kind: "done"; productId: string }
  | { kind: "error"; message: string };

export default function NewProductPageInner() {
  const router = useRouter();
  const apiFetch = useApiFetch();
  const tenant = useTenant();

  const [files, setFiles] = useState<PendingFile[]>([]);
  // Single bilingual name field (Issue 1). Detected language drives
  // which DB column carries the value alongside the always-populated
  // name_en — see handleSubmit. The "name_en is required" Zod schema
  // is preserved without migration; for Chinese inputs we duplicate
  // the value into name_en too so the NOT NULL column stays satisfied.
  const [name, setName] = useState("");
  // Phase C · Iteration 04 — long-form description. Server cap 10000
  // chars (raised from 2000) so marketers can paste full supplier
  // spec sheets. Drives SEO copy quality + claims-grounding judge.
  const [description, setDescription] = useState("");

  // Phase H — single-state launch machine. Replaces the old `submitting`
  // boolean + separate redirect to /launch. The button derives its
  // label/progress from this state.
  const [launchStage, setLaunchStage] = useState<LaunchStage>({ kind: "idle" });
  const pollAbortRef = useRef<AbortController | null>(null);

  // Resolve tenant defaults for the silent-config launch. Falls back to
  // sensible defaults if the tenant flags aren't set yet.
  const launchDefaults = useMemo(() => {
    const f = tenant?.features ?? {};
    const platforms =
      Array.isArray(f.default_platforms) && f.default_platforms.length > 0
        ? f.default_platforms.filter(
            (p): p is "amazon" | "shopify" => p === "amazon" || p === "shopify",
          )
        : (["amazon", "shopify"] as ("amazon" | "shopify")[]);
    const outputLangs =
      Array.isArray(f.default_output_langs) && f.default_output_langs.length > 0
        ? f.default_output_langs
        : (["en"] as ("en" | "zh")[]);
    const qualityPreset =
      f.default_quality_preset === "budget" ||
      f.default_quality_preset === "balanced" ||
      f.default_quality_preset === "premium"
        ? f.default_quality_preset
        : "balanced";
    return { platforms, outputLangs, qualityPreset };
  }, [tenant]);

  // Stop any in-flight polling when the component unmounts.
  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
    };
  }, []);

  // Phase C · Iteration 04 — restore typed text after a reload. We can't
  // persist file blobs (sessionStorage size cap, non-serializable), so
  // dropped images don't survive — but the typed name + description do,
  // so a wifi blip doesn't lose 5 minutes of writing.
  const DRAFT_KEY = "ff:add-product:draft:v1";
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as { name?: string; description?: string };
      if (typeof draft.name === "string") setName(draft.name);
      if (typeof draft.description === "string")
        setDescription(draft.description);
    } catch {
      // ignore — bad/corrupt draft just gets a fresh form
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!name && !description) {
      sessionStorage.removeItem(DRAFT_KEY);
      return;
    }
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ name, description }));
  }, [name, description]);
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
        toast.error(
          `Skipped ${skipped.length} file${skipped.length === 1 ? "" : "s"}: ${skipped.join("; ")}`,
        );
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
                idx === i
                  ? { ...x, status: "compressing", error: undefined }
                  : x,
              ),
            );
            const compressed = await compressImage(f.file);
            setFiles((prev) =>
              prev.map((x, idx) =>
                idx === i ? { ...x, status: "uploading" } : x,
              ),
            );
            await putToR2(url.putUrl, compressed, (uploaded, total) => {
              setFiles((prev) =>
                prev.map((x, idx) =>
                  idx === i
                    ? { ...x, bytesUploaded: uploaded, bytesTotal: total }
                    : x,
                ),
              );
            });
            setFiles((prev) =>
              prev.map((x, idx) =>
                idx === i
                  ? { ...x, status: "uploaded", uploadedKey: url.key }
                  : x,
              ),
            );
            uploadedKeys[i] = url.key;
          } catch (uploadErr) {
            failedCount++;
            const msg =
              uploadErr instanceof Error
                ? uploadErr.message
                : String(uploadErr);
            setFiles((prev) =>
              prev.map((x, idx) =>
                idx === i ? { ...x, status: "error", error: msg } : x,
              ),
            );
          }
        }
      }
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      if (failedCount > 0) {
        toast.error(
          `${failedCount} of ${files.length} image${files.length === 1 ? "" : "s"} failed to upload — remove or retry.`,
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
      setLaunchStage({ kind: "creating" });
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

      // 4. Trigger the launch using tenant defaults silently. Same
      // payload shape as the launch wizard's /v1/launches POST.
      const surfaces = launchDefaults.outputLangs.flatMap((lang) =>
        launchDefaults.platforms.map((p) => ({
          surface:
            p === "amazon" ? ("amazon-us" as const) : ("shopify" as const),
          language: lang,
        })),
      );
      const launch = await apiFetch<{ run_id: string }>("/v1/launches", {
        method: "POST",
        body: JSON.stringify({
          product_id: created.product_id,
          platforms: launchDefaults.platforms,
          dry_run: false,
          surfaces,
          include_seo: true,
          quality_preset: launchDefaults.qualityPreset,
        }),
      });

      // 5. Poll the run for live phase progress. Cloudflare Workers
      // don't natively stream over HTTP so we poll every 2.5s. The
      // run row's currentPhase + status drive the button's progress.
      const startedAt = Date.now();
      setLaunchStage({
        kind: "launching",
        runId: launch.run_id,
        phase: "uploading",
        elapsedMs: 0,
      });
      pollAbortRef.current?.abort();
      const ctrl = new AbortController();
      pollAbortRef.current = ctrl;
      const poll = async (): Promise<void> => {
        while (!ctrl.signal.aborted) {
          await new Promise((r) => setTimeout(r, 2500));
          if (ctrl.signal.aborted) return;
          try {
            const status = await apiFetch<{
              run: { id: string; status: string; currentPhase?: string | null };
            }>(`/v1/launches/${launch.run_id}`);
            const run = status.run;
            const phase = run.currentPhase ?? run.status ?? "uploading";
            const elapsed = Date.now() - startedAt;
            sessionStorage.removeItem(DRAFT_KEY);
            if (
              run.status === "succeeded" ||
              run.status === "hitl_blocked" ||
              run.status === "cost_capped" ||
              run.status === "failed"
            ) {
              setLaunchStage({ kind: "done", productId: created.product_id });
              if (run.status === "succeeded") {
                toast.success(
                  `"${trimmedName}" launched — opening in library.`,
                );
              } else if (run.status === "hitl_blocked") {
                toast.warning(
                  `"${trimmedName}" needs review — opening in library.`,
                );
              } else if (run.status === "cost_capped") {
                toast.warning(`Hit budget cap — partial results in library.`);
              } else {
                toast.error(`Launch failed — opening library for diagnostics.`);
              }
              router.push(`/library?focus=${created.product_id}`);
              return;
            }
            setLaunchStage({
              kind: "launching",
              runId: launch.run_id,
              phase,
              elapsedMs: elapsed,
            });
          } catch (pollErr) {
            if (ctrl.signal.aborted) return;
            console.warn("[launch-poll]", pollErr);
          }
        }
      };
      void poll();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Launch failed";
      setSubmitError(err);
      setLaunchStage({ kind: "error", message });
      setSubmitting(false);
    }
  }

  function retryFile(id: string) {
    setFiles((prev) =>
      prev.map((x) =>
        x.id === id ? { ...x, status: "pending", error: undefined } : x,
      ),
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Add product · 添加产品"
        title="Onboard a new product"
        description="Drop 1-10 reference images plus the basic facts. We'll charge $0.50 to onboard, then you can create your first listing with one click. Reference images train the model on what your real product looks like."
      />
      <UploadModeTabs />
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
              <Field
                label="Product name · 产品名 (Chinese or English)"
                required
              >
                <input
                  className="w-full px-4 h-11 rounded-m3-md bg-surface-container-low border ff-hairline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={200}
                  placeholder='e.g. "Aluminum Camp Stove 1500W" or 中文名'
                  required
                />
                <div className="flex items-baseline justify-between mt-1 gap-3">
                  <span className="md-typescale-body-small text-on-surface-variant">
                    Type whichever language you have on hand. The other will be
                    generated automatically when you launch SEO copy.
                  </span>
                  <span
                    className={cn(
                      "md-typescale-body-small font-mono tabular-nums shrink-0",
                      name.length > 180
                        ? "text-ff-amber"
                        : "text-on-surface-variant/60",
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
                    Optional but strongly recommended. Paste your full supplier
                    spec sheet — up to 10,000 characters.
                  </span>
                  <span
                    className={cn(
                      "md-typescale-body-small font-mono tabular-nums",
                      description.length > 9500
                        ? "text-ff-amber"
                        : "text-on-surface-variant/60",
                    )}
                  >
                    {description.length.toLocaleString()} / 10,000
                  </span>
                </div>
              </Field>
              <div className="rounded-m3-md md-surface-container-low border ff-hairline px-4 py-3 md-typescale-body-small text-on-surface-variant flex items-start gap-3">
                <span
                  aria-hidden
                  className="text-primary text-base leading-none mt-0.5"
                >
                  ✦
                </span>
                <span>
                  <span className="text-on-surface md-typescale-label-medium block mb-0.5">
                    Category &amp; image-shape are auto-classified
                  </span>
                  We read your name and description and pick the right category
                  + crop shape for you. You can edit them later on the product
                  page if the AI guesses wrong.
                </span>
              </div>
            </CardContent>
            <CardFooter>
              <span className="md-typescale-label-small text-on-surface-variant">
                {launchStage.kind === "launching"
                  ? `${PHASE_LABEL[launchStage.phase] ?? launchStage.phase} · ${(launchStage.elapsedMs / 1000).toFixed(0)}s`
                  : launchStage.kind === "creating"
                    ? "Creating product…"
                    : launchStage.kind === "uploading"
                      ? "Uploading reference images…"
                      : `One-time onboard $0.50 + per-launch generation (defaults to ${(tenant?.features?.default_platforms ?? ["amazon", "shopify"]).join(" + ")})`}
              </span>
              <LaunchProgressButton canSubmit={canSubmit} stage={launchStage} />
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
                    : "border-outline-variant hover:border-primary hover:bg-surface-container-low",
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

// Phase H — single primary action button. Renders an idle "Launch →"
// button at rest, then morphs into a progress bar with live phase
// percentage + label during the 90-120s pipeline run. The fill
// animates between phase checkpoints so the UI doesn't feel stuck
// when a single phase (e.g. refine_all_crops) takes ~30s on its own.
function LaunchProgressButton({
  canSubmit,
  stage,
}: {
  canSubmit: boolean;
  stage: LaunchStage;
}) {
  if (stage.kind === "idle") {
    return (
      <Button type="submit" disabled={!canSubmit}>
        Launch →
      </Button>
    );
  }

  if (stage.kind === "error") {
    return (
      <Button type="submit" disabled={!canSubmit}>
        Retry launch
      </Button>
    );
  }

  if (stage.kind === "done") {
    return (
      <button
        type="button"
        disabled
        className="relative overflow-hidden rounded-m3-full h-11 px-6 bg-primary text-primary-on md-typescale-label-large min-w-[10rem]"
      >
        <span className="relative z-10 flex items-center justify-center gap-2">
          <span className="font-mono tabular-nums">100%</span>
          <span>· Opening library…</span>
        </span>
      </button>
    );
  }

  const percent =
    stage.kind === "launching"
      ? (PHASE_PERCENT[stage.phase] ?? 50)
      : stage.kind === "creating"
        ? PHASE_PERCENT.creating
        : 5;
  const label =
    stage.kind === "launching"
      ? (PHASE_LABEL[stage.phase] ?? "Working…")
      : stage.kind === "creating"
        ? "Creating product…"
        : `Uploading ${stage.uploadedCount} / ${stage.totalCount}…`;

  return (
    <button
      type="button"
      disabled
      aria-busy="true"
      aria-label={`Launching: ${label}, ${percent} percent complete`}
      className="relative overflow-hidden rounded-m3-full h-11 px-6 bg-surface-container border ff-hairline md-typescale-label-large min-w-[14rem] cursor-not-allowed"
    >
      <span
        className="absolute inset-y-0 left-0 bg-primary/20 transition-[width] duration-1000 ease-out"
        style={{ width: `${percent}%` }}
        aria-hidden
      />
      <span
        className="absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-transparent via-primary/40 to-transparent ff-shimmer"
        aria-hidden
      />
      <span className="relative z-10 flex items-center justify-center gap-2 text-on-surface">
        <span className="font-mono tabular-nums">{percent}%</span>
        <span className="text-on-surface-variant truncate">· {label}</span>
      </span>
    </button>
  );
}
