"use client";

/**
 * Phase E · Iter 02 — Stage Product button.
 *
 * For enterprise tenants with a configured publish_destination (e.g.
 * BFR's "buyfishingrod-admin"), one click bulk-approves every pending
 * asset for the product. The existing webhook fan-out delivers each
 * asset.approved event to the customer admin, which appends the image
 * to the matching staged product on its side.
 *
 * For tenants without a publish_destination, the same-styled button
 * navigates to Settings → Channels where the Calendly enterprise-
 * onboarding CTA lives. The visual is identical so the affordance is
 * discoverable on every tier, but the action gracefully degrades.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useApiFetch } from "@/lib/api";
import { useTenant } from "@/lib/tenant-context";
import type { PlatformAssetRow } from "@/db/schema";

interface StageProductButtonProps {
  /** All assets in this product group; the button will stage the ones
   *  not already approved/rejected. */
  assets: PlatformAssetRow[];
  /** Friendly product label for the success toast. */
  productLabel: string;
  /** Optional callback so the library can refetch / update local state
   *  after staging — passed the count of newly approved assets. */
  onStaged?: (count: number) => void;
}

export function StageProductButton({
  assets,
  productLabel,
  onStaged,
}: StageProductButtonProps) {
  const tenant = useTenant();
  const apiFetch = useApiFetch();
  const [busy, setBusy] = useState(false);
  // Local "we just staged it" flag so the button flips to "Staged ✓"
  // immediately on success, without waiting for the parent's refetch
  // round-trip. The parent's onStaged() still fires so the real asset
  // rows refresh from DB and the new state survives a remount.
  const [justStagedCount, setJustStagedCount] = useState<number | null>(null);

  // Tenant gating — adapters[] could include "buyfishingrod-admin",
  // "amazon-sp-api", etc. Empty / absent means non-enterprise tier.
  const adapters = tenant?.features?.publish_destinations;
  const enterpriseEnabled = Array.isArray(adapters) && adapters.length > 0;

  // Stageable = anything not yet approved/rejected. If the operator
  // already approved manually earlier, those rows are skipped. If we
  // just staged in this same render cycle, treat the previously-stageable
  // set as already-staged so the button doesn't briefly snap back to
  // "Stage product · N" before the parent's refetch completes.
  const stageable = useMemo(() => {
    if (justStagedCount !== null) return [];
    return assets.filter((a) => a.status !== "approved" && a.status !== "rejected");
  }, [assets, justStagedCount]);

  // Non-enterprise: render the button as a Link, no API call. The
  // outer markup matches the Bundle button so the row alignment
  // doesn't break on either tier.
  if (!enterpriseEnabled) {
    return (
      <Link
        href="/settings?tab=channels"
        className="inline-flex items-center gap-1.5 px-3 h-9 rounded-m3-full md-typescale-label-medium border border-outline text-primary bg-transparent hover:bg-primary/[0.04] transition-colors"
        title="Direct push to your admin is an enterprise feature — see Channels to schedule onboarding"
      >
        Stage product →
      </Link>
    );
  }

  // Enterprise path — bulk-approve via the existing endpoint.
  async function onClick() {
    if (stageable.length === 0) {
      toast.message(`All assets already staged for ${productLabel}.`);
      return;
    }
    setBusy(true);
    try {
      // Worker caps bulk-approve at 50 ids/request — chunk so a product with
      // >50 stageable assets doesn't 400. Aggregate results.
      const ids = stageable.map((a) => a.id);
      const CHUNK = 50;
      let approved = 0;
      let failed = 0;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const res = await apiFetch<{ approved: number; failed: number }>(
          "/v1/inbox/bulk-approve",
          {
            method: "POST",
            body: JSON.stringify({ asset_ids: ids.slice(i, i + CHUNK) }),
          }
        );
        approved += res.approved;
        failed += res.failed;
      }
      if (approved > 0 && failed === 0) {
        setJustStagedCount(approved);
        toast.success(
          `Staged ${approved} asset${approved === 1 ? "" : "s"} for ${productLabel}. → admin.buyfishingrod.com`
        );
      } else if (approved > 0) {
        setJustStagedCount(approved);
        toast.warning(
          `Staged ${approved} of ${stageable.length} — ${failed} failed.`
        );
      } else {
        toast.error("Nothing was staged — see console for details.");
      }
      onStaged?.(approved);
    } catch (err) {
      toast.error(
        err instanceof Error ? `Stage failed: ${err.message}` : "Stage failed"
      );
    } finally {
      setBusy(false);
    }
  }

  const adminUrl = "https://admin.buyfishingrod.com/products?status=STAGING";
  const showAdminLink = stageable.length === 0 && adapters?.[0] === "buyfishingrod-admin";

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={busy || stageable.length === 0}
        className="inline-flex items-center gap-1.5 px-3 h-9 rounded-m3-full md-typescale-label-medium bg-primary text-primary-on shadow-m3-1 hover:shadow-m3-2 transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
        title={
          stageable.length === 0
            ? "All assets already approved"
            : `Approve ${stageable.length} asset${stageable.length === 1 ? "" : "s"} → push to ${adapters?.[0]}`
        }
      >
        {busy
          ? "Staging…"
          : stageable.length === 0
            ? "Staged ✓"
            : `Stage product · ${stageable.length}`}
      </button>
      {showAdminLink && (
        <a
          href={adminUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="md-typescale-label-medium text-primary hover:underline whitespace-nowrap"
          title="Open the product in admin.buyfishingrod.com (STAGING queue)"
        >
          View in admin →
        </a>
      )}
    </div>
  );
}
