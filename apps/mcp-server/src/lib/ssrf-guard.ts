/**
 * Phase 6 P6.8 — SSRF guard for tenant-supplied URLs.
 *
 * Pre-fix, `POST /v1/integrations` accepted any string in
 * `config.baseUrl`. A malicious tenant could register an integration
 * pointing at:
 *   - localhost / 127.0.0.1 — hit other services on the Worker host
 *     (none today on CF Workers, but the Worker DOES proxy outbound
 *     and any future binding would be at risk)
 *   - 169.254.169.254 — AWS/GCP metadata service (irrelevant on
 *     Cloudflare but defense-in-depth for future deploys)
 *   - 10.x / 172.16-31.x / 192.168.x — private RFC1918 ranges
 *   - http:// (not https) — credential leak over the wire when we
 *     POST signed webhooks
 *
 * The guard runs at *registration* time so a bad URL is rejected
 * synchronously rather than discovered when the webhook fires.
 *
 * NOT a TOCTOU-safe check: a tenant could pass a public DNS name that
 * resolves to a private IP at request time. Full DNS rebinding defense
 * would require resolving + checking the IP at every outbound request,
 * which is a separate hardening pass. For now, reject obvious abuse.
 */

export class UnsafeBaseUrlError extends Error {
  override readonly name = "UnsafeBaseUrlError" as const;
  constructor(public readonly reason: string, public readonly value: string) {
    super(`baseUrl rejected: ${reason} (${value})`);
  }
}

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::",
  "::1",
  // Cloud metadata services
  "169.254.169.254",
  "metadata.google.internal",
  "metadata",
]);

function isPrivateIPv4(host: string): boolean {
  // Rough check; doesn't need to be perfect because we already reject
  // hostnames first. Parses dotted-quad only.
  const parts = host.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 0) return true; // 0.0.0.0/8
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::" || h === "::1") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // ULA fc00::/7
  if (h.startsWith("fe80:")) return true; // link-local
  return false;
}

/**
 * Throws UnsafeBaseUrlError if the URL points at a forbidden destination.
 * Allowed: https://<public-dns-or-public-ip>[:port][/path]
 */
export function validateOutboundUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafeBaseUrlError("not a valid URL", rawUrl);
  }

  if (parsed.protocol !== "https:") {
    throw new UnsafeBaseUrlError(
      "only https:// is allowed (http leaks credentials in transit)",
      rawUrl
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTS.has(hostname)) {
    throw new UnsafeBaseUrlError("loopback / metadata host blocked", rawUrl);
  }

  // .local mDNS, .internal, single-label (would resolve via search domain)
  if (hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new UnsafeBaseUrlError("private TLD blocked", rawUrl);
  }
  if (!hostname.includes(".") && !/^\[?[0-9a-f:]+\]?$/.test(hostname)) {
    throw new UnsafeBaseUrlError("single-label hostname blocked", rawUrl);
  }

  // Literal IPv4 / IPv6 in the URL
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    if (isPrivateIPv4(hostname)) {
      throw new UnsafeBaseUrlError("private IPv4 blocked", rawUrl);
    }
  }
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const inner = hostname.slice(1, -1);
    if (isPrivateIPv6(inner)) {
      throw new UnsafeBaseUrlError("private IPv6 blocked", rawUrl);
    }
  } else if (hostname.includes(":") && isPrivateIPv6(hostname)) {
    throw new UnsafeBaseUrlError("private IPv6 blocked", rawUrl);
  }

  // Reject non-standard ports that are common internal services. The
  // allowlist is narrow on purpose: 80 (no, we forced https), 443, 8443.
  // If a tenant needs another port they ping ops.
  const port = parsed.port === "" ? null : parseInt(parsed.port, 10);
  if (port !== null && port !== 443 && port !== 8443) {
    throw new UnsafeBaseUrlError(`port ${port} not allowed (use 443 or 8443)`, rawUrl);
  }

  return parsed;
}
