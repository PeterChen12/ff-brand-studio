#!/usr/bin/env node
/**
 * Provision the buyfishingrod-admin enterprise client.
 *
 * Creates: tenant row, $1000 wallet credit, ff_live_ API key, and
 * (optionally) a webhook subscription pointing at BFR's listener.
 *
 * Skips Clerk user creation — BFR's integration is API-only. If they
 * ever want to log into our dashboard, an operator can mint the Clerk
 * user manually and bind it to this tenant via clerkOrgId.
 *
 * Usage:
 *   pnpm -F ff-mcp-server exec node scripts/provision-bfr-client.mjs
 *
 * Reads PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD from process.env
 * (fallback to FF_PG* if PG* is unset). The .env at the repo root
 * has all of these populated.
 *
 * Idempotent: re-running with the same EMAIL just prints the existing
 * api_key prefix + wallet balance without creating duplicates. It
 * does NOT re-issue the API key — full key is shown ONCE on creation.
 */

import postgres from "postgres";
import crypto from "node:crypto";

const EMAIL = "support@buyfishingrod.com";
const TENANT_NAME = "buyfishingrod (BFR)";
const CREDIT_CENTS = 100_000; // $1000
const PLAN = "enterprise";
const FEATURES = {
  production_pipeline: true,
  default_platforms: ["amazon", "shopify"],
  amazon_a_plus_grid: true,
  rate_limit_per_min: 240,
  publish_destinations: ["buyfishingrod-admin"],
  // Phase E · Iter 01 — enable per-asset regenerate for enterprise.
  // Gated at index.ts: regenerate returns 403 feature_disabled unless
  // this flag is true. Enterprise tier always gets it; lower tiers
  // require explicit per-tenant opt-in.
  feedback_regen: true,
};
// Synthetic clerkOrgId so the unique-not-null constraint is satisfied
// without requiring a real Clerk org. Stable so re-runs are idempotent.
const CLERK_ORG_ID = `manual:bfr:${EMAIL}`;
const API_KEY_LABEL = "buyfishingrod-admin integration";

function envFirst(...names) {
  for (const n of names) if (process.env[n]) return process.env[n];
  return undefined;
}

