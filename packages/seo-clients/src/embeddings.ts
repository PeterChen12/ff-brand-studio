/**
 * Lightweight embeddings + agglomerative clustering for keyword sets.
 *
 * Embeddings backend: OpenAI `text-embedding-3-small` (1536-dim, $0.02 / 1M
 * tokens — ~$0.001 per 1,000 keywords). We picked OpenAI over Xenova/WASM
 * because the Worker bundle penalty for `@xenova/transformers` (>80MB
 * model + >1MB compressed runtime) blows past Cloudflare's free-tier limits.
 * If we ever care about offline embedding, swap `embed()` for the Xenova
 * version — interface stays the same.
 *
 * Clustering: simple greedy agglomerative — for each item, find the
 * existing cluster whose centroid is within `threshold` cosine similarity
 * and merge; otherwise start a new cluster. O(n × k). Good enough for
 * <1k keywords. For >5k consider HNSW or DBSCAN.
 *
 * Cluster representative: the longest member (proxy for specificity —
 * "wireless car charger 15w qi3" is a better rep than "car charger").
 */

const OPENAI_EMBED_URL = "https://api.openai.com/v1/embeddings";
const MODEL = "text-embedding-3-small";

export interface EmbedItem {
  text: string;
  vector: number[];
}

export async function embed(
  texts: string[],
  apiKey: string,
  model: string = MODEL
): Promise<{ items: EmbedItem[]; costUsd: number }> {
  if (texts.length === 0) return { items: [], costUsd: 0 };
  const cleaned = texts.map((t) => t.trim()).filter(Boolean);
  if (cleaned.length === 0) return { items: [], costUsd: 0 };

  const res = await fetch(OPENAI_EMBED_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: cleaned }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenAI embeddings ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
    usage: { total_tokens: number };
  };
  // text-embedding-3-small: $0.02 / 1M tokens
  const costUsd = (data.usage.total_tokens / 1_000_000) * 0.02;

  // Order may be out-of-order in some responses; sort by index just in case
  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  const items = sorted.map((d, i) => ({
    text: cleaned[d.index ?? i],
    vector: d.embedding,
  }));
  return { items, costUsd: Math.round(costUsd * 1e6) / 1e6 };
}

// ── Cosine helpers ──────────────────────────────────────────────────────────

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

function meanVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const out = new Array<number>(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) out[i] += v[i];
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  return out;
}

// ── Greedy agglomerative clustering ─────────────────────────────────────────

export interface Cluster {
  representative: string;
  members: string[];
  /** Avg cosine similarity within the cluster — higher = tighter */
  cohesion: number;
}

interface InternalCluster {
  centroid: number[];
  members: EmbedItem[];
}

export function clusterByCosine(
  items: EmbedItem[],
  threshold: number = 0.78
): Cluster[] {
  const clusters: InternalCluster[] = [];

  for (const item of items) {
    let bestIdx = -1;
    let bestSim = -Infinity;
    for (let i = 0; i < clusters.length; i++) {
      const sim = cosine(clusters[i].centroid, item.vector);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestSim >= threshold) {
      const c = clusters[bestIdx];
      c.members.push(item);
      c.centroid = meanVector(c.members.map((m) => m.vector));
    } else {
      clusters.push({ centroid: item.vector.slice(), members: [item] });
    }
  }

  return clusters
    .map((c) => {
      // Representative = longest member text (specificity proxy)
      const rep = c.members.reduce((a, b) =>
        a.text.length >= b.text.length ? a : b
      );
      // Cohesion = mean pairwise cosine
      let pairSum = 0;
      let pairs = 0;
      for (let i = 0; i < c.members.length; i++) {
        for (let j = i + 1; j < c.members.length; j++) {
          pairSum += cosine(c.members[i].vector, c.members[j].vector);
          pairs++;
        }
      }
      const cohesion = pairs > 0 ? pairSum / pairs : 1;
      return {
        representative: rep.text,
        members: c.members.map((m) => m.text),
        cohesion: Math.round(cohesion * 1000) / 1000,
      };
    })
    .sort((a, b) => b.members.length - a.members.length);
}
