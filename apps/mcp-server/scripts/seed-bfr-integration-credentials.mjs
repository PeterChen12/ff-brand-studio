#!/usr/bin/env node
/**
 * P1 — one-shot script to migrate the legacy BFR config out of worker
 * env vars and into the canonical integration_credentials table.
 *
 * Reads:
 *   FF_STUDIO_WEBHOOK_SECRET — the shared HMAC secret BFR + FF Studio agree on
 *   BFR_ADMIN_BASE_URL       — e.g. https://admin.buyfishingrod.com
 *   CREDENTIAL_KEK_HEX        — 64-char hex KEK from worker secrets
 *   BFR_TENANT_ID            — the tenant uuid for the BFR account
 *   FF_PG*                    — postgres connection (host, port, etc.)
 *
 * Idempotent: re-running rotates the secret in place.
 */
import postgres from "postgres";
import { randomBytes, createCipheriv } from "node:crypto";
import { Buffer } from "node:buffer";

function encrypt(kekHex, cleartext) {
  const key = Buffer.from(kekHex, "hex");
  if (key.length !== 32) throw new Error("CREDENTIAL_KEK_HEX must be 32 bytes / 64 hex chars");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const pt = Buffer.from(JSON.stringify(cleartext), "utf8");
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    ciphertext: Buffer.concat([ct, tag]).toString("base64"),
    kek_version: 1,
  };
}

const TENANT_ID = process.env.BFR_TENANT_ID;
const SECRET = process.env.FF_STUDIO_WEBHOOK_SECRET;
const BASE = process.env.BFR_ADMIN_BASE_URL ?? "https://admin.buyfishingrod.com";
const KEK = process.env.CREDENTIAL_KEK_HEX;

if (!TENANT_ID || !SECRET || !KEK) {
  console.error("set BFR_TENANT_ID, FF_STUDIO_WEBHOOK_SECRET, CREDENTIAL_KEK_HEX");
  process.exit(1);
}

const blob = encrypt(KEK, { baseUrl: BASE, signingSecret: SECRET });

const sql = postgres({
  host: process.env.FF_PGHOST ?? process.env.PGHOST,
  port: Number(process.env.FF_PGPORT ?? process.env.PGPORT ?? 5432),
  database: process.env.FF_PGDATABASE ?? process.env.PGDATABASE,
  username: process.env.FF_PGUSER ?? process.env.PGUSER,
  password: process.env.FF_PGPASSWORD ?? process.env.PGPASSWORD,
  ssl: false,
  max: 1,
});

try {
  const existing = await sql`
    SELECT id FROM integration_credentials
    WHERE tenant_id = ${TENANT_ID} AND provider = 'buyfishingrod-admin'
    LIMIT 1
  `;
  if (existing.length > 0) {
    await sql`
      UPDATE integration_credentials
      SET encrypted_credentials = ${sql.json(blob)},
          rotated_at = now(),
          status = 'active'
      WHERE id = ${existing[0].id}
    `;
    console.log(`rotated existing row ${existing[0].id}`);
  } else {
    const [row] = await sql`
      INSERT INTO integration_credentials
        (tenant_id, provider, account_label, encrypted_credentials, status)
      VALUES (
        ${TENANT_ID},
        'buyfishingrod-admin',
        'BFR production',
        ${sql.json(blob)},
        'active'
      )
      RETURNING id
    `;
    console.log(`inserted row ${row.id}`);
  }
} finally {
  await sql.end();
}
