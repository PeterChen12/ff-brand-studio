// Brand rules are inlined as a TypeScript object so this module works in
// Cloudflare Workers (no node:fs, no node:path, no yaml runtime dependency).

export interface BrandRules {
  version: string;
  brand: string;
  tagline: string;
  colors: {
    primary_blue: string;
    electric_blue: string;
    ff_white: string;
    ff_black: string;
    accent_gold: string;
    dark_navy: string;
    max_delta_e: number;
  };
  typography: {
    primary_font_en: string;
    fallback_font_en: string;
    primary_font_zh: string;
    fallback_font_zh: string;
    min_logo_clear_space_px: number;
    hierarchy: Record<string, { weight: string; min_size_pt: number }>;
  };
  logo: {
    placement: string[];
    forbidden_placements: string[];
    min_contrast_ratio: number;
    min_size_px: number;
    lockup_variants: string[];
  };
  imagery: {
    vehicle_shots: {
      required_quality: string;
      forbidden: string[];
      preferred_backgrounds: string[];
    };
    lifestyle: {
      subject_archetypes: string[];
      forbidden: string[];
    };
    backgrounds: {
      preferred: string[];
      forbidden: string[];
    };
  };
  copy: {
    forbidden_phrases_en: string[];
    required_tone: string;
    max_exclamation_marks: number;
    bilingual_alignment: boolean;
    technical_terms_to_preserve: string[];
    chinese_romanization_policy: string;
  };
  scoring: {
    weights: {
      color_compliance: number;
      typography_compliance: number;
      logo_placement: number;
      image_quality: number;
      copy_tone: number;
    };
    pass_threshold: number;
    auto_approve_threshold: number;
    critical_violation_cap: number;
  };
  campaign_formats: Record<
    string,
    { max_words?: number; max_chars?: number; tone: string; bilingual?: boolean }
  >;
}

export const brandRules: BrandRules = {
  version: "1.0",
  brand: "Faraday Future",
  tagline: "Transforming the Future of Mobility",
  colors: {
    primary_blue: "#1C3FAA",
    electric_blue: "#00A8E8",
    ff_white: "#FFFFFF",
    ff_black: "#0A0A0A",
    accent_gold: "#C9A84C",
    dark_navy: "#0D1B4B",
    max_delta_e: 12,
  },
  typography: {
    primary_font_en: "Maison Neue",
    fallback_font_en: "Inter",
    primary_font_zh: "Source Han Sans SC",
    fallback_font_zh: "PingFang SC",
    min_logo_clear_space_px: 40,
    hierarchy: {
      h1: { weight: "bold", min_size_pt: 32 },
      h2: { weight: "semibold", min_size_pt: 24 },
      body: { weight: "regular", min_size_pt: 14 },
      caption: { weight: "regular", min_size_pt: 11 },
    },
  },
  logo: {
    placement: ["top-left", "bottom-center", "bottom-right"],
    forbidden_placements: [
      "center-overlap-vehicle",
      "over-busy-background",
      "bottom-left-when-text-heavy",
    ],
    min_contrast_ratio: 4.5,
    min_size_px: 80,
    lockup_variants: ["horizontal", "stacked", "icon-only"],
  },
  imagery: {
    vehicle_shots: {
      required_quality: "studio-grade or location-cinematic",
      forbidden: [
        "blurry",
        "low-resolution",
        "visible-compression-artifacts",
        "amateur-lighting",
        "consumer-camera-bokeh",
        "stock-photo-feel",
      ],
      preferred_backgrounds: [
        "dark seamless studio",
        "architectural minimalism",
        "dramatic landscape",
        "urban luxury district",
      ],
    },
    lifestyle: {
      subject_archetypes: ["entrepreneur", "innovator", "global-traveler"],
      forbidden: ["suburban-family", "budget-conscious-shopper"],
    },
    backgrounds: {
      preferred: ["dark-gradient", "architectural", "minimalist", "moody-urban"],
      forbidden: [
        "stock-photo-generic",
        "cluttered",
        "competing-brand-elements",
        "busy-pattern",
      ],
    },
  },
  copy: {
    forbidden_phrases_en: [
      "cheap",
      "affordable",
      "budget",
      "discount",
      "deal",
      "sale",
      "low cost",
      "inexpensive",
    ],
    required_tone: "aspirational, precise, investor-grade, future-forward",
    max_exclamation_marks: 0,
    bilingual_alignment: true,
    technical_terms_to_preserve: [
      "FF91",
      "FF81",
      "FF71",
      "FF Super One",
      "FFID",
      "FARADAY FUTURE",
      "aiHyper",
      "Emotion Internet of Vehicle",
      "EIoV",
      "SPS",
      "APF",
    ],
    chinese_romanization_policy:
      "keep English for model names, localize brand story",
  },
  scoring: {
    weights: {
      color_compliance: 0.2,
      typography_compliance: 0.2,
      logo_placement: 0.15,
      image_quality: 0.25,
      copy_tone: 0.2,
    },
    pass_threshold: 70,
    auto_approve_threshold: 85,
    critical_violation_cap: 40,
  },
  campaign_formats: {
    linkedin_post: {
      max_words: 280,
      tone: "investor-grade, precise, professional",
    },
    weibo_post: {
      max_chars: 140,
      tone: "conversational but premium",
    },
    square_infographic: {
      tone: "aspirational, precise, investor-grade, future-forward",
      bilingual: true,
    },
  },
};

export function getWeights(): BrandRules["scoring"]["weights"] {
  return brandRules.scoring.weights;
}

export function computeWeightedScore(
  dimensions: Record<keyof BrandRules["scoring"]["weights"], number>
): number {
  const w = brandRules.scoring.weights;
  return Math.round(
    dimensions.color_compliance * w.color_compliance +
      dimensions.typography_compliance * w.typography_compliance +
      dimensions.logo_placement * w.logo_placement +
      dimensions.image_quality * w.image_quality +
      dimensions.copy_tone * w.copy_tone
  );
}
