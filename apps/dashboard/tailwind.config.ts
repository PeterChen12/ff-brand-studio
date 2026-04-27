import type { Config } from "tailwindcss";

/**
 * Tailwind reads M3 design tokens from globals.css. Tokens are stored as
 * `R G B` triplets (no rgb() wrapper) so we can compose `rgb(var(--token) /
 * <alpha-value>)` and let Tailwind's opacity modifier (e.g. `bg-primary/20`)
 * still work.
 *
 * Naming convention: M3 sys.color roles are exposed under their semantic
 * names (primary, surface, on-surface...) so a developer reading
 * `<div className="bg-surface-container">` knows it maps to a Material 3
 * surface tier, not an arbitrary palette name.
 */

const m3 = (name: string) => `rgb(var(--md-sys-color-${name}) / <alpha-value>)`;
const ff = (name: string) => `rgb(var(--ff-${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: m3("primary"),
          on: m3("on-primary"),
          container: m3("primary-container"),
          "on-container": m3("on-primary-container"),
        },
        secondary: {
          DEFAULT: m3("secondary"),
          on: m3("on-secondary"),
          container: m3("secondary-container"),
          "on-container": m3("on-secondary-container"),
        },
        tertiary: {
          DEFAULT: m3("tertiary"),
          on: m3("on-tertiary"),
          container: m3("tertiary-container"),
          "on-container": m3("on-tertiary-container"),
        },
        error: {
          DEFAULT: m3("error"),
          on: m3("on-error"),
          container: m3("error-container"),
          "on-container": m3("on-error-container"),
        },
        surface: {
          DEFAULT: m3("surface"),
          dim: m3("surface-dim"),
          bright: m3("surface-bright"),
          "container-lowest": m3("surface-container-lowest"),
          "container-low": m3("surface-container-low"),
          container: m3("surface-container"),
          "container-high": m3("surface-container-high"),
          "container-highest": m3("surface-container-highest"),
        },
        "on-surface": {
          DEFAULT: m3("on-surface"),
          variant: m3("on-surface-variant"),
        },
        outline: {
          DEFAULT: m3("outline"),
          variant: m3("outline-variant"),
        },
        inverse: {
          surface: m3("inverse-surface"),
          "on-surface": m3("inverse-on-surface"),
          primary: m3("inverse-primary"),
        },
        // FF accents (extend the M3 system, not replace)
        "ff-vermilion-deep": ff("vermilion-deep"),
        "ff-saffron": ff("saffron"),
        "ff-amber": ff("amber"),
        "ff-jade-deep": ff("jade-deep"),
      },
      fontFamily: {
        brand: ["var(--md-ref-typeface-brand)"],
        plain: ["var(--md-ref-typeface-plain)"],
        mono: ["var(--md-ref-typeface-mono)"],
      },
      borderRadius: {
        // Map to M3 shape tokens
        "m3-xs": "var(--md-sys-shape-corner-extra-small)",
        "m3-sm": "var(--md-sys-shape-corner-small)",
        "m3-md": "var(--md-sys-shape-corner-medium)",
        "m3-lg": "var(--md-sys-shape-corner-large)",
        "m3-xl": "var(--md-sys-shape-corner-extra-large)",
        "m3-full": "var(--md-sys-shape-corner-full)",
      },
      boxShadow: {
        "m3-1": "var(--md-sys-elevation-level-1)",
        "m3-2": "var(--md-sys-elevation-level-2)",
        "m3-3": "var(--md-sys-elevation-level-3)",
        "m3-4": "var(--md-sys-elevation-level-4)",
        "m3-5": "var(--md-sys-elevation-level-5)",
      },
      transitionTimingFunction: {
        "m3-standard": "var(--md-sys-motion-easing-standard)",
        "m3-emphasized": "var(--md-sys-motion-easing-emphasized)",
        "m3-emph-accelerate": "var(--md-sys-motion-easing-emphasized-accelerate)",
        "m3-emph-decelerate": "var(--md-sys-motion-easing-emphasized-decelerate)",
      },
      transitionDuration: {
        "m3-short3": "150ms",
        "m3-short4": "200ms",
        "m3-medium2": "300ms",
        "m3-long1": "450ms",
      },
      letterSpacing: {
        stamp: "0.16em",
      },
      animation: {
        "fade-up": "fadeUp 450ms cubic-bezier(0.05, 0.7, 0.1, 1) both",
        "stagger-1": "fadeUp 450ms cubic-bezier(0.05, 0.7, 0.1, 1) 80ms both",
        "stagger-2": "fadeUp 450ms cubic-bezier(0.05, 0.7, 0.1, 1) 160ms both",
        "stagger-3": "fadeUp 450ms cubic-bezier(0.05, 0.7, 0.1, 1) 240ms both",
        "stamp-in": "stampIn 350ms cubic-bezier(0.2, 0.6, 0.2, 1.2) both",
        "shimmer": "shimmer 1.6s linear infinite",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        stampIn: {
          "0%": { opacity: "0", transform: "scale(1.12) rotate(-3deg)" },
          "100%": { opacity: "1", transform: "scale(1) rotate(-1.5deg)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
