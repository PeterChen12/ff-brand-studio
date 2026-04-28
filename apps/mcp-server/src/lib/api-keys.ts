/**
 * Phase L1 — API key issuance + verification.
 *
 * Format: ff_live_<32-byte base32>. Stored as SHA-256(key) for fast
 * lookup; we don't use bcrypt because every request needs to verify
 * by hash and bcrypt's intentional slowness would make API auth ~100ms
 * per call. The key entropy is high enough (160 bits) that SHA-256
 * alone is strong against offline guessing IF an attacker exfiltrates
 * the api_keys table — and at that point bcrypt's marginal benefit is
 * also limited. If/when we change our minds, we add a bcrypt column
 * and re-issue.
 *
 * Cache: ff_live_<prefix>:hash → tenantId in SESSION_KV with 60s TTL,
 * keyed on the 8-char prefix portion of the key. So a key reused 100x
 * in 60 seconds = 1 SQL hit, not 100.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { apiKeys, type ApiKey } from "../db/schema.js";
import type { DbClient } from "../db/client.js";
import { auditEvent } from "./audit.js";

const KEY_PREFIX = "ff_live_";
const SECRET_BYTES = 32;
const CACHE_TTL_SECONDS = 60;

export interface IssueResult {
  /** Full key — only returned ONCE on issuance. */
  fullKey: string;
  prefix: string;
  id: string;
  name: string;
  createdAt: Date;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

function b32(bytes: Uint8Array): string {
  // Base32 lite (RFC 4648 alphabet) — URL-safe, case-insensitive.
  const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let out = "";
  let bits = 0;
  let value = 0;
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += ALPHA[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHA[(value << (5 - bits)) & 0x1f];
  return out;
}

export async function issueApiKey(
  db: DbClient,
  tenantId: string,
  name: string,
  createdBy: string | null
): Promise<IssueResult> {
  const random = new Uint8Array(SECRET_BYTES);
  crypto.getRandomValues(random);
  const secret = b32(random);
  // Prefix shown to user is the first 8 chars of the secret;
  // the full secret = prefix + remainder. Both halves are random
  // — the prefix isn't a "namespace", just the displayed substring.
  const prefix = secret.slice(0, 8);
  const fullKey = `${KEY_PREFIX}${secret}`;
  const hash = await sha256Hex(fullKey);

  const [row] = await db
    .insert(apiKeys)
    .values({ tenantId, prefix, hash, name, createdBy })
    .returning();

  await auditEvent(db, {
    tenantId,
    actor: createdBy,
    action: "api_key.created",
    targetType: "api_key",
    targetId: row.id,
    metadata: { prefix, name },
  });

  return {
    fullKey,
    prefix,
    id: row.id,
    name: row.name,
    createdAt: row.createdAt ?? new Date(),
  };
}

export async function listApiKeys(db: DbClient, tenantId: string): Promise<Array<Pick<ApiKey, "id" | "prefix" | "name" | "createdBy" | "createdAt" | "lastUsedAt" | "revokedAt">>> {
  return db
    .select({
      id: apiKeys.id,
      prefix: apiKeys.prefix,
      name: apiKeys.name,
      createdBy: apiKeys.createdBy,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.tenantId, tenantId))
    .orderBy(sql`${apiKeys.createdAt} desc`);
}

export async function revokeApiKey(
  db: DbClient,
  env: CloudflareBindings,
  tenantId: string,
  apiKeyId: string,
  actor: string | null
): Promise<{ ok: boolean; error?: string }> {
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, apiKeyId), eq(apiKeys.tenantId, tenantId)))
    .returning();
  if (!row) return { ok: false, error: "not_found" };

  // Drop cache entry on revoke so the very next request re-checks the DB.
  await env.SESSION_KV.delete(`api_key_lookup:${row.prefix}`);

  await auditEvent(db, {
    tenantId,
    actor,
    action: "api_key.revoked",
    targetType: "api_key",
    targetId: row.id,
    metadata: { prefix: row.prefix },
  });
  return { ok: true };
}

export interface ApiKeyResolution {
  tenantId: string;
  apiKeyId: string;
  prefix: string;
}

/**
 * Verify a Bearer token of shape `ff_live_*`. Returns null if invalid,
 * unknown, or revoked.
 *
 * Cached in SESSION_KV by prefix → {tenantId, hash, id} for 60s. Cache
 * stores the hash too so we still hash-compare on cache hit (the cache
 * just saves the SQL round trip, not the comparison work).
 */
export async function verifyApiKey(
  env: CloudflareBindings,
  db: DbClient,
  bearer: string
): Promise<ApiKeyResolution | null> {
  if (!bearer.startsWith(KEY_PREFIX)) return null;
  const secret = bearer.slice(KEY_PREFIX.length);
  if (secret.length < 16) return null;
  const prefix = secret.slice(0, 8);
  const hash = await sha256Hex(bearer);

  // 1. Cache lookup
  const cacheKey = `api_key_lookup:${prefix}`;
  const cached = await env.SESSION_KV.get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as { tenantId: string; hash: string; id: string };
      if (parsed.hash === hash) {
        return { tenantId: parsed.tenantId, apiKeyId: parsed.id, prefix };
      }
    } catch {
      // fall through and re-check DB
    }
  }

  // 2. DB lookup
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.prefix, prefix), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  if (row.hash !== hash) return null;

  // 3. Cache for 60s + best-effort lastUsedAt update (not awaited)
  await env.SESSION_KV.put(
    cacheKey,
    JSON.stringify({ tenantId: row.tenantId, hash: row.hash, id: row.id }),
    { expirationTtl: CACHE_TTL_SECONDS }
  );
  // fire-and-forget; one update per minute per key, not per request,
  // because the cache short-circuits subsequent requests in the window
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch((err) => console.warn("[api-keys] lastUsedAt update failed:", err));

  return { tenantId: row.tenantId, apiKeyId: row.id, prefix };
}
