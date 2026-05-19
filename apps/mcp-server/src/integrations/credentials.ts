/**
 * Per-tenant credential resolution for marketplace adapters.
 *
 * Each tenant configures one (or more) downstream destinations via the
 * `integration_credentials` table. The row stores an encrypted blob
 * with the adapter-specific config (baseUrl, signingSecret, OAuth
 * tokens, etc.). Adapters call `resolveCredentials()` instead of
 * reaching into worker env directly — that's the key abstraction
 * that lets FF Studio host N tenants without per-tenant code.
 *
 * Dual-write fallback (P1 → P3 window):
 *   - If no `integration_credentials` row exists for (tenantId, provider)
 *     AND the provider is "buyfishingrod-admin", we fall back to the
 *     legacy worker env vars `FF_STUDIO_WEBHOOK_SECRET` +
 *     `BFR_ADMIN_BASE_URL` so the existing BFR deployment keeps working.
 *   - That fallback gets removed in P3 once dual-write writes have
 *     replicated to integration_credentials and reads have switched.
 */

import { and, eq } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import { integrationCredentials } from "../db/schema.js";
import { decryptCredentials, type EncryptedBlob } from "../lib/crypto.js";

export interface ResolvedCredentials {
  /** Stable id for telemetry — the integration_credentials row id, or
   *  "env-fallback:<provider>" when the legacy env-var path was taken. */
  source: string;
  /** Adapter-specific config (e.g. { baseUrl, signingSecret, accessToken }). */
  config: Record<string, unknown>;
}

export class CredentialsNotFoundError extends Error {
  constructor(public tenantId: string, public provider: string) {
    super(`No active credentials for tenant=${tenantId} provider=${provider}`);
    this.name = "CredentialsNotFoundError";
  }
}

// Accept the full CloudflareBindings type implicitly (any binding-shaped
// object). The narrow fields below are all we actually read.
type WorkerEnvShape = {
  CREDENTIAL_KEK_HEX?: string;
  FF_STUDIO_WEBHOOK_SECRET?: string;
  BFR_ADMIN_BASE_URL?: string;
  [k: string]: unknown;
};

export async function resolveCredentials(
  db: DbClient,
  env: WorkerEnvShape,
  tenantId: string,
  provider: string
): Promise<ResolvedCredentials> {
  // Try DB first — the canonical path.
  const [row] = await db
    .select({
      id: integrationCredentials.id,
      encryptedCredentials: integrationCredentials.encryptedCredentials,
      status: integrationCredentials.status,
    })
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, provider)
      )
    )
    .limit(1);

  if (row && row.status === "active") {
    if (!env.CREDENTIAL_KEK_HEX) {
      throw new Error(
        "CREDENTIAL_KEK_HEX not bound — cannot decrypt integration_credentials"
      );
    }
    const config = await decryptCredentials<Record<string, unknown>>(
      env.CREDENTIAL_KEK_HEX,
      row.encryptedCredentials as unknown as EncryptedBlob
    );
    return { source: row.id, config };
  }

  // Legacy fallback: worker-env for the BFR-admin path. Scheduled for
  // removal in P3.
  if (provider === "buyfishingrod-admin") {
    if (env.FF_STUDIO_WEBHOOK_SECRET && env.BFR_ADMIN_BASE_URL) {
      console.warn(
        `[credentials] tenant=${tenantId} provider=${provider}: using env-fallback (P3 will remove this)`
      );
      return {
        source: "env-fallback:buyfishingrod-admin",
        config: {
          baseUrl: env.BFR_ADMIN_BASE_URL,
          signingSecret: env.FF_STUDIO_WEBHOOK_SECRET,
        },
      };
    }
  }

  throw new CredentialsNotFoundError(tenantId, provider);
}

/**
 * Adapter-friendly typed view of the resolved config. Adapters that
 * expect baseUrl + signingSecret (the BFR-like pattern) can use this
 * helper instead of poking at config keys directly.
 */
export function requireString(config: Record<string, unknown>, key: string): string {
  const v = config[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`integration credentials missing required field: ${key}`);
  }
  return v;
}
