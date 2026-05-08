/**
 * Phase B (B6) — envelope encryption for marketplace credentials.
 *
 * Workers don't have a KMS binding, so we use a Worker secret-bound
 * AES-256-GCM key (CREDENTIAL_KEK_HEX, 64 hex chars = 32 bytes) as the
 * key-encryption key. Per-row IVs are 96-bit random (GCM standard).
 *
 * Storage shape (jsonb on integration_credentials.encrypted_credentials):
 *   {
 *     iv: string,          // base64
 *     ciphertext: string,  // base64 (includes the 16-byte GCM tag)
 *     kek_version: number  // for rotation; bumped when KEK rotates
 *   }
 *
 * Why not store a per-tenant DEK with the row? Two reasons:
 *   - Adds a key-management layer worth nothing without HSM-grade KEK
 *   - Workers cold-start time is precious; one less crypto.subtle.importKey
 * Trade-off: a KEK leak compromises every credential. Acceptable while
 * KEK lives in a Worker secret (never logged, only readable by infra
 * with prod creds). Bump to KMS when we have ≥10 enterprise customers.
 */

const CURRENT_KEK_VERSION = 1;

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("KEK_HEX must have even length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function b64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKek(kekHex: string): Promise<CryptoKey> {
  const keyBytes = hexToBytes(kekHex);
  if (keyBytes.length !== 32) {
    throw new Error("CREDENTIAL_KEK_HEX must decode to 32 bytes");
  }
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

export interface EncryptedBlob {
  iv: string;
  ciphertext: string;
  kek_version: number;
}

export async function encryptCredentials(
  kekHex: string,
  cleartext: Record<string, unknown>
): Promise<EncryptedBlob> {
  const key = await importKek(kekHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(cleartext));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    iv: b64Encode(iv),
    ciphertext: b64Encode(new Uint8Array(ct)),
    kek_version: CURRENT_KEK_VERSION,
  };
}

export async function decryptCredentials<T = Record<string, unknown>>(
  kekHex: string,
  blob: EncryptedBlob
): Promise<T> {
  const key = await importKek(kekHex);
  const iv = b64Decode(blob.iv);
  const ct = b64Decode(blob.ciphertext);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}
