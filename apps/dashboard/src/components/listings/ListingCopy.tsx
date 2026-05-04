"use client";

/**
 * Issue A + C — shared renderer for SEO copy returned by the launch
 * pipeline. The result panel embeds it under each surface card; the
 * library Listings tab will reuse it once Issue C lands.
 *
 * The pipeline emits platform-specific JSON (see seo-prompts.ts):
 *   amazon-us → { title, bullets[], description, search_terms }
 *   shopify   → { h1, meta_description, description_md, alt_text, ... }
 *
 * We render each surface in its native shape rather than a generic
 * key/value dump — operators reach for "title / bullets / description"
 * mentally, not "field name / json string".
 *
 * Long bodies (description, description_md) are wrapped in <details> so
 * the surface card stays scannable. A per-surface "Copy all" button
 * concats the visible blocks into plain text for VA hand-upload.
 */

import { memo, useState } from "react";

interface ListingCopyProps {
  surface: string;
  language: string;
  copy: Record<string, unknown> | null;
}

// P2-4 — memoized so cost-preview ticks in launch-wizard don't force
// re-renders of every surface card on every keystroke. Surface + copy
// shallow-compare correctly: copy is the same Record reference until
// the next /v1/launches result arrives.
function ListingCopyImpl({ surface, copy }: ListingCopyProps) {
  if (!copy) {
    return (
      <div className="md-typescale-body-small text-on-surface-variant font-mono">
        no copy returned for this surface
      </div>
    );
  }

  if (surface === "amazon-us") {
    return <AmazonCopy copy={copy} />;
  }
  if (surface === "shopify") {
    return <ShopifyCopy copy={copy} />;
  }
  return <GenericJsonCopy copy={copy} />;
}

export const ListingCopy = memo(ListingCopyImpl);

function AmazonCopy({ copy }: { copy: Record<string, unknown> }) {
  const title = stringField(copy.title);
  const bullets = stringArrayField(copy.bullets);
  const description = stringField(copy.description);
  const searchTerms = stringField(copy.search_terms);
  return (
    <div className="space-y-3 mt-3">
      {title && (
        <FieldBlock label="Title">
          <p className="md-typescale-body-medium text-on-surface">{title}</p>
        </FieldBlock>
      )}
      {bullets.length > 0 && (
        <FieldBlock label={`Bullets · ${bullets.length}`}>
          <ul className="space-y-1.5 md-typescale-body-small text-on-surface">
            {bullets.map((b) => (
              <li key={b} className="pl-3 -indent-3">
                · {b}
              </li>
            ))}
          </ul>
        </FieldBlock>
      )}
      {description && (
        <CollapsibleField label="Description" preview={description}>
          {description}
        </CollapsibleField>
      )}
      {searchTerms && (
        <FieldBlock label="Backend keywords">
          <p className="md-typescale-body-small text-on-surface-variant font-mono break-all">
            {searchTerms}
          </p>
        </FieldBlock>
      )}
      <CopyAllButton plainText={amazonPlainText({ title, bullets, description, searchTerms })} />
    </div>
  );
}

function ShopifyCopy({ copy }: { copy: Record<string, unknown> }) {
  const h1 = stringField(copy.h1);
  const metaDescription = stringField(copy.meta_description);
  const descriptionMd = stringField(copy.description_md);
  const altText = stringField(copy.alt_text);
  return (
    <div className="space-y-3 mt-3">
      {h1 && (
        <FieldBlock label="H1">
          <p className="md-typescale-body-medium text-on-surface">{h1}</p>
        </FieldBlock>
      )}
      {metaDescription && (
        <FieldBlock label="Meta description">
          <p className="md-typescale-body-small text-on-surface italic">
            {metaDescription}
          </p>
        </FieldBlock>
      )}
      {descriptionMd && (
        <CollapsibleField label="Description (markdown)" preview={descriptionMd}>
          <pre className="whitespace-pre-wrap font-mono text-[0.75rem] leading-relaxed text-on-surface">
            {descriptionMd}
          </pre>
        </CollapsibleField>
      )}
      {altText && (
        <FieldBlock label="Alt text">
          <p className="md-typescale-body-small text-on-surface-variant">{altText}</p>
        </FieldBlock>
      )}
      <CopyAllButton plainText={shopifyPlainText({ h1, metaDescription, descriptionMd, altText })} />
    </div>
  );
}

