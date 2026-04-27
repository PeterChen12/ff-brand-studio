import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * M3 assist-chip with FF stamp character.
 *
 * Material 3's chip is a pill-shaped container at 32px tall, label-large
 * typography, on-surface text on surface-container-low. Our Badge is a
 * smaller variant — the visual weight of an M3 input-chip but with the
 * stamp-aesthetic rotation (-1.5deg) preserved when variant != "neutral",
 * matching the previous customs-stamp impression style.
 */
const badgeVariants = cva(
  [
    "inline-flex items-center gap-1.5 px-2.5 py-1",
    "md-typescale-label-small",
    "rounded-m3-sm transition-transform duration-m3-short4 ease-m3-emphasized",
  ].join(" "),
  {
    variants: {
      variant: {
        // M3 tertiary container — jade for passing states
        passed:
          "bg-tertiary-container text-tertiary-on-container border border-tertiary/30 [transform:rotate(-1.5deg)]",
        // M3 error container — vermilion for blocked states
        flagged:
          "bg-error-container text-error-on-container border border-error/30 [transform:rotate(-1.5deg)]",
        // M3 secondary container with amber tint — pending/HITL
        pending:
          "bg-[rgb(var(--ff-saffron)/0.15)] text-[rgb(var(--ff-saffron))] border border-[rgb(var(--ff-saffron)/0.4)] [transform:rotate(-1.5deg)]",
        // M3 surface-container — neutral
        neutral:
          "bg-surface-container text-on-surface-variant border border-outline-variant",
        // M3 outlined chip — only border + on-surface text
        outline: "border border-outline-variant text-on-surface",
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
