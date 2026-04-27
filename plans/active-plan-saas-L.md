# Phase L — Public API (detailed plan)

> Detailed plan for Phase L. Depends on Phase K being shipped. Opens
> the platform to programmatic consumers — agencies that want to script
> their catalog launches from a CI pipeline, ERP integration, or PIM
> system.

**Goal of Phase L**

A second, machine-friendly entry-point alongside the dashboard. An
agency engineer can `curl` the same flows that the UI exercises, with
clear versioning, predictable rate limits, and signed-by-tenant API
keys.

---

## ADR-0006 — Public API versioning + deprecation policy

### Decision

- URL-prefix versioning: `/v1/...` (already adopted in G + H + K).
- Major version bump (`/v2/...`) only for breaking changes; minor
  evolutions (additive fields) ship under `/v1` with no version bump.
- 6-month deprecation window between announcing a breaking change and
  removing the old endpoint. Deprecated endpoints return a `Sunset`
  header per RFC 8594 plus a 299 Warning header.
- OpenAPI 3.1 spec is the source of truth; any endpoint that doesn't
  appear in the spec is undocumented and therefore unsupported.

### Consequences

- We commit to a tight `/v1` surface — only ship endpoints we're willing
  to maintain for ≥6 months.
- A spec-driven workflow: adding a route updates the spec first, then
  the Hono handler matches it. CI guard rejects mismatches.
- Webhooks (Phase L4) are independently versioned; payload schemas
  carry a `version` field.

---

## Iteration L1 — API key issuance + auth

**Outcome:** every tenant can create / list / revoke `ff_live_*` API
keys from `/settings/api-keys`. Worker auth accepts both Clerk session
JWTs and API keys, both resolving to the same tenant context.

### L1.1 — Schema

**Files:** `apps/mcp-server/drizzle/0004_phase_l_api_keys.sql`

```sql
CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  prefix       text NOT NULL,        -- ff_live_<8> displayed in UI
  hash         text NOT NULL,        -- bcrypt of full key
  name         text NOT NULL,        -- user-supplied label
  created_by   text,                 -- Clerk user_id
  created_at   timestamp DEFAULT now(),
  last_used_at timestamp,
  revoked_at   timestamp
);
CREATE INDEX idx_api_keys_prefix ON api_keys(prefix);
CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);
```

### L1.2 — Issuance + revocation endpoints

**Files:** `apps/mcp-server/src/index.ts` + `src/lib/api-keys.ts`

**Subtasks:**
1. `POST /v1/api-keys` body `{ name }` → returns `{ key, prefix, name }`
   exactly once. The full `ff_live_<32>` string is hashed and never
   stored.
2. `GET /v1/api-keys` → list every key for the tenant (prefix only).
3. `DELETE /v1/api-keys/:id` → set `revoked_at`.
4. Audit events on every issuance + revocation.

### L1.3 — Worker auth: dual Bearer types

**Files:** `apps/mcp-server/src/lib/auth.ts`

**Subtasks:**
1. Update `requireTenant` middleware: if Bearer starts with `ff_live_`,
   verify against `api_keys` (bcrypt compare). Otherwise treat as
   Clerk JWT.
2. On API key auth: set `c.var.actor = 'api_key:<prefix>'` and update
   `last_used_at` (best-effort, debounced).

### L1.4 — Settings page

**Files:**
- `apps/dashboard/src/app/settings/api-keys/page.tsx`
- `apps/dashboard/src/app/settings/api-keys/_client.tsx`

**Subtasks:**
1. Table: name, prefix, created_at, last_used_at, revoke button.
2. "Create new key" modal — generates the key, displays once with a
   copy-to-clipboard button + warning that it can't be retrieved later.
3. Code-snippet block: copy-paste curl example with the key inlined.

### L1.5 — Acceptance for L1

- Create a key, copy it, run `curl -H "Authorization: Bearer ff_live_..."
  https://<worker>/v1/products` — returns the tenant's products.
- Revoke the key, retry — gets 401.
- DB never stores the plain key.

---

## Iteration L2 — Versioned REST API surface

**Outcome:** every flow reachable from the dashboard is also reachable
via REST. Documented in OpenAPI 3.1.

### L2.1 — OpenAPI spec

**Files:** `apps/mcp-server/openapi.yaml`

**Subtasks:**
1. Author the spec covering every existing `/v1/*` endpoint plus the
   ones added in L1 + L2.
2. Generate a TS client (`openapi-typescript@^7`) into
   `packages/api-client/` for internal use + agency-side consumption.
3. Spec served at `GET /v1/openapi.yaml` for tooling discovery.

### L2.2 — Endpoint coverage gaps

**Endpoints to add for full coverage:**
- `GET /v1/products` — paginated list + filters
- `GET /v1/products/:id` — single product with refs
- `DELETE /v1/products/:id` — soft delete
- `GET /v1/launches` — paginated list + filters by status / date
- `POST /v1/launches/:id/cancel` — abort an in-flight run (Phase M
  adds queue cancel)
- `GET /v1/listings/:id` — single listing
- `PATCH /v1/listings/:id` — already in K1; documents in spec
- `POST /v1/skus/:id/approve` — Phase K3
- `POST /v1/skus/:id/publish` — Phase K3

### L2.3 — Pagination + filtering convention

**Subtasks:**
1. Cursor pagination: `?cursor=<opaque>&limit=20`. Encode `created_at +
   id` as the cursor.
