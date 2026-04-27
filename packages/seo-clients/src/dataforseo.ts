/**
 * DataForSEO HTTP client for keyword research.
 * Auth: HTTP Basic (login:password).
 * Endpoints used: keywords_data/google_ads/search_volume/live,
 * dataforseo_labs/google/related_keywords/live,
 * dataforseo_labs/amazon/related_keywords/live.
 *
 * Cost notes (Apr 2026 list price):
 * - Search volume live: $0.05 / 1k keywords (rounded up)
 * - Related kw live: $0.02 / call
 * - Amazon related live: $0.02 / call
 * Standard (queued) endpoints are 3.3× cheaper but add latency. Use Live for
 * the small batches research_keywords typically sends.
 */

const BASE = "https://api.dataforseo.com/v3";

export interface KeywordVolume {
  term: string;
  searchVolume: number | null;
  competition: number | null;       // 0..1 normalized
  competitionLevel: "LOW" | "MEDIUM" | "HIGH" | null;
  cpc: number | null;               // USD
  monthlySearches?: Array<{ year: number; month: number; searchVolume: number | null }>;
}

export interface RelatedKeyword {
  term: string;
  searchVolume: number | null;
  competition: number | null;
  cpc: number | null;
  intent: string | null;            // 'commercial' | 'informational' | etc.
  depth: number;                    // distance from seed in the related-graph
}

export interface AmazonKeyword {
  term: string;
  searchVolume: number | null;
  competition: number | null;       // 0..1 normalized; Amazon-only signal
  cpc?: number | null;
  depth: number;
}

export type Market = "amazon-us" | "google-us" | "google-cn" | "baidu";

const LOCATION_CODE: Record<Market, number> = {
  "amazon-us": 2840,
  "google-us": 2840,
  "google-cn": 2156,
  "baidu": 2156,
};

const LANGUAGE_CODE: Record<Market, string> = {
  "amazon-us": "en",
  "google-us": "en",
  "google-cn": "zh",
  "baidu": "zh",
};

const LANGUAGE_NAME: Record<Market, string> = {
  "amazon-us": "English",
  "google-us": "English",
  "google-cn": "Chinese",
  "baidu": "Chinese",
};

interface DataForSEOResponse<T = unknown> {
  status_code: number;
  status_message?: string;
  tasks: Array<{
    status_code: number;
    status_message?: string;
    result: T[] | null;
    cost?: number;
  }>;
  cost?: number;
}

export class DataForSEOClient {
  private readonly authHeader: string;

  constructor(login: string, password: string) {
    if (!login || !password) {
      throw new Error("DataForSEOClient requires login + password");
    }
    // btoa is available in Workers + Node 20+
    this.authHeader = "Basic " + btoa(`${login}:${password}`);
  }

