"use client";

/**
 * Shared empty-state primitive — promoted from FirstLaunchCTA on the
 * overview page so /billing, /costs, /library, /listings all render
 * the same shape (P0-4 in FF_DASHBOARD_FRONTEND_AUDIT.md).
 *
 * Two variants:
 *  - default: fresh tenant / first-use (dashed surface card, optional
 *    onboarding-step grid)
 *  - filtered: data exists but the user filtered it away (less ornate,
 *    just a CTA back to "clear filters")
 */
import Link from "next/link";
import { cn } from "@/lib/cn";

export interface EmptyStateStep {
  index: string;
  title: string;
  sub: string;
  href: string;
  cta: string;
}

interface EmptyStateProps {
  eyebrow: string;
  title: string;
  body?: string;
  steps?: EmptyStateStep[];
  cta?: { label: string; href: string };
  className?: string;
  variant?: "default" | "filtered";
  onClear?: () => void;
}

export function EmptyState({
  eyebrow,
  title,
  body,
  steps,
  cta,
  className,
  variant = "default",
  onClear,
}: EmptyStateProps) {
  if (variant === "filtered") {
    return (
      <div
        className={cn(
          "rounded-m3-lg border border-dashed border-outline-variant py-12 px-8 text-center md-fade-in",
          className
        )}
      >
        <div className="ff-stamp-label mb-3">{eyebrow}</div>
        <h3 className="md-typescale-title-large text-on-surface mb-2">
          {title}
        </h3>
        {body && (
          <p className="md-typescale-body-medium text-on-surface-variant max-w-md mx-auto mb-4">
            {body}
          </p>
        )}
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="px-4 h-9 rounded-m3-full bg-surface-container border ff-hairline md-typescale-label-medium hover:bg-surface-container-high"
          >
            Clear filters
          </button>
        )}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "md-surface-container-low border border-dashed border-outline-variant rounded-m3-lg p-8 md-fade-in",
        className
      )}
    >
      <div className="ff-stamp-label mb-3">{eyebrow}</div>
      <h3 className="md-typescale-headline-small text-on-surface mb-2">
        {title}
      </h3>
      {body && (
        <p className="md-typescale-body-medium text-on-surface-variant max-w-xl mb-6">
          {body}
        </p>
      )}
      {steps && steps.length > 0 && (
        <ol className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-2">
          {steps.map((s) => (
            <li
              key={s.index}
              className="rounded-m3-md md-surface-container border ff-hairline px-4 py-4 flex flex-col gap-2"
            >
              <span className="ff-stamp-label text-ff-vermilion-deep">
                {s.index}
              </span>
              <div>
                <div className="md-typescale-title-small text-on-surface">
                  {s.title}
                </div>
                <div className="md-typescale-body-small text-on-surface-variant mt-0.5">
                  {s.sub}
                </div>
              </div>
              <Link
                href={s.href}
                className="md-typescale-label-medium text-primary hover:underline mt-auto"
              >
                {s.cta}
              </Link>
            </li>
          ))}
        </ol>
      )}
      {cta && (
        <Link
          href={cta.href}
          className="inline-flex items-center gap-1.5 mt-4 px-4 h-10 rounded-m3-full md-typescale-label-large bg-primary text-primary-on shadow-m3-1 hover:shadow-m3-2 transition-shadow"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}