2. Filtering: `?status=succeeded&created_after=2026-01-01`.
3. Ordering: `?order_by=created_at:desc` default.

### L2.4 — Acceptance for L2

- `curl /v1/openapi.yaml` returns a valid 3.1 spec.
- The TS client compiles cleanly + supports every documented endpoint.
- All endpoint shapes match the spec (CI guard via openapi-validator).

---

## Iteration L3 — MCP server tenancy

**Outcome:** Claude Desktop's MCP integration becomes tenant-aware.
A Claude Desktop user pastes their `ff_live_*` key once into the MCP
config; subsequent tool calls operate against their tenant.

### L3.1 — Auth-aware tool registration

**Files:** `apps/mcp-server/src/tools/index.ts` + every tool file.

**Subtasks:**
1. MCP server gets a "session" concept tied to the API key sent at
   `/sse` connect time (added as a query param).
2. `registerAllTools(server, env, tenantId)` — every tool resolves
   `tenantId` at call time and writes scoped rows.

### L3.2 — Update existing tools for tenancy

**Subtasks:**
1. `publish_to_dam`, `score_brand_compliance`, etc. — already use
   `SAMPLE_TENANT_ID` after Phase G; switch to the connected tenant.
2. New tool: `launch_product_sku` — wraps `runLaunchPipeline`, deducts
   wallet via H4's flow.

### L3.3 — Acceptance for L3

- Claude Desktop with key `ff_live_...` running `launch_product_sku`
  produces rows under that tenant.
- Without a key, MCP tools return read-only sample data.

---

## Iteration L4 — Webhooks

**Outcome:** agencies subscribe to platform events (launch.complete,
listing.publish, billing.stripe_topup) so they don't have to poll.

### L4.1 — Webhook subscriptions

**Schema:** `apps/mcp-server/drizzle/0005_phase_l_webhooks.sql`

```sql
CREATE TABLE webhook_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  url         text NOT NULL,
  events      text[] NOT NULL,
  secret      text NOT NULL,
  created_at  timestamp DEFAULT now(),
  disabled_at timestamp
);

CREATE TABLE webhook_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES webhook_subscriptions(id),
  event_id        uuid NOT NULL,
  payload         jsonb NOT NULL,
  status_code     integer,
  response_body   text,
  attempt         integer NOT NULL DEFAULT 1,
  delivered_at    timestamp,
  next_attempt_at timestamp
);
```

### L4.2 — Delivery worker

**Files:** `apps/mcp-server/src/lib/webhooks.ts`

**Subtasks:**
1. CRUD endpoints for subscriptions: `POST/GET/DELETE /v1/webhooks`.
2. Each `audit_events` row that matches a subscription kicks off a
   delivery: signed with HMAC-SHA256 over the body, sent with
   `X-FF-Signature` header.
3. Retry policy: 5 attempts at 1m, 5m, 30m, 2h, 12h. After that,
   delivery marked failed; subscription not auto-disabled (operator
   inspects).

### L4.3 — Acceptance for L4

- Create subscription pointing at `webhook.site` URL, fire a launch,
  payload arrives within 30s.
- Bad URL → 5 retry attempts visible in `webhook_deliveries`.
- HMAC signature verifies correctly with the per-subscription secret.

---

## Cross-cutting Phase L concerns

### Backwards compatibility

The whole Phase G–K stack already lives at `/v1/...`. L doesn't break
anything; it widens the surface and documents what's there.

### Costs

API key auth adds 1 bcrypt + 1 SQL hit per request (~5ms). Cached at
the edge via SESSION_KV with 60s TTL keyed by prefix → tenant_id (the
hash check happens once per minute per key). Webhook delivery uses
Workers' `fetch()` — sub-cent per delivery.

### Estimated effort

| Iteration | Engineer-days |
|---|---|
| L1 (API keys) | 3 |
| L2 (REST + OpenAPI) | 4 |
| L3 (MCP tenancy) | 2 |
| L4 (webhooks) | 3 |
| Buffer | 1 |
| **Total** | **~13 days** |

---

## Resolved questions (locked 2026-04-27)

1. **API key rotation cadence.** No automatic rotation in MVP. Phase M
   adds a 90-day expiration toggle.
2. **Webhook delivery deduplication.** Payload includes a unique
   `event.id`; consumers are responsible for idempotency. We retry
   with the same id so a consumer that ack'd once can no-op subsequent.
3. **Rate-limit headers.** `X-RateLimit-*` headers + 429 with
   `Retry-After`. Specifics pinned in Phase M1.
4. **OpenAPI hosting.** Self-host at `/v1/openapi.yaml` plus link to a
   GitHub-hosted README. No separate docs site until paying customers
   ask.

---

## Deliverables checklist

When Phase L is done:

- [ ] `/settings/api-keys` page — create / list / revoke
- [ ] `ff_live_*` keys authenticate alongside Clerk JWTs
- [ ] OpenAPI 3.1 spec at `/v1/openapi.yaml`
- [ ] TS client generated to `packages/api-client/`
- [ ] Every dashboard flow has a documented REST counterpart
- [ ] Cursor pagination + filter convention applied consistently
- [ ] MCP server respects tenant context from API key
- [ ] Webhook subscriptions UI + delivery worker
- [ ] HMAC-signed webhook deliveries verified by an external receiver
- [ ] ADR-0006 committed
- [ ] `SESSION_STATE.md` updated with the public API surface

When all are checked, the platform is open for both human and machine
consumers. Phase M (scale hardening) ensures it stays up under load.
