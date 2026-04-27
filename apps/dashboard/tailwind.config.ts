import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Cross-border atelier palette — paper + ink + vermilion saffron
        paper: {
          DEFAULT: "rgb(var(--paper) / <alpha-value>)",
          deep: "rgb(var(--paper-deep) / <alpha-value>)",
          dim: "rgb(var(--paper-dim) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          soft: "rgb(var(--ink-soft) / <alpha-value>)",
          mute: "rgb(var(--ink-mute) / <alpha-value>)",
        },
        mist: "rgb(var(--mist) / <alpha-value>)",
        // Accent system — Chinese seal vermilion + oxidized jade + oxide rust
        vermilion: {
          DEFAULT: "rgb(var(--vermilion) / <alpha-value>)",
          deep: "rgb(var(--vermilion-deep) / <alpha-value>)",
        },
        jade: {
          DEFAULT: "rgb(var(--jade) / <alpha-value>)",
          deep: "rgb(var(--jade-deep) / <alpha-value>)",
        },
        oxide: "rgb(var(--oxide) / <alpha-value>)",
        amber: "rgb(var(--amber) / <alpha-value>)",
      },
      fontFamily: {
        // Display: Fraunces (variable, optical-size, sharp serif, editorial weight)
        display: ["Fraunces", "ui-serif", "Georgia", "serif"],
        // Body: Geist (deliberately not Inter; sharper and more technical)
        sans: ["Geist", "ui-sans-serif", "system-ui", "sans-serif"],
        // Mono: JetBrains Mono — technical numbers, SKU codes
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Editorial-leaning scale — generous large sizes, tight small ones
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.06em" }],
        "xs": ["0.75rem", { lineHeight: "1rem", letterSpacing: "0.04em" }],
        "display-1": ["clamp(3rem, 8vw, 5.5rem)", { lineHeight: "0.95", letterSpacing: "-0.04em" }],
        "display-2": ["clamp(2rem, 5vw, 3.5rem)", { lineHeight: "1", letterSpacing: "-0.03em" }],
        "display-3": ["clamp(1.5rem, 3vw, 2.25rem)", { lineHeight: "1.05", letterSpacing: "-0.02em" }],
      },
      letterSpacing: {
        stamp: "0.18em", // for uppercase customs-stamp small caps
      },
      borderWidth: {
        hair: "0.5px",
      },
      backgroundImage: {
        // Subtle grid — like ledger lines on parchment
        "grid-fine":
          "linear-gradient(to right, rgb(var(--mist) / 0.4) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--mist) / 0.4) 1px, transparent 1px)",
        // Diagonal seal-stamp accent
        "stamp-diag":
          "repeating-linear-gradient(45deg, rgb(var(--vermilion) / 0.08) 0 1px, transparent 1px 8px)",
      },
      backgroundSize: {
        grid: "24px 24px",
      },
      animation: {
        "fade-up": "fadeUp 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "stamp-in": "stampIn 0.4s cubic-bezier(0.2, 0.6, 0.2, 1.2) both",
        "tick": "tick 0.4s ease-out both",
        "shimmer": "shimmer 2.4s linear infinite",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        stampIn: {
          "0%": { opacity: "0", transform: "scale(1.15) rotate(-3deg)" },
          "100%": { opacity: "1", transform: "scale(1) rotate(-1.5deg)" },
        },
        tick: {
          "0%": { transform: "translateY(4px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
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
