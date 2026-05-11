/**
 * Phase F · Iter 08 — Agentic folder classifier (server-side).
 *
 * Takes a list of file paths + kinds (the operator's just-uploaded
 * batch) and asks Sonnet to propose a manifest grouping the files
 * into products. The dashboard UI consumes the manifest, lets the
 * operator review confidence-flagged rows, edit assignments, and
 * confirm onboarding.
 *
 * This iteration ships the SERVER LIB ONLY. The endpoint wrapper
 * (POST /v1/products/agentic-classify) and the dashboard UI
 * (Agentic tab on /products/*) are explicitly out of scope here —
 * they'd push F8 past the 200-line iteration cap. Future F8.1 +
 * F8.2 iterations can wire them in.
 *
 * Cost: one Sonnet 4.6 call per batch (~$0.05 for 30 products).
 */
import Anthropic from "@anthropic-ai/sdk";

export interface AgenticFileEntry {
  path: string;
  kind: "image" | "docx" | "pdf" | "text" | "unknown";
  /** R2 key where the file is staged (the dashboard uploads to a
   *  temp prefix; the classifier sees only the paths, not the bytes). */
  r2_key: string;
}

export interface AgenticProductEntry {
  name: string;
  description?: string;
  references: string[]; // r2 keys
  /** 0-1 self-reported by Sonnet. <0.7 → flag for operator review. */
  confidence: number;
  /** Plain-language reason for flagged confidence. Empty when high. */
  reason?: string;
}

export interface AgenticManifest {
  products: AgenticProductEntry[];
  /** Files Sonnet couldn't confidently assign to any product. */
  unassigned: Array<{ path: string; r2_key: string; reason: string }>;
  /** Cost of the classifier call. */
  cost_cents: number;
}

const SYSTEM_PROMPT = `You organize a folder of files uploaded by an e-commerce operator into a product manifest.

The operator drops a flat list of file paths from a vendor batch. Your job: group them into products. Each product has 1-N reference images and optionally a description-bearing file (docx/pdf/txt at the same folder level).

Conventions you've seen:
  - Each subfolder = one product (e.g. /BulkBatch/sku-001/hero.jpg, /BulkBatch/sku-001/side.jpg)
  - OR loose images at the root grouped by filename prefix (e.g. zeus-1000-front.jpg, zeus-1000-side.jpg → one product)
  - OR a docx with the product name at the head of the file + images in the same folder

For each product you identify:
  - name: short marketing-friendly title (1-50 chars)
  - description: brief if a docx/pdf/txt is present at the same folder level
  - references: list of r2_key strings for that product's images
  - confidence: 0-1. Below 0.7 means YOU think this grouping is uncertain — set 'reason' explaining why.

Files you cannot confidently assign go into 'unassigned' with a 'reason'.

Return JSON ONLY:
{
  "products": [
    { "name": "...", "description": "...", "references": ["r2_key_1", "r2_key_2"], "confidence": 0.85 }
  ],
  "unassigned": [
    { "path": "...", "r2_key": "...", "reason": "..." }
  ]
}`;

const COST_CENTS = 5;

export async function classifyFolderContents(args: {
  files: AgenticFileEntry[];
  anthropicKey?: string;
}): Promise<AgenticManifest> {
  if (!args.anthropicKey || args.files.length === 0) {
    return {
      products: [],
      unassigned: args.files.map((f) => ({
        path: f.path,
        r2_key: f.r2_key,
        reason: "classifier unavailable (no anthropic key)",
      })),
      cost_cents: 0,
    };
  }

  const client = new Anthropic({ apiKey: args.anthropicKey });
  const userMsg = `Files (one per line, format: path|kind|r2_key):\n\n${args.files
    .map((f) => `${f.path}|${f.kind}|${f.r2_key}`)
    .join("\n")}`;

  let raw = "";
  try {
    const resp = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMsg }],
    });
    raw = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "";
  } catch {
    return {
      products: [],
      unassigned: args.files.map((f) => ({
        path: f.path,
        r2_key: f.r2_key,
        reason: "classifier API error",
      })),
      cost_cents: 0,
    };
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      products: [],
      unassigned: args.files.map((f) => ({
        path: f.path,
        r2_key: f.r2_key,
        reason: "classifier returned non-JSON",
      })),
      cost_cents: COST_CENTS,
    };
  }
  let parsed: { products?: unknown; unassigned?: unknown };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return {
      products: [],
      unassigned: args.files.map((f) => ({
        path: f.path,
        r2_key: f.r2_key,
        reason: "classifier returned malformed JSON",
      })),
      cost_cents: COST_CENTS,
    };
  }

  const products: AgenticProductEntry[] = Array.isArray(parsed.products)
    ? (parsed.products as Array<Record<string, unknown>>)
        .map((p) => ({
          name: typeof p.name === "string" ? p.name.slice(0, 100) : "(unnamed)",
          description: typeof p.description === "string" ? p.description.slice(0, 5000) : undefined,
          references: Array.isArray(p.references)
            ? (p.references as unknown[]).filter((r): r is string => typeof r === "string").slice(0, 10)
            : [],
          confidence:
            typeof p.confidence === "number" && p.confidence >= 0 && p.confidence <= 1
              ? p.confidence
              : 0.5,
          reason: typeof p.reason === "string" ? p.reason : undefined,
        }))
        .filter((p) => p.references.length > 0)
        .slice(0, 100)
    : [];

  const unassigned: AgenticManifest["unassigned"] = Array.isArray(parsed.unassigned)
    ? (parsed.unassigned as Array<Record<string, unknown>>)
        .map((u) => ({
          path: typeof u.path === "string" ? u.path : "(unknown)",
          r2_key: typeof u.r2_key === "string" ? u.r2_key : "",
          reason: typeof u.reason === "string" ? u.reason : "unspecified",
        }))
        .filter((u) => u.r2_key.length > 0)
        .slice(0, 50)
    : [];

  return { products, unassigned, cost_cents: COST_CENTS };
}
