import { cn } from "@/lib/cn";

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
        "relative px-6 md:px-12 pt-12 pb-10 border-b border-mist",
        // Subtle stamp-diagonal texture in the corner — like aged paper
        "before:absolute before:top-0 before:right-0 before:w-40 before:h-40",
        "before:bg-stamp-diag before:opacity-50 before:pointer-events-none",
        className
      )}
    >
      <div className="max-w-7xl mx-auto flex items-end justify-between gap-6 flex-wrap">
        <div className="animate-fade-up">
          <div className="stamp-label text-vermilion-deep mb-3">{eyebrow}</div>
          <h1 className="font-display text-display-2 font-medium leading-none tracking-tight">
            {title}
          </h1>
          {description && (
            <p className="mt-4 max-w-2xl text-ink-soft text-base leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {action && <div className="shrink-0 animate-fade-up [animation-delay:120ms]">{action}</div>}
      </div>
    </header>
  );
}