function GenericJsonCopy({ copy }: { copy: Record<string, unknown> }) {
  const json = JSON.stringify(copy, null, 2);
  return (
    <div className="space-y-3 mt-3">
      <CollapsibleField label="Raw JSON" preview={json}>
        <pre className="whitespace-pre-wrap font-mono text-[0.75rem] leading-relaxed text-on-surface">
          {json}
        </pre>
      </CollapsibleField>
      <CopyAllButton plainText={json} />
    </div>
  );
}

function FieldBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="ff-stamp-label mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function CollapsibleField({
  label,
  preview,
  children,
}: {
  label: string;
  preview: string;
  children: React.ReactNode;
}) {
  // Show first 140 chars as a teaser; everything else lives behind <details>.
  const isLong = preview.length > 140;
  if (!isLong) {
    return (
      <FieldBlock label={label}>
        {typeof children === "string" ? (
          <p className="md-typescale-body-small text-on-surface whitespace-pre-wrap">
            {children}
          </p>
        ) : (
          children
        )}
      </FieldBlock>
    );
  }
  return (
    <details className="md-surface-container-low border ff-hairline rounded-m3-sm">
      <summary className="px-3 py-2 cursor-pointer md-typescale-label-small text-on-surface-variant flex items-baseline gap-2">
        <span className="ff-stamp-label">{label}</span>
        <span className="md-typescale-body-small text-on-surface-variant truncate">
          {preview.slice(0, 140)}…
        </span>
      </summary>
      <div className="px-3 pb-3 pt-1">
        {typeof children === "string" ? (
          <p className="md-typescale-body-small text-on-surface whitespace-pre-wrap">
            {children}
          </p>
        ) : (
          children
        )}
      </div>
    </details>
  );
}

function CopyAllButton({ plainText }: { plainText: string }) {
  const [copied, setCopied] = useState(false);
  async function onClick() {
    try {
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 h-8 rounded-m3-full md-typescale-label-medium border border-outline text-primary bg-transparent hover:bg-primary/[0.04] transition-colors duration-m3-short3"
    >
      {copied ? "✓ Copied" : "📋 Copy all"}
    </button>
  );
}

function stringField(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function stringArrayField(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((b): b is string => typeof b === "string" && b.length > 0);
}

function amazonPlainText({
  title,
  bullets,
  description,
  searchTerms,
}: {
  title: string;
  bullets: string[];
  description: string;
  searchTerms: string;
}): string {
  const parts: string[] = [];
  if (title) parts.push(`Title:\n${title}`);
  if (bullets.length > 0) {
    parts.push(`Bullets:\n${bullets.map((b) => `- ${b}`).join("\n")}`);
  }
  if (description) parts.push(`Description:\n${description}`);
  if (searchTerms) parts.push(`Backend keywords:\n${searchTerms}`);
  return parts.join("\n\n");
}

function shopifyPlainText({
  h1,
  metaDescription,
  descriptionMd,
  altText,
}: {
  h1: string;
  metaDescription: string;
  descriptionMd: string;
  altText: string;
}): string {
  const parts: string[] = [];
  if (h1) parts.push(`H1:\n${h1}`);
  if (metaDescription) parts.push(`Meta description:\n${metaDescription}`);
  if (descriptionMd) parts.push(`Description:\n${descriptionMd}`);
  if (altText) parts.push(`Alt text:\n${altText}`);
  return parts.join("\n\n");
}
