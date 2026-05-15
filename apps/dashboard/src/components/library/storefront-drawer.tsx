"use client";

/**
 * Phase H · 2026-05-13 — storefront-style product detail drawer.
 *
 * Opens automatically when /library?focus=<product_id> is loaded
 * (right after a Phase H quick-launch). Renders the just-launched
 * product as it would look on Amazon / Shopify: hero image gallery
 * on the left, title + bullets + description on the right. Inline
 * regenerate per image (reuses RegenAssetButton) and inline edit
 * per text field (PATCH /v1/listings/:id, Phase K1 endpoint).
 *
 * Why a drawer instead of a new /products/[id] page: per user spec
 * "we have enough pages already". The drawer is a modal overlay on
 * top of the Library; closing it returns the user to the SKU grid
 * with no navigation cost.
 */

import { RegenAssetButton } from "@/components/library/asset-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PlatformAssetRow } from "@/db/schema";
import { useApiFetch } from "@/lib/api";
import { useApiQuery } from "@/lib/api-query";
import { cn } from "@/lib/cn";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

interface ListingRow {
  id: string;
  variantId: string;
  surface: string;
  language: string;
  copy: Record<string, unknown> | null;
  rating: string | null;
  productId: string | null;
  sku: string | null;
  productNameEn: string | null;
  productNameZh: string | null;
  category: string | null;
}

interface StorefrontDrawerProps {
  productId: string;
  assets: PlatformAssetRow[]; // already filtered to this product
  onClose: () => void;
}

/**
 * The drawer always tries to render whatever assets we have for this
 * product; listings are fetched on mount because the Library page may
 * not have hydrated /v1/listings yet (it's a lazy tab).
 */
