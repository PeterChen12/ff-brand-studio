import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * M3 elevated/outlined card — variants follow Material 3 spec.
 *
 *  - "elevated" (default for content): surface-container-lowest + level-1 shadow
 *  - "outlined" (for dense content): surface, hairline outline, no shadow
 *  - "filled" (for emphasis): surface-container-high, no border
 *
 * The triangular corner notch in `<CardHeader>` keeps FF's "customs-folder
 * cut" brand motif on top of the M3 surface — a quiet vermilion tell that
 * differentiates from generic Material cards.
 */
type CardVariant = "elevated" | "outlined" | "filled";

const cardVariants: Record<CardVariant, string> = {
  elevated:
    "md-surface-container-lowest md-elevation-1 hover:md-elevation-2 transition-shadow duration-m3-medium2 ease-m3-emphasized rounded-m3-lg",
  outlined:
    "md-surface border ff-hairline rounded-m3-lg",
  filled:
    "md-surface-container-high rounded-m3-lg",
};

export function Card({
  className,
  variant = "elevated",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: CardVariant }) {
  return (
    <div
      className={cn(
        "relative text-on-surface overflow-hidden",
        cardVariants[variant],
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative px-6 pt-6 pb-3 flex items-baseline justify-between gap-4",
        // FF brand notch — single triangle, vermilion 12% tinted
        "before:absolute before:top-0 before:right-0",
        "before:w-3.5 before:h-3.5 before:bg-primary/15",
        "before:[clip-path:polygon(100%_0,100%_100%,0_0)]",
        className
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "md-typescale-headline-small text-on-surface leading-tight",
        className
      )}
      {...props}
    />
  );
}

export function CardEyebrow({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("ff-stamp-label", className)} {...props} />;
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 pb-5 pt-1", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "px-6 py-3.5 border-t ff-hairline flex items-center justify-between gap-3",
        "md-typescale-body-small text-on-surface-variant",
        className
      )}
      {...props}
    />
  );
}
