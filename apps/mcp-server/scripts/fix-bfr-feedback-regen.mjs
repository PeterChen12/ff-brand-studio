#!/usr/bin/env node
/**
 * Phase E · Iter 01 — flip feedback_regen=true on the BFR tenant.
 *
 * The provisioner originally didn't set this flag; the regenerate
 * endpoint at /v1/assets/:id/regenerate gates on it and returns
 * 403 feature_disabled when missing. After this script runs, the
 * BFR client can click Regenerate in the studio dashboard.
 *
 * Idempotent: jsonb concat (`||`) merges the key with right-side
 * priority. Re-running is safe and prints the current value.
 *
 * Usage:
 *   set -a && source ../../.env && set +a
 *   node scripts/fix-bfr-feedback-regen.mjs
 */
import postgres from "postgres";

const TENANT_ID = "32b1f9d2-6c9c-46bf-a1f6-1be69b1abeb5";

function envFirst(...names) {
  for (const n of names) if (process.env[n]) return process.env[n];
  return undefined;
}

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
  const [before] = await sql`
    SELECT features
    FROM tenants
    WHERE id = ${TENANT_ID}
  `;
  if (!before) {
    console.error(`tenant ${TENANT_ID} not found`);
    process.exit(1);
  }
  const wasEnabled = before.features?.feedback_regen === true;
  console.log(`before: feedback_regen = ${before.features?.feedback_regen ?? "(unset)"}`);

  await sql`
    UPDATE tenants
    SET features = features || '{"feedback_regen": true}'::jsonb
    WHERE id = ${TENANT_ID}
  `;

  const [after] = await sql`
    SELECT features
    FROM tenants
    WHERE id = ${TENANT_ID}
  `;
  console.log(`after:  feedback_regen = ${after.features?.feedback_regen}`);
  if (!wasEnabled) {
    console.log("✓ BFR can now regenerate assets via the studio dashboard.");
  } else {
    console.log("(already enabled; no-op)");
  }
} finally {
  await sql.end({ timeout: 5 });
}
