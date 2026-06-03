/**
 * requireTenant Hono middleware.
 *
 * Verifies a Clerk session JWT (preferred), an `ff_live_*` API key, or
 * a session cookie. Resolves to a tenant row via ensureTenantForOrg
 * and attaches `tenant` + `actor` to the Hono context.
 *
 * Org resolution (fixed 2026-06-01 — see ADR not yet written; previous
 * design required `org_id` as a JWT claim sourced from a Clerk dashboard
 * JWT template named `session`. That template is per-instance, dashboard-
 * edited, and invisible from code; every new Clerk instance / user / org
 * recreated the "JWT lacks org_id" 401 bug. New design:
 *
 *   1. If the JWT carries `org_id` (legacy template still configured), use it.
 *   2. Else if the request sends `X-Org-Id` and the user is a member of
 *      that org per Clerk's Backend API, use it. (Used by the dashboard
 *      when `useAuth().orgId` is set so multi-org users have an explicit
 *      active org.)
 *   3. Else look the user up via Clerk Backend API; if they have exactly
 *      one organization membership, use it (with a short KV cache).
 *   4. Else return a structured 403 — `no_organization` for zero memberships
 *      (dashboard renders <CreateOrganization />) or `ambiguous_org` for
 *      multi-membership without an `X-Org-Id` header.
 *
 * 401 cases (now narrower):
 *   - No Authorization header AND no __session cookie
 *   - Invalid / expired JWT
 *   - Invalid `ff_live_*` API key
 *
 * The previous `missing_org_context` 401 case is gone — that information
 * lives on the server now, not in the JWT.
 *
 * Open routes (apply middleware *after* declaring these): /health,
 * /v1/clerk-webhook, /v1/stripe-webhook.
 */

import type { Context, Next } from "hono";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { eq } from "drizzle-orm";
import { createDbClient } from "../db/client.js";
import { ensureTenantForOrg } from "./tenants.js";
import { tenants, type Tenant } from "../db/schema.js";
import { verifyApiKey } from "./api-keys.js";

// 5 minutes — short enough that an org membership revocation propagates
// within the same trip, long enough to amortize the Clerk API roundtrip
// (~50ms) across a burst of requests.
const ORG_LOOKUP_TTL_SECONDS = 300;

interface OrgLookupCacheEntry {
  orgIds: string[];        // all orgs the user is a member of
  orgNames: Record<string, string>;
  cachedAt: number;
}

async function lookupUserOrgs(
  env: CloudflareBindings,
  userId: string
): Promise<OrgLookupCacheEntry> {
  const cacheKey = `clerk_user_orgs:${userId}`;
  const cached = await env.SESSION_KV.get(cacheKey, "json");
  if (cached) return cached as OrgLookupCacheEntry;

  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  // limit=10 is intentional: we only care about the 0/1/many distinction
  // and we want to return the full list on multi-membership so the
  // ambiguous_org error includes them. If a user genuinely has >10 orgs,
  // they'll need to send X-Org-Id explicitly.
  const memberships = await clerk.users.getOrganizationMembershipList({
    userId,
    limit: 10,
  });
  const items = Array.isArray(memberships) ? memberships : memberships.data ?? [];
  const entry: OrgLookupCacheEntry = {
    orgIds: items.map((m) => m.organization.id),
    orgNames: Object.fromEntries(
      items.map((m) => [m.organization.id, m.organization.name ?? "Unnamed Org"])
    ),
    cachedAt: Date.now(),
  };
  // Best-effort cache write; failure here is non-fatal.
  await env.SESSION_KV.put(cacheKey, JSON.stringify(entry), {
    expirationTtl: ORG_LOOKUP_TTL_SECONDS,
  }).catch(() => {});
  return entry;
}

export interface AuthVars {
  tenant: Tenant;
  actor: string; // Clerk user id
  requestId: string; // P0-3 — set by requestIdMiddleware
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

  const claims = payload as { org_id?: string; sub?: string; org_name?: string };
  const userId = claims.sub;
  if (!userId) {
    return c.json(
      { error: "unauthenticated", code: "invalid_token", detail: "JWT missing sub claim" },
      401
    );
  }

  // 1. Prefer the org_id JWT claim if the legacy template is still
  //    configured — costs nothing and preserves backwards-compatibility
  //    with any client that's already minting tokens this way.
  let orgId = claims.org_id;
  let orgName = claims.org_name ?? "Unnamed Org";

  // 2. Otherwise fall back to server-side resolution. The dashboard
  //    sends X-Org-Id when the user has selected an active org via
  //    Clerk's useAuth().orgId; honor it if the user is a member.
  if (!orgId) {
    const explicit = c.req.header("x-org-id") ?? c.req.header("X-Org-Id");
    const lookup = await lookupUserOrgs(c.env, userId);

    if (lookup.orgIds.length === 0) {
      return c.json(
        {
          error: "no_organization",
          code: "no_organization",
          detail:
            "Authenticated user has no organization memberships. Create or accept an invite to one before retrying.",
        },
        403
      );
    }

    if (explicit) {
      if (!lookup.orgIds.includes(explicit)) {
        return c.json(
          {
            error: "forbidden_org",
            code: "forbidden_org",
            detail: `User is not a member of organization ${explicit}.`,
          },
          403
        );
      }
      orgId = explicit;
      orgName = lookup.orgNames[explicit] ?? orgName;
    } else if (lookup.orgIds.length === 1) {
      orgId = lookup.orgIds[0];
      orgName = lookup.orgNames[orgId] ?? orgName;
    } else {
      return c.json(
        {
          error: "ambiguous_org",
          code: "ambiguous_org",
          detail:
            "User belongs to multiple organizations; send X-Org-Id to disambiguate.",
          orgs: lookup.orgIds.map((id) => ({ id, name: lookup.orgNames[id] })),
        },
        409
      );
    }
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
