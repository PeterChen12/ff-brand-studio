/**
 * requireTenant Hono middleware — Phase G.
 *
 * Verifies a Clerk session JWT (preferred) or session cookie, extracts
 * the active organization id, and resolves it to a tenant row via
 * ensureTenantForOrg. Attaches both `tenant` and `actor` (Clerk user id)
 * to the Hono context for downstream handlers.
 *
 * 401 cases:
 *   - No Authorization header AND no __session cookie
 *   - Invalid / expired JWT
 *   - JWT has no `org_id` claim (force-orgs is enforced — every signed-in
 *     user must be acting in the context of an organization)
 *
 * Open routes (apply middleware *after* declaring these): /health,
 * /v1/clerk-webhook, /v1/stripe-webhook (Phase H), /sse + /messages
 * (MCP transport — for now). Phase L will tighten MCP behind API keys.
 */

import type { Context, Next } from "hono";
import { verifyToken } from "@clerk/backend";
import { eq } from "drizzle-orm";
import { createDbClient } from "../db/client.js";
import { ensureTenantForOrg } from "./tenants.js";
import { tenants, type Tenant } from "../db/schema.js";
import { verifyApiKey } from "./api-keys.js";

export interface AuthVars {
  tenant: Tenant;
  actor: string; // Clerk user id
}

export type AuthedContext = Context<{
  Bindings: CloudflareBindings;
  Variables: AuthVars;
}>;

function extractToken(c: Context): string | null {
  const authHeader = c.req.header("authorization") ?? c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  // Fallback to the __session cookie used by same-origin Clerk Next.js apps.
  const cookie = c.req.header("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)__session=([^;]+)/);
  return match?.[1] ?? null;
}

export async function requireTenant(
  c: Context<{ Bindings: CloudflareBindings; Variables: AuthVars }>,
  next: Next
) {
  const token = extractToken(c);
  if (!token) {
    return c.json({ error: "unauthenticated", code: "missing_token" }, 401);
  }

  // Phase L1 — accept ff_live_* API keys as an alternative to Clerk JWTs.
  if (token.startsWith("ff_live_")) {
    const db = createDbClient(c.env);
    const resolved = await verifyApiKey(c.env, db, token);
    if (!resolved) {
      return c.json({ error: "unauthenticated", code: "invalid_api_key" }, 401);
    }
    const [tenantRow] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, resolved.tenantId))
      .limit(1);
    if (!tenantRow) {
      return c.json({ error: "unauthenticated", code: "tenant_missing" }, 401);
    }
    if (tenantRow.plan === "deleted") {
      return c.json({ error: "tenant_deleted", code: "tenant_deleted" }, 403);
    }
    c.set("tenant", tenantRow);
    c.set("actor", `api_key:${resolved.prefix}`);
    await next();
    return;
  }

  let payload: Awaited<ReturnType<typeof verifyToken>>;
  try {
    payload = await verifyToken(token, {
      secretKey: c.env.CLERK_SECRET_KEY,
    });
  } catch (err) {
    return c.json(
      {
        error: "unauthenticated",
        code: "invalid_token",
        detail: err instanceof Error ? err.message : String(err),
      },
      401
    );
  }

  const orgId = (payload as { org_id?: string }).org_id;
  const userId = (payload as { sub?: string }).sub;
  const orgName = (payload as { org_name?: string }).org_name ?? "Unnamed Org";

  if (!orgId || !userId) {
    return c.json(
      {
        error: "unauthenticated",
        code: "missing_org_context",
        detail:
          "JWT lacks org_id — force-orgs is enabled, every request must be made in the context of an organization",
      },
      401
    );
  }

  const db = createDbClient(c.env);
  const tenant = await ensureTenantForOrg(db, orgId, orgName);

  if (tenant.plan === "deleted") {
    return c.json({ error: "tenant_deleted", code: "tenant_deleted" }, 403);
  }

  c.set("tenant", tenant);
  c.set("actor", userId);
  await next();
}
