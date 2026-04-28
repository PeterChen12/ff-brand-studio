"use client";

import { useState } from "react";
import { useApiFetch } from "@/lib/api";

interface FieldRule {
  minLen?: number;
  maxLen?: number;
  /** When true, render as multiline textarea. */
  multiline?: boolean;
  /** When true, value is an array of strings (e.g. bullets) — one per row. */
  array?: boolean;
}

interface InlineEditorProps {
  listingId: string;
  field: string;
  initialValue: string | string[];
  rules: FieldRule;
  onSaved?: (newRating: string | null) => void;
}

export function InlineEditor({ listingId, field, initialValue, rules, onSaved }: InlineEditorProps) {
  const apiFetch = useApiFetch();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string | string[]>(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const localIssues: string[] = [];
  const flatStr = Array.isArray(value) ? value.join("\n") : value;
  if (rules.minLen && flatStr.length < rules.minLen) {
    localIssues.push(`Min ${rules.minLen} characters (currently ${flatStr.length}).`);
  }
  if (rules.maxLen && flatStr.length > rules.maxLen) {
    localIssues.push(`Max ${rules.maxLen} characters (currently ${flatStr.length}).`);
  }

  const dirty = JSON.stringify(value) !== JSON.stringify(initialValue);
  const canSave = dirty && localIssues.length === 0 && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ rating: string | null; issues: string[] }>(
        `/v1/listings/${listingId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ patch: { [field]: value } }),
        }
      );
      onSaved?.(r.rating);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="block w-full text-left p-3 rounded-m3-md hover:bg-surface-container-low transition-colors group"
      >
        <div className="md-typescale-body-medium text-on-surface whitespace-pre-wrap">
          {Array.isArray(initialValue) ? initialValue.join("\n") : initialValue || <span className="text-on-surface-variant italic">Empty</span>}
        </div>
        <span className="md-typescale-label-small text-primary opacity-0 group-hover:opacity-100 transition-opacity">
          Click to edit
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-2">
      {rules.array ? (
        <textarea
          autoFocus
          value={Array.isArray(value) ? value.join("\n") : value}
          onChange={(e) => setValue(e.target.value.split("\n"))}
          rows={Math.max(5, (Array.isArray(value) ? value.length : 1) + 1)}
          className="w-full px-3 py-2 rounded-m3-md bg-surface-container-low border ff-hairline focus:outline-none focus:ring-2 focus:ring-primary md-typescale-body-medium font-mono text-[0.8125rem]"
        />
      ) : rules.multiline ? (
        <textarea
          autoFocus
          value={typeof value === "string" ? value : ""}
          onChange={(e) => setValue(e.target.value)}
          rows={6}
          className="w-full px-3 py-2 rounded-m3-md bg-surface-container-low border ff-hairline focus:outline-none focus:ring-2 focus:ring-primary md-typescale-body-medium"
        />
      ) : (
        <input
          autoFocus
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => setValue(e.target.value)}
          className="w-full px-3 h-10 rounded-m3-md bg-surface-container-low border ff-hairline focus:outline-none focus:ring-2 focus:ring-primary md-typescale-body-medium"
        />
      )}
      {localIssues.length > 0 && (
        <ul className="md-typescale-body-small text-error list-disc pl-5">
          {localIssues.map((iss, i) => (
            <li key={i}>{iss}</li>
          ))}
        </ul>
      )}
      {error && <div className="md-typescale-body-small text-error">{error}</div>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="px-4 h-9 rounded-m3-full bg-primary text-primary-on md-typescale-label-medium disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setValue(initialValue);
            setError(null);
          }}
          className="px-4 h-9 rounded-m3-full bg-surface-container border ff-hairline md-typescale-label-medium"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Per-platform field rules — surface what the deterministic rubric
 * already enforces server-side, so the client gets red feedback before
 * a save round-trip.
 */
export function rulesFor(surface: string, field: string): FieldRule {
  if (surface === "amazon-us") {
    if (field === "title") return { minLen: 80, maxLen: 200 };
    if (field === "bullets") return { array: true, maxLen: 2000 };
    if (field === "description") return { multiline: true, minLen: 800, maxLen: 2000 };
    if (field === "search_terms") return { maxLen: 240 };
  }
  if (surface === "shopify") {
    if (field === "h1") return { minLen: 10, maxLen: 80 };
    if (field === "meta_description") return { minLen: 80, maxLen: 165 };
    if (field === "description_md") return { multiline: true, minLen: 800 };
  }
  return { multiline: false };
}
