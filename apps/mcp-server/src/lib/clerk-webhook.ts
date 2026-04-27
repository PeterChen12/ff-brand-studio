/**
 * Clerk webhook handler — Phase G.
 *
 * Verifies the svix signature (Clerk uses svix to sign every webhook)
 * and dispatches on the event type. We subscribe to:
 *   - organization.created  → ensureTenantForOrg ($5 signup bonus + audit)
 *   - organization.updated  → syncTenantName
 *   - organization.deleted  → softDeleteTenant (mark plan='deleted')
 *
 * user.* and organizationMembership.* events are accepted (we subscribe
 * to them so Clerk has the option to push, and so future features can
 * react without changing the subscription) but do not change tenant
 * state today.
 */

import type { Context } from "hono";
import { Webhook } from "svix";
import { createDbClient } from "../db/client.js";
import {
  ensureTenantForOrg,
  syncTenantName,
  softDeleteTenant,
} from "./tenants.js";

interface ClerkOrganization {
  id: string;
  name: string;
}

interface ClerkWebhookEvent {
  type: string;
  data: ClerkOrganization | { id: string; [k: string]: unknown };
}

export async function handleClerkWebhook(
  c: Context<{ Bindings: CloudflareBindings }>
) {
  const secret = c.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ error: "webhook_secret_unset" }, 500);
  }

  const svixId = c.req.header("svix-id");
  const svixTimestamp = c.req.header("svix-timestamp");
  const svixSignature = c.req.header("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return c.json({ error: "missing_svix_headers" }, 400);
  }

  // svix.verify() needs the *raw* body bytes — decoding/re-encoding
  // breaks signature verification.
  const rawBody = await c.req.text();

  let event: ClerkWebhookEvent;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvent;
  } catch (err) {
    console.error("[clerk-webhook] signature verification failed", err);
    return c.json({ error: "invalid_signature" }, 401);
  }

  const db = createDbClient(c.env);

  try {
    switch (event.type) {
      case "organization.created": {
        const org = event.data as ClerkOrganization;
        const tenant = await ensureTenantForOrg(db, org.id, org.name);
        return c.json({ ok: true, tenant_id: tenant.id });
      }
      case "organization.updated": {
        const org = event.data as ClerkOrganization;
        await syncTenantName(db, org.id, org.name);
        return c.json({ ok: true });
      }
      case "organization.deleted": {
        await softDeleteTenant(db, event.data.id);
        return c.json({ ok: true });
      }
      // user.* + organizationMembership.* — accept and acknowledge so
      // Clerk doesn't retry; no tenant-state change today.
      default:
        return c.json({ ok: true, ignored: event.type });
    }
  } catch (err) {
    console.error(`[clerk-webhook ${event.type}]`, err);
    return c.json(
      {
        error: "handler_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      500
    );
  }
}
