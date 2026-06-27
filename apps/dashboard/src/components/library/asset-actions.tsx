"use client";

import { useState } from "react";
import type { PlatformAssetRow } from "@/db/schema";
import {
  bundleSku,
  downloadAsset,
  BundleTooLargeError,
  type BundleSku,
} from "@/lib/zip-bundler";
import { RegenModal } from "@/components/library/regen-modal";
import { useTenant } from "@/lib/tenant-context";

const baseBtn =
  "inline-flex items-center gap-1.5 px-3 h-8 rounded-m3-full md-typescale-label-medium transition-colors duration-m3-short3";

export function DownloadAssetButton({
  item,
  sku,
}: {
  item: PlatformAssetRow;
  sku: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        downloadAsset(item, sku);
      }}
      className={`${baseBtn} bg-surface-container text-on-surface hover:bg-surface-container-high border ff-hairline`}
      aria-label={`Download ${sku} ${item.platform} ${item.slot}`}
    >
      ↓ Download
    </button>
  );
}

export function RegenAssetButton({
  item,
  onRegenerated,
}: {
  item: PlatformAssetRow;
  onRegenerated?: (newR2Url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const tenant = useTenant();
  // Regenerate is operator-gated (worker returns 403 feature_disabled unless
  // tenant.features.feedback_regen). Render an explanatory disabled control
  // rather than a button that opens a modal only to 403 on submit. `null`
  // tenant = still loading → keep it enabled rather than block the UI.
  const regenEnabled = tenant === null || tenant.features.feedback_regen === true;

  if (!regenEnabled) {
    return (
      <button
        type="button"
        disabled
        className={`${baseBtn} bg-surface-container text-on-surface-variant/60 border ff-hairline cursor-not-allowed`}
        title="Regeneration isn't enabled on your plan — contact support to turn it on."
        aria-label="Regenerate (not enabled on your plan)"
      >
        ↻ Regenerate
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={`${baseBtn} bg-surface-container text-on-surface hover:bg-surface-container-high border ff-hairline`}
        aria-label={`Regenerate ${item.platform} ${item.slot}`}
      >
        ↻ Regenerate
      </button>
      <RegenModal
        asset={item}
        open={open}
        onClose={() => setOpen(false)}
        onRegenerated={(url) => {
          onRegenerated?.(url);
          setOpen(false);
        }}
      />
    </>
  );
}

export function BundleSkuButton({
  group,
  isMobile,
}: {
  group: BundleSku;
  isMobile?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (isMobile) {
      const proceed = window.confirm(
        "You're on mobile. The bundle download may use up to 50 MB of data. Continue?"
      );
      if (!proceed) return;
    }
    setBusy(true);
    setError(null);
    try {
      await bundleSku(group);
    } catch (err) {
      if (err instanceof BundleTooLargeError) {
        setError("Bundle >200 MB. Download in batches.");
      } else {
        setError(err instanceof Error ? err.message : "Bundle failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={[
          baseBtn,
          "bg-primary text-primary-on shadow-m3-1 hover:shadow-m3-2",
          busy ? "opacity-60 cursor-not-allowed" : "",
        ].join(" ")}
        // Bilingual + explicit "all": Chinese operators didn't recognize the
        // English-only "Download bundle" as "download every image at once" and
        // kept clicking the per-asset ↓ Download. This is the download-all.
        title="Download every image for this product as a single ZIP"
        aria-label="Download all images for this product as a ZIP"
      >
        {busy ? "Bundling… · 打包中" : "↓ Download all · 全部下载"}
      </button>
      {error && (
        <span className="md-typescale-body-small text-error font-medium">
          {error}
        </span>
      )}
    </div>
  );
}
