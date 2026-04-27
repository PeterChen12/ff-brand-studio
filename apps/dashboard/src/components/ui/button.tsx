import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2",
    "font-mono text-2xs uppercase tracking-stamp",
    "transition-all duration-200",
    "disabled:pointer-events-none disabled:opacity-50",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-ink text-paper hover:bg-vermilion-deep active:translate-y-px",
        ghost: "text-ink-soft hover:text-ink hover:bg-paper-deep",
        outline:
          "border border-ink/40 text-ink hover:border-ink hover:bg-paper-deep",
        accent:
          "bg-vermilion text-paper hover:bg-vermilion-deep active:translate-y-px",
        link: "text-vermilion underline-offset-4 hover:underline px-0",
      },
      size: {
        sm: "h-8 px-3 text-[0.625rem]",
        md: "h-10 px-5",
        lg: "h-12 px-7 text-xs",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
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
