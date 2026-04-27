import { cn } from "@/lib/cn";

/**
 * M3 hero-region with FF customs-stamp accent.
 *
 * Maps to M3 typography: eyebrow → label-small (mono uppercase, vermilion);
 * title → display-medium (Fraunces, fluid clamp); description → body-large.
 * Top-right corner gets a vermilion seal-stamp diagonal as decorative
 * accent — kept opaque enough to register as brand mark, not so dense it
 * fights the headline.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "relative px-6 md:px-12 pt-14 pb-12 border-b ff-hairline overflow-hidden",
        // Vermilion seal-stamp accent in the corner, M3 emphasized layered
        "before:absolute before:top-0 before:right-0 before:w-56 before:h-56",
        "before:ff-stamp-diag before:opacity-80 before:pointer-events-none",
        className
      )}
    >
      <div className="max-w-7xl mx-auto flex items-end justify-between gap-6 flex-wrap relative">
        <div className="md-fade-in">
          <div className="ff-stamp-label mb-4">{eyebrow}</div>
          <h1 className="md-typescale-display-medium text-on-surface">{title}</h1>
          {description && (
            <p className="mt-5 max-w-2xl md-typescale-body-large text-on-surface-variant">
              {description}
            </p>
          )}
        </div>
        {action && (
          <div
            className="shrink-0 md-fade-in"
            style={{ animationDelay: "120ms" }}
          >
            {action}
          </div>
        )}
      </div>
    </header>
  );
}
