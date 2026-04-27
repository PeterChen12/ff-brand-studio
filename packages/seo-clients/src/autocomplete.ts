/**
 * Free-tier keyword discovery — public autocomplete endpoints.
 *
 * Amazon, Google, and Taobao/Tmall expose unauthenticated suggest endpoints
 * intended for their own search-box typeahead. We legally read them as a
 * caller (read-only public reflections of crowd-sourced query streams).
 *
 * Strategy: alphabet-trick — fan out the seed query with each appended
 * letter (a-z, 0-9), dedupe, return up to N. 36× more suggestions per seed
 * than a single-shot call.
 *
 * Note: these endpoints rate-limit aggressively (esp. Amazon). Caller is
 * expected to throttle / cache. Worker callers should use SESSION_KV for
 * a 1h LRU around the whole result set, NOT around individual fan-out calls.
 */

export type Market = "amazon-us" | "google-us" | "google-cn" | "tmall";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789".split("");

interface AutocompleteResult {
  market: Market;
  seed: string;
  phrases: string[];
  source_calls: number;
  errors: number;
}

async function safeJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function safeText(url: string, init?: RequestInit): Promise<string | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ── Amazon US (mid=ATVPDKIKX0DER, alias=aps) ─────────────────────────────────

export async function amazonAutocomplete(seed: string): Promise<string[]> {
  const url =
    "https://completion.amazon.com/api/2017/suggestions" +
    `?mid=ATVPDKIKX0DER&alias=aps&prefix=${encodeURIComponent(seed)}&limit=11`;
  const data = await safeJson<{
    suggestions?: Array<{ value: string }>;
  }>(url, {
    headers: {
      // Amazon is more forgiving with a browser-like UA
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/json",
    },
  });
  return (data?.suggestions ?? []).map((s) => s.value).filter(Boolean);
}

// ── Google (firefox client returns clean JSON: [seed, [suggestions]]) ────────

export async function googleAutocomplete(seed: string, lang: "en" | "zh" = "en"): Promise<string[]> {
  const url =
    "https://suggestqueries.google.com/complete/search" +
    `?client=firefox&q=${encodeURIComponent(seed)}&hl=${lang}`;
  const text = await safeText(url);
  if (!text) return [];
  try {
    const arr = JSON.parse(text) as [string, string[]];
    return Array.isArray(arr) && Array.isArray(arr[1]) ? arr[1] : [];
  } catch {
    return [];
  }
}

// ── Tmall / Taobao suggest (returns text wrapped in callback or pure JSON) ───

export async function tmallAutocomplete(seed: string): Promise<string[]> {
  const url =
    "https://suggest.taobao.com/sug" +
    `?code=utf-8&q=${encodeURIComponent(seed)}`;
  const text = await safeText(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      Accept: "application/json,text/plain,*/*",
    },
  });
  if (!text) return [];
  // Response shape: {"result":[["手机","12345"], ...]}
  // Or sometimes wrapped in a callback (jsonp): callback({...})
  let raw = text.trim();
  const cb = raw.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*\((.*)\);?$/s);
  if (cb) raw = cb[1];
  try {
    const data = JSON.parse(raw) as { result?: Array<[string, string]> };
    return (data.result ?? []).map((tup) => tup[0]).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Alphabet-trick fan-out + dedupe ──────────────────────────────────────────

interface ExpandOptions {
  /** When true, run the alphabet-trick (36× fan-out). Default true. */
  alphabetTrick?: boolean;
  /** Cap on returned phrases. Default 200. */
  maxResults?: number;
  /** Concurrency cap for fan-out — Amazon throttles hard above ~6. Default 4. */
  concurrency?: number;
}

async function fanOut(
  seed: string,
  fetcher: (q: string) => Promise<string[]>,
  opts: ExpandOptions
): Promise<{ phrases: Set<string>; calls: number; errors: number }> {
  const queries = opts.alphabetTrick
    ? [seed, ...ALPHABET.map((a) => `${seed} ${a}`)]
    : [seed];
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 8));
  const phrases = new Set<string>();
  let calls = 0;
  let errors = 0;

  // Simple promise pool
  const queue = [...queries];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const q = queue.shift();
      if (!q) break;
      try {
        calls++;
        const out = await fetcher(q);
        for (const p of out) {
          const trimmed = p.trim();
          if (trimmed) phrases.add(trimmed.toLowerCase());
        }
      } catch {
        errors++;
      }
    }
  });
  await Promise.all(workers);
  return { phrases, calls, errors };
}

export async function expandSeed(
  seed: string,
  market: Market,
  opts: ExpandOptions = {}
): Promise<AutocompleteResult> {
  const { alphabetTrick = true, maxResults = 200 } = opts;
  let fetcher: (q: string) => Promise<string[]>;
  switch (market) {
    case "amazon-us":
      fetcher = amazonAutocomplete;
      break;
    case "google-us":
      fetcher = (q) => googleAutocomplete(q, "en");
      break;
    case "google-cn":
      fetcher = (q) => googleAutocomplete(q, "zh");
      break;
    case "tmall":
      fetcher = tmallAutocomplete;
      break;
  }

  let { phrases, calls, errors } = await fanOut(seed, fetcher, {
    ...opts,
    alphabetTrick,
  });

  // If alphabet-trick is failing aggressively (>50% errors), fall back to seed-only.
  if (errors / Math.max(1, calls) > 0.5 && alphabetTrick) {
    const fallback = await fanOut(seed, fetcher, { alphabetTrick: false, ...opts });
    phrases = fallback.phrases;
    calls += fallback.calls;
    errors += fallback.errors;
  }

  // Don't dedupe the seed itself — caller may want it
  const list = Array.from(phrases).slice(0, maxResults);
  return { market, seed, phrases: list, source_calls: calls, errors };
}
