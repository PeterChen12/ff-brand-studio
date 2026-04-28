/**
 * Phase M5 — per-tenant data export.
 *
 * Streams every row tagged with the current tenant_id across the
 * domain tables. Output is one CSV per table, bundled into a single
 * ZIP. Used for GDPR-style tenant dumps and trust-and-safety
 * investigations.
 *
 * Wallet ledger + audit_events included so a downloaded dump is a
 * complete record of the tenant's platform footprint.
 */

import { eq, inArray } from "drizzle-orm";
import {
  sellerProfiles,
  products,
  productVariants,
  productReferences,
  platformAssets,
  platformListings,
  launchRuns,
  walletLedger,
  auditEvents,
  apiKeys,
  webhookSubscriptions,
} from "../db/schema.js";
import type { DbClient } from "../db/client.js";

interface ExportInput {
  tenantId: string;
}

function csvEscape(s: unknown): string {
  if (s === null || s === undefined) return "";
  const str = typeof s === "string" ? s : typeof s === "object" ? JSON.stringify(s) : String(s);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvEscape(r[c])).join(","));
  return lines.join("\n");
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Same store-only ZIP builder as Phase K3. Avoids jszip dep. */
function buildZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const cdChunks: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;
    const lfh = new Uint8Array(30 + nameBytes.length);
    const lfhView = new DataView(lfh.buffer);
    lfhView.setUint32(0, 0x04034b50, true);
    lfhView.setUint16(4, 20, true);
    lfhView.setUint16(8, 0, true);
    lfhView.setUint32(14, crc, true);
    lfhView.setUint32(18, size, true);
    lfhView.setUint32(22, size, true);
    lfhView.setUint16(26, nameBytes.length, true);
    lfh.set(nameBytes, 30);
    localChunks.push(lfh, f.data);
    const cdh = new Uint8Array(46 + nameBytes.length);
    const cdhView = new DataView(cdh.buffer);
    cdhView.setUint32(0, 0x02014b50, true);
    cdhView.setUint16(4, 20, true);
    cdhView.setUint16(6, 20, true);
    cdhView.setUint32(16, crc, true);
    cdhView.setUint32(20, size, true);
    cdhView.setUint32(24, size, true);
    cdhView.setUint16(28, nameBytes.length, true);
    cdhView.setUint32(42, offset, true);
    cdh.set(nameBytes, 46);
    cdChunks.push(cdh);
    offset += lfh.length + size;
  }
  const cdSize = cdChunks.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, cdSize, true);
  eocdView.setUint32(16, offset, true);
  const total = localChunks.reduce((s, c) => s + c.length, 0) + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of localChunks) { out.set(c, p); p += c.length; }
  for (const c of cdChunks) { out.set(c, p); p += c.length; }
  out.set(eocd, p);
  return out;
}

export async function buildTenantExport(
  db: DbClient,
  input: ExportInput
): Promise<Uint8Array> {
  const tid = input.tenantId;

  // Pull every tenant-scoped row.
  const sellers = await db.select().from(sellerProfiles).where(eq(sellerProfiles.tenantId, tid));
  const productRows = await db.select().from(products).where(eq(products.tenantId, tid));
  const productIds = productRows.map((p) => p.id);
  const variants = productIds.length
    ? await db.select().from(productVariants).where(inArray(productVariants.productId, productIds))
    : [];
  const refs = productIds.length
    ? await db.select().from(productReferences).where(inArray(productReferences.productId, productIds))
    : [];
  const variantIds = variants.map((v) => v.id);
  const assets = variantIds.length
    ? await db.select().from(platformAssets).where(inArray(platformAssets.variantId, variantIds))
    : [];
  const listings = variantIds.length
    ? await db.select().from(platformListings).where(inArray(platformListings.variantId, variantIds))
    : [];
  const runs = await db.select().from(launchRuns).where(eq(launchRuns.tenantId, tid));
  const ledger = await db.select().from(walletLedger).where(eq(walletLedger.tenantId, tid));
  const audit = await db.select().from(auditEvents).where(eq(auditEvents.tenantId, tid));
  const keys = await db
    .select({
      id: apiKeys.id,
      prefix: apiKeys.prefix,
      name: apiKeys.name,
      created_at: apiKeys.createdAt,
      last_used_at: apiKeys.lastUsedAt,
      revoked_at: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.tenantId, tid));
  const subs = await db
    .select({
      id: webhookSubscriptions.id,
      url: webhookSubscriptions.url,
      events: webhookSubscriptions.events,
      created_at: webhookSubscriptions.createdAt,
      disabled_at: webhookSubscriptions.disabledAt,
    })
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.tenantId, tid));

  const enc = new TextEncoder();
  const files: Array<{ name: string; data: Uint8Array }> = [
    { name: "tenant.json", data: enc.encode(JSON.stringify({ tenant_id: tid, exported_at: new Date().toISOString() }, null, 2)) },
    { name: "seller_profiles.csv", data: enc.encode(rowsToCsv(sellers as unknown as Record<string, unknown>[])) },
    { name: "products.csv", data: enc.encode(rowsToCsv(productRows as unknown as Record<string, unknown>[])) },
    { name: "product_variants.csv", data: enc.encode(rowsToCsv(variants as unknown as Record<string, unknown>[])) },
    { name: "product_references.csv", data: enc.encode(rowsToCsv(refs as unknown as Record<string, unknown>[])) },
    { name: "platform_assets.csv", data: enc.encode(rowsToCsv(assets as unknown as Record<string, unknown>[])) },
    { name: "platform_listings.csv", data: enc.encode(rowsToCsv(listings as unknown as Record<string, unknown>[])) },
    { name: "launch_runs.csv", data: enc.encode(rowsToCsv(runs as unknown as Record<string, unknown>[])) },
    { name: "wallet_ledger.csv", data: enc.encode(rowsToCsv(ledger as unknown as Record<string, unknown>[])) },
    { name: "audit_events.csv", data: enc.encode(rowsToCsv(audit as unknown as Record<string, unknown>[])) },
    { name: "api_keys.csv", data: enc.encode(rowsToCsv(keys as unknown as Record<string, unknown>[])) },
    { name: "webhook_subscriptions.csv", data: enc.encode(rowsToCsv(subs as unknown as Record<string, unknown>[])) },
  ];
  return buildZip(files);
}
