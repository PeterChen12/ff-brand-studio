"use client";

import { useEffect, useState } from "react";
import { useApiFetch } from "@/lib/api";
import type { PlatformAssetRow } from "@/db/schema";

const FEEDBACK_CHIPS = [
  "halo / artifacts",
  "wrong angle",
  "wrong color",
  "off-brand",
  "watermark visible",
  "geometry distorted",
];

interface Props {
  asset: PlatformAssetRow;
  open: boolean;
  onClose: () => void;
  onRegenerated: (newR2Url: string) => void;
}

export function RegenModal({ asset, open, onClose, onRegenerated }: Props) {
  const apiFetch = useApiFetch();
  const [chips, setChips] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cap, setCap] = useState<{ used: number; cap: number; allowed: boolean } | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setChips([]);
    setFeedback("");
    apiFetch<{ used: number; cap: number; allowed: boolean }>(`/v1/assets/regen-cap`)
      .then(setCap)
      .catch(() => setCap(null));
  }, [open, apiFetch]);

  function toggleChip(c: string) {
    setChips((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ r2Url: string; costCents: number }>(
        `/v1/assets/${asset.id}/regenerate`,
        {
          method: "POST",
          body: JSON.stringify({ chips, feedback }),
        }
      );
      onRegenerated(res.r2Url);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const overCap = cap !== null && !cap.allowed;

  return (
    <div className="fixed inset-0 bg-black/55 backdrop-blur-sm z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-m3-lg shadow-m3-3 w-full max-w-lg p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="ff-stamp-label">Regenerate · 重新生成</div>
          <h3 className="md-typescale-headline-small mt-1.5">
            {asset.platform} · {asset.slot}
          </h3>
        </header>

        <div className="grid grid-cols-2 gap-3">
          {FEEDBACK_CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => toggleChip(c)}
              className={[
                "h-9 px-3 rounded-m3-full md-typescale-label-medium border ff-hairline transition-colors text-left",
                chips.includes(c)
                  ? "bg-primary text-primary-on border-transparent"
                  : "bg-surface-container hover:bg-surface-container-high",
              ].join(" ")}
            >
              {chips.includes(c) ? "✓ " : ""}{c}
            </button>
          ))}
        </div>

        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={4}
          placeholder="Add specifics — angle, lighting, what to preserve, what to change…"
          className="w-full px-3 py-2 rounded-m3-md bg-surface-container-low border ff-hairline focus:outline-none focus:ring-2 focus:ring-primary md-typescale-body-medium"
          maxLength={600}
        />

        <div className="flex items-baseline justify-between">
          <span className="md-typescale-body-small text-on-surface-variant">
            Predicted cost: <span className="font-semibold text-on-surface">$0.30</span>
            {cap !== null && (
              <span className="ml-2">
                ({cap.used}/{cap.cap} this month)
              </span>
            )}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 h-9 rounded-m3-full bg-surface-container border ff-hairline md-typescale-label-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || overCap || (chips.length === 0 && feedback.trim().length === 0)}
              className="px-4 h-9 rounded-m3-full bg-primary text-primary-on md-typescale-label-medium disabled:opacity-50"
            >
              {busy ? "Generating…" : overCap ? "Cap reached" : "Regenerate ($0.30)"}
            </button>
          </div>
        </div>
        {error && <div className="md-typescale-body-small text-error">{error}</div>}
      </div>
    </div>
  );
}
