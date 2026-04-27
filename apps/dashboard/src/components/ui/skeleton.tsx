import { cn } from "@/lib/cn";

/**
 * M3 loading skeleton — surface-container shimmer with emphasized motion.
 * Replaces the previous .skeleton-shimmer class (which referenced atelier
 * variables that no longer exist) with M3 tokens.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-m3-sm bg-surface-container-high overflow-hidden relative",
        // Shimmer overlay using on-surface 0.06 → 0 gradient sweeping LTR
        "before:absolute before:inset-0",
        "before:bg-gradient-to-r before:from-transparent before:via-on-surface/[0.06] before:to-transparent",
        "before:bg-[length:200%_100%] before:animate-shimmer",
        className
      )}
      {...props}
    />
  );
}
