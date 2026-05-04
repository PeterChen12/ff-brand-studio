import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * M3 button — five variants per spec (filled, tonal, outlined, text,
 * elevated). API-compatible with the previous Button so existing call
 * sites (variant="accent" etc.) continue to work — `accent` maps to
 * filled-primary, `primary` to tonal, `ghost` to text, `outline` to
 * outlined, `link` to text-with-underline.
 *
 * Why hand-rolled instead of <md-filled-button>: the existing pages call
 * `<Button>` from React with arbitrary children including labels +
 * spinners; MWC's web component doesn't compose with React state changes
 * as cleanly. The classes below replicate the M3 spec — pill shape, M3
 * tonal hover/pressed states (state-layer overlay via ::after), label-
 * large typography.
 */

const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2 isolate",
    "rounded-m3-full md-typescale-label-large",
    "transition-[background-color,color,box-shadow,transform] duration-m3-short4 ease-m3-emphasized",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-40",
    // M3 state layer — sits on top via ::after, animates opacity
    "after:absolute after:inset-0 after:rounded-[inherit] after:pointer-events-none",
    "after:bg-current after:opacity-0 hover:after:opacity-[0.08] focus-visible:after:opacity-[0.12]",
    "active:after:opacity-[0.12]",
  ].join(" "),
  {
    variants: {
      variant: {
        // M3 filled — primary action
        accent:
          "bg-primary text-primary-on shadow-m3-1 hover:shadow-m3-2 active:translate-y-px",
        // M3 tonal — secondary action with primary tint
        primary:
          "bg-primary-container text-primary-on-container hover:shadow-m3-1",
        // M3 outlined — equal-weight alternative to filled
        outline:
          "border border-outline text-primary bg-transparent hover:bg-primary/[0.04]",
        // M3 text — low-emphasis
        ghost:
          "text-primary bg-transparent",
        // M3 text + underline — for inline link-like CTAs
        link: "text-primary underline-offset-4 hover:underline px-0 after:hidden",
      },
      size: {
        sm: "h-8 px-3 text-[0.75rem]",
        md: "h-10 px-6",
        lg: "h-12 px-7",
      },
    },
    defaultVariants: { variant: "accent", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = "Button";
