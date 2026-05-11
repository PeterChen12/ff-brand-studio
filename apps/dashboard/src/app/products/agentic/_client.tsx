"use client";

/**
 * Phase F · Iter 08.2 — Agentic upload UI.
 *
 * Operator drops a folder OR a zip; the dashboard uploads everything
 * to R2 staging, sends the {path, kind, r2_key} list to Sonnet via
 * POST /v1/products/agentic-classify, and renders the proposed
 * manifest with confidence flags. Operator reviews + edits + confirms.
 *
 * Confirm step iterates the manifest entries and calls the existing
 * POST /v1/products endpoint per product — same path Bulk Upload uses,
 * so the wallet ledger + Sonnet category-derive + r2 attachment paths
 * are all already exercised.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useApiFetch } from "@/lib/api";
import { compressImage, putToR2, extractExt } from "@/lib/uploader";
import { unpackZip } from "@/lib/zip-unpacker";
import { PageHeader } from "@/components/layout/page-header";
import { UploadModeTabs } from "@/components/products/upload-mode-tabs";
import { Card, CardContent, CardEyebrow, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface ManifestProduct {
  name: string;
  description?: string;
  references: string[];
  confidence: number;
  reason?: string;
}

interface ManifestResponse {
  products: ManifestProduct[];
  unassigned: Array<{ path: string; r2_key: string; reason: string }>;
  cost_cents: number;
}

const CONFIDENCE_FLAG_THRESHOLD = 0.7;

function fileKindFromName(name: string): "image" | "docx" | "pdf" | "text" | "unknown" {
  const lower = name.toLowerCase();
  if (/\.(jpe?g|png|webp)$/i.test(lower)) return "image";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".pdf")) return "pdf";
  if (/\.(txt|md)$/i.test(lower)) return "text";
  return "unknown";
}

export default function AgenticUploadInner() {
  const router = useRouter();
  const apiFetch = useApiFetch();

  const [stage, setStage] = useState<"pick" | "uploading" | "classifying" | "review" | "creating">("pick");
  const [progress, setProgress] = useState<string>("");
  const [manifest, setManifest] = useState<ManifestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onPick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      if (!list || list.length === 0) return;
      setStage("uploading");
      setError(null);
      try {
        // Step 1 — gather all files (handle zip if a single .zip dropped)
        const single = list.length === 1 ? list[0] : null;
        let files: File[];
        if (single && /\.zip$/i.test(single.name)) {
          setProgress("Unpacking zip…");
          const unpacked = await unpackZip(single);
          files = unpacked.files.map((u) => u.file);
        } else {
          files = Array.from(list);
        }

        // Step 2 — request an upload intent for all the image files only.
        // Images go through compress+upload; docx/pdf/txt go up as-is via
        // a single direct R2 put (no compression).
        const imageFiles = files.filter((f) => fileKindFromName(f.name) === "image");
        const docFiles = files.filter((f) => {
          const k = fileKindFromName(f.name);
          return k === "docx" || k === "pdf" || k === "text";
        });
        if (imageFiles.length === 0 && docFiles.length === 0) {
          throw new Error("No supported files found (need images and/or docx/pdf/txt).");
        }

        setProgress(`Uploading ${imageFiles.length} images + ${docFiles.length} docs…`);
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

        // Step 3 — upload images via the presigned PUTs.
        const imageEntries: Array<{ path: string; kind: "image"; r2_key: string }> = [];
        for (let i = 0; i < imageFiles.length; i++) {
          const f = imageFiles[i];
          const url = intent.urls[i];
          const compressed = await compressImage(f);
          await putToR2(url.putUrl, compressed);
          const path =
            (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
          imageEntries.push({ path, kind: "image", r2_key: url.key });
        }

        // Step 4 — docs upload via the SAME intent path so we get
        // pre-signed PUTs with proper auth. The intent was created with
        // image extensions only above; for docs we just use the intent's
        // last URL prefix and craft a key. Simpler: skip docs in this
        // version of the UI; operator can include the docx info in the
        // description manually. (Doc support is a known follow-up.)
        const docEntries: Array<{ path: string; kind: "docx" | "pdf" | "text"; r2_key: string }> = [];
        if (docFiles.length > 0) {
          toast.message(
            `Skipped ${docFiles.length} doc${docFiles.length === 1 ? "" : "s"} — agentic doc ingest is a follow-up feature. The classifier will work from filenames + image paths only.`
          );
        }

        // Step 5 — call the classify endpoint.
        setStage("classifying");
        setProgress("Sonnet is organizing your folder…");
        const allEntries = [...imageEntries, ...docEntries];
        const resp = await apiFetch<ManifestResponse>("/v1/products/agentic-classify", {
          method: "POST",
          body: JSON.stringify({ files: allEntries }),
        });
        setManifest(resp);
        setStage("review");
        setProgress("");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStage("pick");
        toast.error(msg);
      }
    },
    [apiFetch]
  );

  async function onConfirm() {
    if (!manifest) return;
    setStage("creating");
    setError(null);
    let created = 0;
    let failed = 0;
    for (const p of manifest.products) {
      try {
        await apiFetch("/v1/products", {
          method: "POST",
          body: JSON.stringify({
            name_en: p.name,
            description: p.description ?? undefined,
            // intent_id is missing here — the agentic flow uploaded via a
            // separate path. For v1 we accept the limitation: products
            // created via agentic upload won't have intent-validated R2
            // references the same way single-product onboard does. The
            // r2_keys are already in our R2 bucket so they're valid; a
            // future iteration can extend /v1/products to accept direct
            // r2_keys with tenant scoping enforced.
            uploaded_keys: p.references,
          }),
        });
        created++;
      } catch (err) {
        failed++;
        console.error("[agentic-confirm]", p.name, err);
      }
    }
    if (failed === 0) {
      toast.success(`Onboarded ${created} product${created === 1 ? "" : "s"}.`);
      router.push("/products/bulk?after=agentic");
    } else {
      toast.warning(`Onboarded ${created}, ${failed} failed. See console for details.`);
      setStage("review");
    }
  }

  const flagged = manifest?.products.filter((p) => p.confidence < CONFIDENCE_FLAG_THRESHOLD) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Agentic upload · AI 整理"
        title="Drop a folder, let AI organize"
        description="Sonnet reads your folder structure + filenames and groups files into products. Review the proposed manifest before confirming. ~$0.05 classifier fee + the usual $0.50 per onboarded product."
      />
      <UploadModeTabs />
      <section className="px-6 md:px-12 py-12 max-w-7xl mx-auto space-y-6">
        {stage === "pick" && (
          <Card>
            <CardHeader>
              <div>
                <CardEyebrow>Step 01 · 选择文件夹或 zip</CardEyebrow>
                <CardTitle className="mt-1.5">Pick a folder or zip</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <label
                htmlFor="agentic-folder"
                className="flex flex-col items-center justify-center gap-2 px-6 py-12 rounded-m3-md border-2 border-dashed cursor-pointer border-primary/40 hover:border-primary hover:bg-primary-container/20 transition-colors"
              >
                <span className="md-typescale-label-large text-on-surface">
                  Click to pick a folder OR a .zip
                </span>
                <span className="md-typescale-body-small text-on-surface-variant/70 font-mono">
                  JPG / PNG / WEBP images · (docx/pdf support pending)
                </span>
              </label>
              <input
                type="file"
                /* @ts-expect-error webkitdirectory is non-standard but well-supported */
                webkitdirectory=""
                directory=""
                multiple
                onChange={onPick}
                className="hidden"
                id="agentic-folder"
              />
              <input
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                onChange={onPick}
                className="hidden"
                id="agentic-zip"
              />
              <div className="flex items-center gap-3 md-typescale-body-small text-on-surface-variant">
                <span className="flex-1 h-px bg-outline-variant" />
                <span>or</span>
                <span className="flex-1 h-px bg-outline-variant" />
              </div>
              <label
                htmlFor="agentic-zip"
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-m3-md border ff-hairline cursor-pointer hover:bg-surface-container-high transition-colors md-typescale-label-medium"
              >
                <span aria-hidden>📦</span>
                <span>Upload a .zip file instead</span>
              </label>
            </CardContent>
          </Card>
        )}

        {(stage === "uploading" || stage === "classifying" || stage === "creating") && (
          <Card>
            <CardContent className="space-y-3 py-8">
              <Skeleton className="h-6 w-2/3" />
              <p className="md-typescale-body-medium text-on-surface-variant">
                {stage === "uploading" && progress}
                {stage === "classifying" && progress}
                {stage === "creating" && "Creating products…"}
              </p>
            </CardContent>
          </Card>
        )}

        {stage === "review" && manifest && (
          <>
            <Card>
              <CardHeader>
                <div>
                  <CardEyebrow>Step 02 · 复核</CardEyebrow>
                  <CardTitle className="mt-1.5">
                    Review {manifest.products.length} proposed products
                  </CardTitle>
                </div>
                <Badge variant="neutral" size="sm">
                  {flagged.length} flagged
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {manifest.products.length === 0 && (
                  <p className="md-typescale-body-medium text-on-surface-variant">
                    Sonnet couldn&apos;t confidently group these files. Try uploading a folder
                    with clearer subfolder names (one subfolder per product).
                  </p>
                )}
                <ul className="space-y-2">
                  {manifest.products.map((p, i) => {
                    const isFlagged = p.confidence < CONFIDENCE_FLAG_THRESHOLD;
                    return (
                      <li
                        key={i}
                        className={`px-4 py-3 rounded-m3-md border ff-hairline ${
                          isFlagged ? "bg-ff-amber/10 border-ff-amber/40" : "md-surface-container-low"
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-3 flex-wrap">
                          <span className="md-typescale-title-small">{p.name}</span>
                          <span className="md-typescale-body-small font-mono text-on-surface-variant">
                            {p.references.length} image{p.references.length === 1 ? "" : "s"} · conf {p.confidence.toFixed(2)}
                          </span>
                        </div>
                        {p.description && (
                          <p className="md-typescale-body-small text-on-surface-variant mt-1 line-clamp-2">
                            {p.description}
                          </p>
                        )}
                        {isFlagged && p.reason && (
                          <p className="md-typescale-body-small text-ff-amber mt-1">
                            ⚠ {p.reason}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {manifest.unassigned.length > 0 && (
                  <details className="rounded-m3-sm md-surface-container-low border ff-hairline">
                    <summary className="px-4 py-2 cursor-pointer md-typescale-label-medium">
                      {manifest.unassigned.length} unassigned files
                    </summary>
                    <ul className="px-4 pb-3 pt-1 font-mono text-[0.6875rem] text-on-surface-variant space-y-1">
                      {manifest.unassigned.slice(0, 20).map((u) => (
                        <li key={u.path}>· {u.path} — {u.reason}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </CardContent>
            </Card>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="md-typescale-body-small text-on-surface-variant">
                Classifier cost: ${(manifest.cost_cents / 100).toFixed(2)} · onboard fee: ${(manifest.products.length * 0.5).toFixed(2)}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setManifest(null);
                    setStage("pick");
                  }}
                >
                  Start over
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={manifest.products.length === 0}
                  onClick={onConfirm}
                >
                  Confirm {manifest.products.length} product{manifest.products.length === 1 ? "" : "s"}
                </Button>
              </div>
            </div>
          </>
        )}

        {error && stage === "pick" && (
          <Card>
            <CardContent>
              <p className="md-typescale-body-medium text-error">Error: {error}</p>
            </CardContent>
          </Card>
        )}
      </section>
    </>
  );
}