function b32(bytes) {
  const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHA[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHA[(value << (5 - bits)) & 0x1f];
  return out;
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

async function main() {
  const PGHOST = envFirst("PGHOST", "FF_PGHOST");
  const PGPORT = envFirst("PGPORT", "FF_PGPORT") ?? "5432";
  const PGDATABASE = envFirst("PGDATABASE", "FF_PGDATABASE");
  const PGUSER = envFirst("PGUSER", "FF_PGUSER");
  const PGPASSWORD = envFirst("PGPASSWORD", "FF_PGPASSWORD");
  if (!PGHOST || !PGDATABASE || !PGUSER || !PGPASSWORD) {
    console.error(
      "Missing PG* env vars. Source the repo .env first:\n" +
        "  set -a; source ../../.env; set +a"
    );
    process.exit(1);
  }

  const sql = postgres({
    host: PGHOST,
    port: Number(PGPORT),
    database: PGDATABASE,
    username: PGUSER,
    password: PGPASSWORD,
    ssl: false,
    max: 2,
  });

  try {
    // ─── Step 1: tenant (upsert by clerk_org_id) ───────────────────────
    const tenants = await sql`
      INSERT INTO tenants (clerk_org_id, name, plan, features, wallet_balance_cents)
      VALUES (
        ${CLERK_ORG_ID},
        ${TENANT_NAME},
        ${PLAN},
        ${sql.json(FEATURES)},
        0
      )
      ON CONFLICT (clerk_org_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        plan = EXCLUDED.plan,
        features = EXCLUDED.features
      RETURNING id, name, plan, wallet_balance_cents
    `;
    const tenant = tenants[0];
    console.log(`tenant: ${tenant.id}  name="${tenant.name}"  plan=${tenant.plan}`);

    // ─── Step 2: wallet credit (only if not already credited) ──────────
    // Use audit_events to check whether we've credited before. We tag
    // the credit with a known reference type so re-runs don't re-credit.
    const credits = await sql`
      SELECT id FROM wallet_ledger
      WHERE tenant_id = ${tenant.id}
        AND reason = 'admin_grant'
        AND reference_type = 'bfr_provisioning_v1'
      LIMIT 1
    `;
    if (credits.length === 0) {
      await sql.begin(async (tx) => {
        const [{ wallet_balance_cents: prev }] = await tx`
          SELECT wallet_balance_cents FROM tenants WHERE id = ${tenant.id} FOR UPDATE
        `;
        const next = (prev ?? 0) + CREDIT_CENTS;
        await tx`
          INSERT INTO wallet_ledger
            (tenant_id, delta_cents, reason, reference_type, balance_after_cents)
          VALUES
            (${tenant.id}, ${CREDIT_CENTS}, 'admin_grant', 'bfr_provisioning_v1', ${next})
        `;
        await tx`
          UPDATE tenants
          SET wallet_balance_cents = ${next}
          WHERE id = ${tenant.id}
        `;
      });
      console.log(`wallet credited: +${CREDIT_CENTS}¢ (= $${CREDIT_CENTS / 100})`);
    } else {
      const [bal] = await sql`SELECT wallet_balance_cents FROM tenants WHERE id = ${tenant.id}`;
      console.log(`wallet credit already applied; balance=${bal.wallet_balance_cents}¢`);
    }

    // ─── Step 3: api key (only mint if no active key exists) ───────────
    const existingKeys = await sql`
      SELECT id, prefix, name, created_at
      FROM api_keys
      WHERE tenant_id = ${tenant.id}
        AND name = ${API_KEY_LABEL}
        AND revoked_at IS NULL
      LIMIT 1
    `;

    let fullKey = null;
    let keyPrefix = null;
    if (existingKeys.length === 0) {
      const random = crypto.randomBytes(32);
      const secret = b32(new Uint8Array(random));
      keyPrefix = secret.slice(0, 8);
      fullKey = `ff_live_${secret}`;
      const hash = sha256Hex(fullKey);
      await sql`
        INSERT INTO api_keys (tenant_id, prefix, hash, name, created_by)
        VALUES (${tenant.id}, ${keyPrefix}, ${hash}, ${API_KEY_LABEL}, ${"system:provision"})
      `;
      console.log(`api key minted prefix=${keyPrefix}  (full key shown below)`);
    } else {
      keyPrefix = existingKeys[0].prefix;
      console.log(
        `api key already exists prefix=${keyPrefix} created=${existingKeys[0].created_at} — full key NOT recoverable`
      );
    }

    console.log("");
    console.log("─── handoff to buyfishingrod-admin (Amplify env) ───");
    console.log(`FF_STUDIO_API_BASE       = https://mcp.creatorain.workers.dev`);
    if (fullKey) {
      console.log(`FF_STUDIO_API_KEY        = ${fullKey}`);
    } else {
      console.log(
        `FF_STUDIO_API_KEY        = (already minted — re-run after revoking ${keyPrefix} to mint a new one)`
      );
    }
    console.log(
      `FF_STUDIO_WEBHOOK_SECRET = (mint via the dashboard /settings?tab=webhooks once peter signs in)`
    );
    console.log("");
    console.log("BFR contact email (info only):", EMAIL);
    console.log("Tenant ID:", tenant.id);
    console.log("Wallet balance: $" + (CREDIT_CENTS / 100).toFixed(2));
    console.log("");
    console.log("Next steps:");
    console.log("  1. Set the three env vars above in Amplify (App d31yf50gqy7wgc)");
    console.log("  2. Trigger a redeploy");
    console.log(
      "  3. Open a buyfishingrod-admin product, click 'Send to FF Brand Studio'"
    );
    console.log("  4. Watch the studio /inbox for HITL review");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("provision failed:", err);
  process.exit(1);
});
