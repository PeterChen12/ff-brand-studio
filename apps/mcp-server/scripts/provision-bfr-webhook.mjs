#!/usr/bin/env node
/**
 * Mint a webhook subscription for the BFR tenant pointing at the
 * buyfishingrod-admin listener. Idempotent on (tenant_id, url): a
 * second run with the same URL no-ops and prints the existing
 * subscription id (the secret is unrecoverable, so re-running does
 * NOT issue a new one — drop the row to rotate).
 *
 * Usage:
 *   pnpm -F ff-mcp-server exec node scripts/provision-bfr-webhook.mjs
 */

import postgres from "postgres";
import crypto from "node:crypto";

const TENANT_ID = "32b1f9d2-6c9c-46bf-a1f6-1be69b1abeb5";
const URL = "https://admin.buyfishingrod.com/api/integrations/ff-brand-studio/webhook";
const EVENTS = ["product.ingested", "asset.approved", "asset.rejected", "asset.published"];

function genSecret() {
  return `whsec_${crypto.randomBytes(32).toString("hex")}`;
}

function envFirst(...names) {
  for (const n of names) if (process.env[n]) return process.env[n];
  return undefined;
}

async function main() {
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
    const existing = await sql`
      SELECT id, secret, events, created_at
      FROM webhook_subscriptions
      WHERE tenant_id = ${TENANT_ID} AND url = ${URL} AND disabled_at IS NULL
      LIMIT 1
    `;
    if (existing.length > 0) {
      const row = existing[0];
      console.log(`subscription already exists`);
      console.log(`  id: ${row.id}`);
      console.log(`  secret: ${row.secret}  (re-issued from DB — store carefully)`);
      console.log(`  events: ${row.events.join(", ")}`);
      return;
    }
    const secret = genSecret();
    const inserted = await sql`
      INSERT INTO webhook_subscriptions (tenant_id, url, events, secret)
      VALUES (${TENANT_ID}, ${URL}, ${EVENTS}, ${secret})
      RETURNING id, created_at
    `;
    console.log(`subscription created`);
    console.log(`  id: ${inserted[0].id}`);
    console.log(`  url: ${URL}`);
    console.log(`  events: ${EVENTS.join(", ")}`);
    console.log(``);
    console.log(`FF_STUDIO_WEBHOOK_SECRET = ${secret}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("provision-bfr-webhook failed:", err);
  process.exit(1);
});
