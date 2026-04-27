import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Atelier card — hairline border on paper, subtle inset shadow on hover.
 * The triangular corner mark in `<CardHeader>` evokes a customs-folder
 * cut — a quiet brand motif that runs through the whole UI.
 */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative bg-paper-deep/50 border border-mist text-ink",
        "transition-[box-shadow,border-color] duration-300",
        "hover:border-ink/30 hover:shadow-[inset_0_0_0_1px_rgb(var(--ink)/0.04)]",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative px-6 pt-5 pb-3 flex items-baseline justify-between gap-4",
        // Diagonal corner notch — a single triangle, vermilion 8% tinted
        "before:absolute before:top-0 before:right-0",
        "before:w-3 before:h-3 before:bg-vermilion/10",
        "before:[clip-path:polygon(100%_0,100%_100%,0_0)]",
        className
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "font-display text-lg font-medium tracking-tight text-ink leading-tight",
        className
      )}
      {...props}
    />
  );
}

export function CardEyebrow({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("stamp-label", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 pb-5 pt-1", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "px-6 py-3 border-t border-mist/70 flex items-center justify-between gap-3 text-xs text-ink-mute",
        className
      )}
      {...props}
    />
  );
}