  private async post<T>(path: string, body: unknown): Promise<DataForSEOResponse<T>> {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.authHeader,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      // Rate limited — caller should back off + retry
      throw new Error(`DataForSEO 429 rate-limited at ${path}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`DataForSEO ${res.status} at ${path}: ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as DataForSEOResponse<T>;
    if (data.status_code !== 20000) {
      throw new Error(
        `DataForSEO error ${data.status_code}: ${data.status_message ?? "unknown"}`
      );
    }
    return data;
  }

  /**
   * Search-volume snapshot for a batch of keywords.
   * Cost: $0.05 per 1,000 keywords (rounded up). 1 call recommended for ≤1000.
   */
  async searchVolume(keywords: string[], market: Market): Promise<{
    results: KeywordVolume[];
    costUsd: number;
  }> {
    if (keywords.length === 0) return { results: [], costUsd: 0 };
    const trimmed = keywords.map((k) => k.trim()).filter(Boolean).slice(0, 1000);
    const data = await this.post<{
      keyword: string;
      search_volume: number | null;
      competition: number | null;
      competition_level: KeywordVolume["competitionLevel"];
      cpc: number | null;
      monthly_searches?: Array<{ year: number; month: number; search_volume: number | null }>;
    }>("/keywords_data/google_ads/search_volume/live", [
      {
        keywords: trimmed,
        location_code: LOCATION_CODE[market],
        language_code: LANGUAGE_CODE[market],
      },
    ]);

    const rows = data.tasks?.[0]?.result ?? [];
    return {
      results: rows.map((r) => ({
        term: r.keyword,
        searchVolume: r.search_volume,
        competition: r.competition,
        competitionLevel: r.competition_level,
        cpc: r.cpc,
        monthlySearches: r.monthly_searches?.map((m) => ({
          year: m.year,
          month: m.month,
          searchVolume: m.search_volume,
        })),
      })),
      costUsd: data.cost ?? data.tasks?.[0]?.cost ?? 0,
    };
  }

  /**
   * Related keywords from Google's keyword graph (semantic + behavioral).
   * Good for English broad-discovery; combine with `expand_seed` autocomplete
   * for cheap top-of-funnel before paying for related_keywords.
   */
  async relatedKeywords(
    seed: string,
    market: Market,
    opts: { depth?: number; limit?: number } = {}
  ): Promise<{ results: RelatedKeyword[]; costUsd: number }> {
    const data = await this.post<{
      seed_keyword: string;
      items?: Array<{
        keyword_data: {
          keyword: string;
          keyword_info?: {
            search_volume: number | null;
            competition: number | null;
            cpc: number | null;
          };
          search_intent_info?: { main_intent: string | null };
        };
        depth: number;
      }>;
    }>("/dataforseo_labs/google/related_keywords/live", [
      {
        keyword: seed,
        location_code: LOCATION_CODE[market],
        language_name: LANGUAGE_NAME[market],
        depth: opts.depth ?? 2,
        limit: opts.limit ?? 100,
      },
    ]);

    const items = data.tasks?.[0]?.result?.[0]?.items ?? [];
    return {
      results: items.map((it) => ({
        term: it.keyword_data.keyword,
        searchVolume: it.keyword_data.keyword_info?.search_volume ?? null,
        competition: it.keyword_data.keyword_info?.competition ?? null,
        cpc: it.keyword_data.keyword_info?.cpc ?? null,
        intent: it.keyword_data.search_intent_info?.main_intent ?? null,
        depth: it.depth,
      })),
      costUsd: data.cost ?? data.tasks?.[0]?.cost ?? 0,
    };
  }

  /**
   * Amazon-specific related keywords. Use when the target marketplace is
   * Amazon US — the keyword set differs meaningfully from Google's.
   */
  async amazonRelated(
    seed: string,
    opts: { depth?: number; limit?: number } = {}
  ): Promise<{ results: AmazonKeyword[]; costUsd: number }> {
    const data = await this.post<{
      seed_keyword: string;
      items?: Array<{
        keyword_data: {
          keyword: string;
          keyword_info?: {
            search_volume: number | null;
            competition: number | null;
            cpc?: number | null;
          };
        };
        depth: number;
      }>;
    }>("/dataforseo_labs/amazon/related_keywords/live", [
      {
        keyword: seed,
        location_code: 2840, // Amazon US is the only public location
        language_name: "English",
        depth: opts.depth ?? 2,
        limit: opts.limit ?? 100,
      },
    ]);

    const items = data.tasks?.[0]?.result?.[0]?.items ?? [];
    return {
      results: items.map((it) => ({
        term: it.keyword_data.keyword,
        searchVolume: it.keyword_data.keyword_info?.search_volume ?? null,
        competition: it.keyword_data.keyword_info?.competition ?? null,
        cpc: it.keyword_data.keyword_info?.cpc ?? null,
        depth: it.depth,
      })),
      costUsd: data.cost ?? data.tasks?.[0]?.cost ?? 0,
    };
  }
}
