"use client";

import { useEffect, useRef, useState } from "react";

export type DateRangePreset = "all" | "today" | "7d" | "30d";
export type PlatformFilter = "all" | "amazon" | "shopify";

export interface LibraryFilters {
  q: string;
  platform: PlatformFilter;
  slot: string;
  status: string;
  range: DateRangePreset;
}

export const DEFAULT_FILTERS: LibraryFilters = {
  q: "",
  platform: "all",
  slot: "all",
  status: "all",
  range: "all",
};

interface FilterBarProps {
  value: LibraryFilters;
  onChange: (next: LibraryFilters) => void;
  slots: string[];
  statuses: string[];
}

export function FilterBar({ value, onChange, slots, statuses }: FilterBarProps) {
  const [draft, setDraft] = useState(value.q);
  const lastSent = useRef(value.q);

  useEffect(() => {
    setDraft(value.q);
    lastSent.current = value.q;
  }, [value.q]);

  useEffect(() => {
    if (draft === lastSent.current) return;
    const t = setTimeout(() => {
      lastSent.current = draft;
      onChange({ ...value, q: draft });
    }, 200);
    return () => clearTimeout(t);
  }, [draft, onChange, value]);

  const hasFilters =
    value.q.trim() !== "" ||
    value.platform !== "all" ||
    value.slot !== "all" ||
    value.status !== "all" ||
    value.range !== "all";

  return (
    <div className="md-surface-container-low rounded-m3-md border ff-hairline p-4 mb-6 flex flex-wrap items-center gap-3">
      <input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Search SKU, name, seller…"
        className="flex-1 min-w-[200px] h-10 px-4 rounded-m3-full bg-surface-container border ff-hairline md-typescale-body-medium focus:outline-none focus:ring-2 focus:ring-primary"
      />

      <Chip
        label="All"
        active={value.platform === "all"}
        onClick={() => onChange({ ...value, platform: "all" })}
      />
      <Chip
        label="Amazon"
        active={value.platform === "amazon"}
        onClick={() => onChange({ ...value, platform: "amazon" })}
      />
      <Chip
        label="Shopify"
        active={value.platform === "shopify"}
        onClick={() => onChange({ ...value, platform: "shopify" })}
      />

      <Select
        value={value.slot}
        onChange={(slot) => onChange({ ...value, slot })}
        options={[{ label: "All slots", value: "all" }, ...slots.map((s) => ({ label: s, value: s }))]}
      />
      <Select
        value={value.status}
        onChange={(status) => onChange({ ...value, status })}
        options={[
          { label: "Any status", value: "all" },
          ...statuses.map((s) => ({ label: s, value: s })),
        ]}
      />
      <Select
        value={value.range}
        onChange={(range) => onChange({ ...value, range: range as DateRangePreset })}
        options={[
          { label: "Any time", value: "all" },
          { label: "Today", value: "today" },
          { label: "Last 7d", value: "7d" },
          { label: "Last 30d", value: "30d" },
        ]}
      />

      {hasFilters && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="px-3 h-8 rounded-m3-full md-typescale-label-medium text-on-surface-variant hover:bg-surface-container border ff-hairline"
        >
          Clear
        </button>
      )}
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "h-8 px-3 rounded-m3-full md-typescale-label-medium border ff-hairline transition-colors",
        active
          ? "bg-primary text-primary-on border-transparent"
          : "bg-surface text-on-surface hover:bg-surface-container",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 px-2 rounded-m3-sm bg-surface-container border ff-hairline md-typescale-label-medium focus:outline-none focus:ring-2 focus:ring-primary"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function applyFilters<T extends {
  platform: string;
  slot: string;
  status: string;
  sku: string | null;
  productNameEn: string | null;
  productNameZh: string | null;
  sellerNameEn: string | null;
  createdAt: string | null;
}>(rows: T[], f: LibraryFilters): T[] {
  const now = Date.now();
  let cutoff = 0;
  if (f.range === "today") cutoff = now - 24 * 3600 * 1000;
  if (f.range === "7d") cutoff = now - 7 * 24 * 3600 * 1000;
  if (f.range === "30d") cutoff = now - 30 * 24 * 3600 * 1000;

  const q = f.q.trim().toLowerCase();

  return rows.filter((r) => {
    if (f.platform !== "all" && r.platform !== f.platform) return false;
    if (f.slot !== "all" && r.slot !== f.slot) return false;
    if (f.status !== "all" && r.status !== f.status) return false;
    if (cutoff > 0) {
      const t = r.createdAt ? Date.parse(r.createdAt) : 0;
      if (!t || t < cutoff) return false;
    }
    if (q) {
      const hay = [
        r.sku,
        r.productNameEn,
        r.productNameZh,
        r.sellerNameEn,
        r.platform,
        r.slot,
      ]
        .filter((x): x is string => typeof x === "string" && x.length > 0)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
