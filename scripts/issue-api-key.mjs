#!/usr/bin/env node
/**
 * Issue an ff_live_* API key for a tenant — Clerk-free path.
 *
 * Mirrors apps/mcp-server/src/lib/api-keys.ts (b32 secret, SHA-256 hash,
 * 8-char prefix). Inserts directly into api_keys; the worker's verifyApiKey
 * recognizes the key on the next request with no further wiring.
 *
 * Usage:
 *   node scripts/issue-api-key.mjs --clerk-org org_abc --name "lucy-fallback"
 *   node scripts/issue-api-key.mjs --tenant-id <uuid> --name "..."
 *   node scripts/issue-api-key.mjs --list-tenants
 *
 * Required env (reads the creatorain .env automatically):
 *   FF_PGHOST FF_PGPORT FF_PGDATABASE FF_PGUSER PGPASSWORD
 *   (falls back to PGHOST/PGPORT/PGDATABASE/PGUSER if FF_PG* unset)
 *
 * Prints the FULL key once on success — copy immediately, it can never be
 * recovered (only the SHA-256 is stored). Also prints a dashboard URL with
 * ?ff_api_key=... that the recipient can bookmark as a fallback login.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";

const ENV_PATH = resolve(
  process.env.USERPROFILE ?? process.env.HOME ?? ".",
  "OneDrive",
  "桌面",
  "creatorain",
  "Claude_Code_Context",
  ".env"
);
const DASHBOARD_URL =
  process.env.FF_BRAND_STUDIO_DASHBOARD_URL ?? "https://ff-brand-studio.pages.dev";

function loadDotenv() {
  if (!existsSync(ENV_PATH)) return;
  const text = readFileSync(ENV_PATH, "utf-8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const k = m[1];
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadDotenv();

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { clerkOrg: null, tenantId: null, name: null, list: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--list-tenants") out.list = true;
    else if (a === "--clerk-org") out.clerkOrg = args[++i];
    else if (a === "--tenant-id") out.tenantId = args[++i];
    else if (a === "--name") out.name = args[++i];
    else if (a === "-h" || a === "--help") {
      console.log(readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 22).join("\n"));
      process.exit(0);
    }
  }
  return out;
}

function pgClient() {
  const host = process.env.FF_PGHOST ?? process.env.PGHOST;
  const port = Number(process.env.FF_PGPORT ?? process.env.PGPORT ?? 5432);
  const database = process.env.FF_PGDATABASE ?? process.env.PGDATABASE;
  const user = process.env.FF_PGUSER ?? process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  if (!host || !database || !user || !password) {
    console.error("ERROR: missing one of FF_PGHOST/FF_PGDATABASE/FF_PGUSER/PGPASSWORD in env");
    process.exit(1);
  }
  return postgres({ host, port, database, user, password, ssl: false, max: 1 });
}

const B32_ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32(bytes) {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHA[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHA[(value << (5 - bits)) & 0x1f];
  return out;
}

function sha256Hex(s) {
  return createHash("sha256").update(s).digest("hex");
}

async function main() {
  const { clerkOrg, tenantId, name, list } = parseArgs();
  const sql = pgClient();
  try {
    if (list) {
      const rows = await sql`SELECT id, clerk_org_id, name, plan FROM tenants ORDER BY created_at`;
      console.log("Tenants:");
      for (const r of rows) {
        console.log(`  ${r.id}  org=${(r.clerk_org_id ?? "").padEnd(34)}  ${(r.name ?? "").padEnd(30)}  plan=${r.plan}`);
      }
      return;
    }

    if (!name) {
      console.error("ERROR: --name is required (e.g. --name \"lucy-fallback-2026-05-26\")");
      process.exit(1);
    }
    if (!clerkOrg && !tenantId) {
      console.error("ERROR: must pass --clerk-org <org_*> OR --tenant-id <uuid> (use --list-tenants to find one)");
      process.exit(1);
    }

    const [tenant] = tenantId
      ? await sql`SELECT id, clerk_org_id, name FROM tenants WHERE id = ${tenantId} LIMIT 1`
      : await sql`SELECT id, clerk_org_id, name FROM tenants WHERE clerk_org_id = ${clerkOrg} LIMIT 1`;
    if (!tenant) {
      console.error(`ERROR: tenant not found (${tenantId ?? clerkOrg})`);
      process.exit(1);
    }

    const secret = b32(randomBytes(32));
    const prefix = secret.slice(0, 8);
    const fullKey = `ff_live_${secret}`;
    const hash = sha256Hex(fullKey);

    const [row] = await sql`
      INSERT INTO api_keys (tenant_id, prefix, hash, name, created_by)
      VALUES (${tenant.id}, ${prefix}, ${hash}, ${name}, ${"script:issue-api-key.mjs"})
      RETURNING id, created_at
    `;

    // Also write an audit row mirroring lib/api-keys.ts behavior.
    await sql`
      INSERT INTO audit_events (tenant_id, actor, action, target_type, target_id, metadata)
      VALUES (${tenant.id}, ${"script:issue-api-key.mjs"}, ${"api_key.created"},
              ${"api_key"}, ${row.id}, ${sql.json({ prefix_last4: prefix.slice(-4), name, source: "script" })})
    `.catch((err) => {
      console.warn("[warn] audit insert failed (non-fatal):", err.message);
    });

    const fallbackUrl = `${DASHBOARD_URL}/?ff_api_key=${encodeURIComponent(fullKey)}`;

    console.log("");
    console.log("API key issued.");
    console.log("");
    console.log(`  Tenant      : ${tenant.name} (org=${tenant.clerk_org_id}, id=${tenant.id})`);
    console.log(`  Key name    : ${name}`);
    console.log(`  Prefix      : ${prefix}`);
    console.log(`  Issued at   : ${row.created_at.toISOString()}`);
    console.log("");
    console.log(`  FULL KEY    : ${fullKey}`);
    console.log("");
    console.log(`  Fallback URL: ${fallbackUrl}`);
    console.log("");
    console.log("Copy the FULL KEY immediately — only SHA-256(key) is stored, the");
    console.log("plaintext cannot be recovered. The fallback URL bookmarks the key");
    console.log("into the dashboard's localStorage and bypasses Clerk on auth failure.");
  } finally {
    await sql.end({ timeout: 2 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