export function StorefrontDrawer({
  productId,
  assets,
  onClose,
}: StorefrontDrawerProps) {
  const listingsQ = useApiQuery<{ listings: ListingRow[] }>("/v1/listings");
  const listings = useMemo(() => {
    const all = listingsQ.data?.listings ?? [];
    return all.filter((l) => l.productId === productId);
  }, [listingsQ.data, productId]);

  // Pick the "primary" listing for the headline copy. Prefer Amazon
  // English (the operator's default surface) when present; fall back
  // to whichever listing came back first.
  const primaryListing = useMemo(() => {
    if (listings.length === 0) return null;
    const amazonEn = listings.find(
      (l) => l.surface === "amazon-us" && l.language === "en",
    );
    return amazonEn ?? listings[0];
  }, [listings]);

  // Image gallery — Amazon main slot first (operator's strongest
  // candidate), then lifestyle, infographics, banner; reference last.
  const galleryAssets = useMemo(() => {
    const isImage = (row: PlatformAssetRow) =>
      row.format === "png" ||
      row.format === "jpg" ||
      row.format === "jpeg" ||
      row.format === "webp";
    const slotPriority = (slot: string): number => {
      if (slot.includes("main") || slot === "amazon-main") return 0;
      if (slot.includes("lifestyle")) return 1;
      if (slot.includes("info") || slot.includes("composite")) return 2;
      if (slot.includes("banner") || slot.includes("hero")) return 3;
      return 4;
    };
    return assets
      .filter(isImage)
      .filter((a) => a.status !== "reference")
      .sort((a, b) => slotPriority(a.slot) - slotPriority(b.slot));
  }, [assets]);

  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const activeImage = galleryAssets[activeImageIdx] ?? null;

  // ESC closes the drawer; mounted body-scroll lock for focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const productName =
    assets[0]?.productNameEn ??
    primaryListing?.productNameEn ??
    "(unnamed product)";
  const productNameZh =
    assets[0]?.productNameZh ?? primaryListing?.productNameZh ?? null;
  const productSku = assets[0]?.sku ?? primaryListing?.sku ?? null;

  // If the product has no assets at all (e.g. HITL-blocked or failed
  // launches that wrote 0 files), surface a friendly empty state so
  // the user understands why the storefront preview is empty.
  const hasAnyAssets = galleryAssets.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm md-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Storefront preview"
    >
      <div
        className="relative w-[min(1180px,96vw)] max-h-[92vh] overflow-y-auto rounded-m3-lg bg-surface md-elevation-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header — close, stamp, share */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 px-6 py-3 md-surface-container-low border-b ff-hairline">
          <div className="flex items-center gap-3 min-w-0">
            <span className="ff-stamp-label">
              Storefront preview · 实时预览
            </span>
            {productSku && (
              <span className="md-typescale-body-small text-on-surface-variant font-mono truncate">
                {productSku}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-m3-full hover:bg-surface-container flex items-center justify-center md-typescale-title-large"
            aria-label="Close preview"
          >
            ×
          </button>
        </div>

        {!hasAnyAssets ? (
          <EmptyAssets onClose={onClose} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 px-6 md:px-10 py-8">
            {/* Left column — image gallery */}
            <div className="flex flex-col gap-4">
              <div className="relative aspect-square rounded-m3-md overflow-hidden bg-surface-container border ff-hairline">
                {activeImage ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={activeImage.r2Url}
                      alt={`${productName} — ${activeImage.platform} ${activeImage.slot}`}
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-3">
                      <div className="rounded-m3-full bg-surface/85 backdrop-blur-sm border ff-hairline px-3 py-1 md-typescale-label-small text-on-surface-variant">
                        {activeImage.platform} · {activeImage.slot}
                      </div>
                      <RegenAssetButton item={activeImage} />
                    </div>
                  </>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-on-surface-variant md-typescale-body-medium">
                    No image
                  </div>
                )}
              </div>

              {galleryAssets.length > 1 && (
                <div className="grid grid-cols-5 gap-2">
                  {galleryAssets.slice(0, 10).map((a, idx) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setActiveImageIdx(idx)}
                      className={cn(
                        "relative aspect-square rounded-m3-sm overflow-hidden border transition-colors",
                        idx === activeImageIdx
                          ? "border-primary ring-2 ring-primary/30"
                          : "ff-hairline hover:border-primary/60",
                      )}
                      aria-label={`Show ${a.slot}`}
                      title={`${a.platform} · ${a.slot}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={a.thumbUrl ?? a.r2Url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right column — title, bullets, description, surfaces */}
            <div className="flex flex-col gap-5">
              <div>
                <div className="ff-stamp-label mb-1.5">
                  {primaryListing?.category ?? assets[0]?.category ?? "—"}
                </div>
                <h1 className="md-typescale-headline-large mb-1">
                  {primaryListing && primaryListing.copy
                    ? (extractTitle(primaryListing) ?? productName)
                    : productName}
                </h1>
                {productNameZh && productNameZh !== productName && (
                  <div className="md-typescale-body-large text-on-surface-variant">
                    {productNameZh}
                  </div>
                )}
              </div>

              {/* Decorative price/CTA row — visual only; we don't sell from
                  this surface. It's here to make the preview feel like the
                  actual storefront, so operators can spot copy problems. */}
              <div className="flex items-center gap-3 pb-4 border-b ff-hairline">
                <span className="md-typescale-display-small">$—</span>
                <Badge variant="passed" size="sm">
                  Preview
                </Badge>
              </div>

              {primaryListing ? (
                <EditableListing
                  listing={primaryListing}
                  onSaved={() => listingsQ.mutate()}
                />
              ) : listingsQ.error ? (
                <div className="md-typescale-body-small text-error">
                  Couldn't load listing copy.
                </div>
              ) : listings.length === 0 && !listingsQ.isLoading ? (
                <div className="rounded-m3-md border border-dashed ff-hairline px-4 py-6 text-center md-typescale-body-medium text-on-surface-variant">
                  Copy is still being generated. Refresh in a moment.
                </div>
              ) : (
                <ListingSkeleton />
              )}

              {/* Alternative surfaces — quick switcher so the user can see
                  each marketplace's copy without leaving the drawer. */}
              {listings.length > 1 && (
                <SurfaceSwitcher
                  listings={listings}
                  current={primaryListing}
                  onSaved={() => listingsQ.mutate()}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function extractTitle(listing: ListingRow): string | null {
  const c = listing.copy ?? {};
  // Amazon shape — { title, bullets, description, search_terms }
  if (typeof c.title === "string" && c.title.trim()) return c.title;
  // Shopify shape — { h1, meta_description, description_md, ... }
  if (typeof c.h1 === "string" && c.h1.trim()) return c.h1;
  return null;
}

function extractBullets(listing: ListingRow): string[] | null {
  const c = listing.copy ?? {};
  if (Array.isArray(c.bullets)) {
    return c.bullets.filter((b): b is string => typeof b === "string");
  }
  // Shopify doesn't emit bullets; some listings use "features"
  if (Array.isArray(c.features)) {
    return c.features.filter((b): b is string => typeof b === "string");
  }
  return null;
}

function extractDescription(listing: ListingRow): string | null {
  const c = listing.copy ?? {};
  if (typeof c.description === "string") return c.description;
  if (typeof c.description_md === "string") return c.description_md;
  if (typeof c.meta_description === "string") return c.meta_description;
  return null;
}

function EditableListing({
  listing,
  onSaved,
}: {
  listing: ListingRow;
  onSaved: () => void;
}) {
  const apiFetch = useApiFetch();
  const initialTitle = extractTitle(listing) ?? "";
  const initialBullets = extractBullets(listing) ?? [];
  const initialDescription = extractDescription(listing) ?? "";

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [bullets, setBullets] = useState<string[]>(initialBullets);
  const [description, setDescription] = useState(initialDescription);
  const [saving, setSaving] = useState(false);

  // Reset local edits whenever the underlying listing changes (e.g.
  // after onSaved() refetches and a new copy arrives).
  useEffect(() => {
    setTitle(initialTitle);
    setBullets(initialBullets);
    setDescription(initialDescription);
    setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing.id, listing.copy]);

  async function handleSave() {
    setSaving(true);
    try {
      // Build a patch object matching the listing's surface shape. We
      // only send fields the user actually touched (vs blindly sending
      // everything — server's brand-rules validator runs on the diff).
      const patch: Record<string, unknown> = {};
      if (listing.surface === "amazon-us") {
        if (title !== initialTitle) patch.title = title;
        if (JSON.stringify(bullets) !== JSON.stringify(initialBullets)) {
          patch.bullets = bullets;
        }
        if (description !== initialDescription) patch.description = description;
      } else if (listing.surface === "shopify") {
        if (title !== initialTitle) patch.h1 = title;
        if (description !== initialDescription)
          patch.description_md = description;
      }
      if (Object.keys(patch).length === 0) {
        toast.info("No changes to save.");
        setEditing(false);
        setSaving(false);
        return;
      }
      await apiFetch(`/v1/listings/${listing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ patch }),
      });
      toast.success("Copy saved");
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="ff-stamp-label">
          {listing.surface} · {listing.language}
          {listing.rating && (
            <span className="ml-2 normal-case tracking-normal text-on-surface-variant">
              ({listing.rating})
            </span>
          )}
        </div>
        {editing ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setTitle(initialTitle);
                setBullets(initialBullets);
                setDescription(initialDescription);
                setEditing(false);
              }}
              disabled={saving}
              className="px-3 h-8 rounded-m3-full md-typescale-label-medium text-on-surface-variant hover:text-on-surface"
            >
              Cancel
            </button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save copy"}
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            ✎ Edit
          </Button>
        )}
      </div>

      {/* Title */}
      {editing ? (
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          rows={2}
          className="w-full px-4 py-2 rounded-m3-md bg-surface-container-low border ff-hairline md-typescale-title-large focus:outline-none focus-visible:ring-2 focus-visible:ring-primary resize-y"
        />
      ) : title ? (
        <p className="md-typescale-title-large text-on-surface">{title}</p>
      ) : null}

      {/* Bullets — only meaningful for Amazon-style copy */}
      {bullets.length > 0 && (
        <ul className="space-y-2">
          {bullets.map((b, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-primary mt-1 shrink-0">•</span>
              {editing ? (
                <textarea
                  value={b}
                  onChange={(e) => {
                    const next = [...bullets];
                    next[i] = e.target.value;
                    setBullets(next);
                  }}
                  rows={2}
                  className="flex-1 px-3 py-1.5 rounded-m3-sm bg-surface-container-low border ff-hairline md-typescale-body-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary resize-y"
                />
              ) : (
                <span className="md-typescale-body-medium">{b}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Description */}
      {description && (
        <div>
          <div className="ff-stamp-label mb-2">Description</div>
          {editing ? (
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={8}
              className="w-full px-4 py-3 rounded-m3-md bg-surface-container-low border ff-hairline md-typescale-body-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary resize-y"
            />
          ) : (
            <p className="md-typescale-body-medium text-on-surface whitespace-pre-line">
              {description}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SurfaceSwitcher({
  listings,
  current,
  onSaved,
}: {
  listings: ListingRow[];
  current: ListingRow | null;
  onSaved: () => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(
    current ? current.id : null,
  );
  const active = listings.find((l) => l.id === activeId) ?? current;
  if (!active) return null;
  return (
    <div className="pt-4 border-t ff-hairline">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {listings.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setActiveId(l.id)}
            className={cn(
              "px-3 h-8 rounded-m3-full md-typescale-label-medium border",
              l.id === active.id
                ? "border-primary bg-primary-container/40 text-on-primary-container"
                : "ff-hairline text-on-surface-variant hover:text-on-surface",
            )}
          >
            {l.surface} · {l.language}
          </button>
        ))}
      </div>
      {active.id !== (current?.id ?? null) && (
        <EditableListing listing={active} onSaved={onSaved} />
      )}
    </div>
  );
}

function ListingSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-5 w-40 rounded-m3-sm bg-surface-container" />
      <div className="h-7 w-full rounded-m3-sm bg-surface-container" />
      <div className="h-4 w-3/4 rounded-m3-sm bg-surface-container" />
      <div className="h-4 w-2/3 rounded-m3-sm bg-surface-container" />
    </div>
  );
}

function EmptyAssets({ onClose }: { onClose: () => void }) {
  return (
    <div className="px-6 md:px-10 py-16 text-center">
      <div className="ff-stamp-label mb-3">No assets yet</div>
      <h2 className="md-typescale-headline-medium text-on-surface mb-2">
        Storefront preview not ready
      </h2>
      <p className="md-typescale-body-medium text-on-surface-variant max-w-md mx-auto mb-6">
        This product hasn't produced any approved images yet. If the launch
        failed or got blocked at HITL, open the Audit log to see what happened.
      </p>
      <Button onClick={onClose} variant="ghost">
        Back to library
      </Button>
    </div>
  );
}
