"use client";

import { useEffect, useState } from "react";
import { diffWords } from "diff";
import { useApiFetch } from "@/lib/api";

interface ListingVersion {
  id: string;
  version: number;
  copy: Record<string, unknown>;
  rating: string | null;
  archivedAt: string | null;
}

interface Props {
  listingId: string;
  currentCopy: Record<string, unknown>;
  onClose: () => void;
}

export function VersionDiffPanel({ listingId, currentCopy, onClose }: Props) {
  const apiFetch = useApiFetch();
  const [versions, setVersions] = useState<ListingVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ versions: ListingVersion[] }>(`/v1/listings/${listingId}/versions`)
      .then((d) => setVersions(d.versions))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [apiFetch, listingId]);

  return (
    <aside className="fixed inset-y-0 right-0 w-full md:w-[640px] bg-surface border-l ff-hairline shadow-m3-3 z-50 overflow-auto">
      <header className="px-6 py-4 border-b ff-hairline flex items-center justify-between sticky top-0 bg-surface">
        <div>
          <div className="ff-stamp-label">Version history</div>
          <h3 className="md-typescale-headline-small mt-1">Recent edits</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="px-3 h-8 rounded-m3-full bg-surface-container border ff-hairline md-typescale-label-medium"
        >
          Close
        </button>
      </header>

      <div className="p-6 space-y-6">
        {error && <div className="md-typescale-body-medium text-error">{error}</div>}
        {versions === null ? (
          <div className="md-typescale-body-medium text-on-surface-variant">Loading…</div>
        ) : versions.length === 0 ? (
          <div className="md-typescale-body-medium text-on-surface-variant">
            No edits yet. Versions are recorded each time you save an inline edit.
          </div>
        ) : (
          versions.map((v, i) => {
            const prev = i > 0 ? versions[i - 1] : null;
            const compareTo = prev ? prev.copy : currentCopy;
            const fields = new Set([
              ...Object.keys(v.copy ?? {}),
              ...Object.keys(compareTo ?? {}),
            ]);
            return (
              <article
                key={v.id}
                className="rounded-m3-md md-surface-container-low border ff-hairline p-4"
              >
                <header className="flex items-baseline justify-between mb-3">
                  <span className="md-typescale-label-medium">
                    Version {v.version} · {v.rating ?? "—"}
                  </span>
                  <span className="md-typescale-body-small text-on-surface-variant font-mono text-[0.6875rem]">
                    {v.archivedAt ? new Date(v.archivedAt).toLocaleString() : ""}
                  </span>
                </header>
                <div className="space-y-3">
                  {[...fields].map((f) => (
                    <FieldDiff
                      key={f}
                      field={f}
                      oldVal={fmt((v.copy ?? {})[f])}
                      newVal={fmt((compareTo ?? {})[f])}
                    />
                  ))}
                </div>
              </article>
            );
          })
        )}
      </div>
    </aside>
  );
}

function fmt(v: unknown): string {
  if (Array.isArray(v)) return v.join("\n");
  if (v == null) return "";
  return String(v);
}

function FieldDiff({
  field,
  oldVal,
  newVal,
}: {
  field: string;
  oldVal: string;
  newVal: string;
}) {
  if (oldVal === newVal) return null;
  const parts = diffWords(oldVal, newVal);
  return (
    <div>
      <div className="ff-stamp-label mb-1">{field}</div>
      <div className="md-typescale-body-small whitespace-pre-wrap leading-relaxed">
        {parts.map((p, i) => (
          <span
            key={i}
            className={
              p.added
                ? "bg-tertiary-container/40 text-on-tertiary-container px-0.5"
                : p.removed
                  ? "bg-error-container/40 text-on-error-container line-through px-0.5"
                  : ""
            }
          >
            {p.value}
          </span>
        ))}
      </div>
    </div>
  );
}
