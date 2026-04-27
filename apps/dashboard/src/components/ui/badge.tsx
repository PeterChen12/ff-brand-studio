import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Customs-stamp badge — appears slightly rotated and bordered like a
 * rubber-stamp impression. `<Badge variant="passed">` carries the same
 * visual weight a real "PASSED INSPECTION" stamp would. We use sparingly;
 * one stamp on a card draws attention, three of them feel decorative.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 px-2.5 py-1 font-mono text-2xs font-medium uppercase tracking-stamp transition-transform",
  {
    variants: {
      variant: {
        passed:
          "bg-jade/10 text-jade-deep border border-jade/40 [transform:rotate(-1deg)]",
        flagged:
          "bg-vermilion/10 text-vermilion-deep border border-vermilion/40 [transform:rotate(-1deg)]",
        pending:
          "bg-amber/10 text-amber border border-amber/40 [transform:rotate(-1deg)]",
        neutral: "bg-paper-dim text-ink-mute border border-mist",
        outline: "border border-ink/30 text-ink",
      },
      size: {
        sm: "text-[0.625rem] px-2 py-0.5",
        md: "",
      },
    },
    defaultVariants: { variant: "neutral", size: "md" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}
