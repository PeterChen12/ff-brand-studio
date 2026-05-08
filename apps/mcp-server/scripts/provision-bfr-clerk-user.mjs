#!/usr/bin/env node
/**
 * Provision a Clerk user + organization for the BFR enterprise tenant
 * and rebind the studio tenant row to the new real org_id.
 *
 * Before this script: tenants.clerk_org_id was synthetic
 *   "manual:bfr:support@buyfishingrod.com" — no Clerk identity, API-only.
 * After this script: tenants.clerk_org_id is a real Clerk org id, and
 *   peter can sign in to the studio dashboard as
 *   support@buyfishingrod.com / Qiufengkejifafa8! to test the BFR
 *   client experience.
 *
 * Steps (idempotent — re-run safely):
 *   1. Look up or create Clerk user (email pre-verified by Backend API)
 *   2. Look up or create Clerk org with the user as admin
 *   3. Update tenants.clerk_org_id in studio Postgres
 *
 * Usage:
 *   set -a && source ../../.env && set +a
 *   node scripts/provision-bfr-clerk-user.mjs
 *
 * Env required:
 *   CLERK_SECRET_KEY (sk_live_...) — looked up under
 *     FF_BRAND_STUDIO_CLERK_SECRET_KEY first, then CLERK_SECRET_KEY
 *   PG* / FF_PG* — for the studio Postgres connection
 */

import postgres from "postgres";

const TENANT_ID = "32b1f9d2-6c9c-46bf-a1f6-1be69b1abeb5";
const EMAIL = "support@buyfishingrod.com";
const PASSWORD = "Qiufengkejifafa8!";
const ORG_NAME = "buyfishingrod (BFR)";
const ORG_SLUG = "buyfishingrod-bfr";

function envFirst(...names) {
  for (const n of names) if (process.env[n]) return process.env[n];
  return undefined;
}

async function clerk(path, init = {}) {
  const key = envFirst("FF_BRAND_STUDIO_CLERK_SECRET_KEY", "CLERK_SECRET_KEY");
  if (!key) throw new Error("CLERK_SECRET_KEY not set");
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const err = new Error(`Clerk ${path} -> ${res.status}: ${text}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function findOrCreateUser() {
  // Backend API: list users by email_address[]
  const found = await clerk(`/users?email_address=${encodeURIComponent(EMAIL)}&limit=1`);
  if (Array.isArray(found) && found.length > 0) {
    console.log(`user exists  id=${found[0].id}`);
    return found[0];
  }
  console.log(`creating user ${EMAIL}…`);
  const created = await clerk("/users", {
    method: "POST",
    body: JSON.stringify({
      email_address: [EMAIL],
      password: PASSWORD,
      skip_password_checks: true,
      skip_password_requirement: false,
    }),
  });
  console.log(`user created id=${created.id}`);
  return created;
}

async function findOrCreateOrg(creatorUserId) {
  const found = await clerk(`/organizations?query=${encodeURIComponent(ORG_NAME)}&limit=10`);
  const list = Array.isArray(found?.data) ? found.data : Array.isArray(found) ? found : [];
  const match = list.find((o) => o.name === ORG_NAME);
  if (match) {
    console.log(`org exists   id=${match.id}`);
    return match;
  }
  console.log(`creating org "${ORG_NAME}"…`);
  const created = await clerk("/organizations", {
    method: "POST",
    body: JSON.stringify({
      name: ORG_NAME,
      created_by: creatorUserId,
    }),
  });
  console.log(`org created  id=${created.id}`);
  return created;
}

async function ensureMembership(orgId, userId) {
  const memberships = await clerk(`/organizations/${orgId}/memberships?limit=100`);
  const list = Array.isArray(memberships?.data) ? memberships.data : Array.isArray(memberships) ? memberships : [];
  const existing = list.find((m) => m.public_user_data?.user_id === userId);
  if (existing) {
    console.log(`membership exists role=${existing.role}`);
    return;
  }
  console.log(`adding user as admin…`);
  await clerk(`/organizations/${orgId}/memberships`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId, role: "org:admin" }),
  });
  console.log(`membership added`);
}

async function rebindTenant(orgId) {
  const sql = postgres({
    host: envFirst("PGHOST", "FF_PGHOST"),
    port: Number(envFirst("PGPORT", "FF_PGPORT") ?? "5432"),
    database: envFirst("PGDATABASE", "FF_PGDATABASE"),
    username: envFirst("PGUSER", "FF_PGUSER"),
    password: envFirst("PGPASSWORD", "FF_PGPASSWORD"),
    ssl: false,
    max: 1,
  });
  try {
    const rows = await sql`
      UPDATE tenants
      SET clerk_org_id = ${orgId}
      WHERE id = ${TENANT_ID}
      RETURNING id, name, clerk_org_id, plan, wallet_balance_cents
    `;
    if (rows.length === 0) {
      throw new Error(`tenant ${TENANT_ID} not found`);
    }
    const t = rows[0];
    console.log(`tenant rebound`);
    console.log(`  id: ${t.id}`);
    console.log(`  name: ${t.name}`);
    console.log(`  clerk_org_id: ${t.clerk_org_id}  (was synthetic 'manual:bfr:…')`);
    console.log(`  plan: ${t.plan}  wallet: $${(t.wallet_balance_cents / 100).toFixed(2)}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  const user = await findOrCreateUser();
  const org = await findOrCreateOrg(user.id);
  await ensureMembership(org.id, user.id);
  await rebindTenant(org.id);

  console.log("");
  console.log("─── done — sign-in handoff ───");
  console.log(`URL:      https://image-generation.buyfishingrod.com/sign-in`);
  console.log(`Email:    ${EMAIL}`);
  console.log(`Password: ${PASSWORD}`);
  console.log(`Org:      ${org.name} (${org.id})`);
}

main().catch((err) => {
  console.error("provision-bfr-clerk-user failed:", err.message);
  if (err.body) console.error("body:", JSON.stringify(err.body, null, 2));
  process.exit(1);
});
