/**
 * Phase L2 — OpenAPI 3.1 spec served at /v1/openapi.yaml.
 *
 * Inlined as a TS template literal so Worker bundles include it
 * without filesystem reads. Source-of-truth for the public REST
 * surface; CI guard checks every documented endpoint resolves to
 * a real Hono route.
 */

const SPEC_YAML = `openapi: 3.1.0
info:
  title: FF Brand Studio API
  version: "1.0.0"
  description: |
    Programmatic access to the FF Brand Studio platform — same flows
    that the dashboard exercises. Tenant-scoped via either a Clerk
    session JWT (web) or an ff_live_* API key (machine).

    Rate limits arrive in Phase M1 — expect 60 req/min/key default.
servers:
  - url: https://ff-brand-studio-mcp.creatorain.workers.dev
    description: Production
security:
  - clerkBearer: []
  - apiKeyBearer: []
components:
  securitySchemes:
    clerkBearer:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: Clerk session JWT (used by the dashboard).
    apiKeyBearer:
      type: http
      scheme: bearer
      bearerFormat: ff_live_*
      description: API key issued via POST /v1/api-keys. Returned exactly once.
  schemas:
    Product:
      type: object
      required: [id, sku, name_en, category, kind]
      properties:
        id: { type: string, format: uuid }
        sku: { type: string }
        name_en: { type: string }
        name_zh: { type: string, nullable: true }
        category: { type: string }
        kind: { type: string }
    Listing:
      type: object
      properties:
        id: { type: string, format: uuid }
        surface: { type: string, enum: [amazon-us, shopify, tmall, jd] }
        language: { type: string }
        copy: { type: object, additionalProperties: true }
        rating: { type: string, nullable: true }
        iterations: { type: integer }
        approved_at: { type: string, format: date-time, nullable: true }
    ApiKey:
      type: object
      properties:
        id: { type: string, format: uuid }
        prefix: { type: string }
        name: { type: string }
        created_at: { type: string, format: date-time }
        last_used_at: { type: string, format: date-time, nullable: true }
        revoked_at: { type: string, format: date-time, nullable: true }
    NewApiKey:
      type: object
      required: [id, key, prefix, name, created_at]
      properties:
        id: { type: string, format: uuid }
        key:
          type: string
          description: Full ff_live_* secret. Returned exactly once.
        prefix: { type: string }
        name: { type: string }
        created_at: { type: string, format: date-time }
    LaunchRun:
      type: object
      properties:
        id: { type: string, format: uuid }
        product_id: { type: string, format: uuid }
        status: { type: string, enum: [pending, succeeded, failed, hitl_blocked, cost_capped] }
        total_cost_cents: { type: integer }
        created_at: { type: string, format: date-time }
    AuditEvent:
      type: object
      properties:
        id: { type: string, format: uuid }
        actor: { type: string, nullable: true }
        action: { type: string }
        target_type: { type: string, nullable: true }
        target_id: { type: string, format: uuid, nullable: true }
        metadata: { type: object, additionalProperties: true }
        at: { type: string, format: date-time }
    WebhookSubscription:
      type: object
      properties:
        id: { type: string, format: uuid }
        url: { type: string, format: uri }
        events: { type: array, items: { type: string } }
        created_at: { type: string, format: date-time }
        disabled_at: { type: string, format: date-time, nullable: true }
    PaginatedResult:
      type: object
      properties:
        hasMore: { type: boolean }
        nextCursor: { type: string, nullable: true }
    Error:
      type: object
      properties:
        error: { type: string }
        message: { type: string }
paths:
  /health:
    get:
      summary: Liveness probe
      security: []
      responses:
        "200": { description: ok }
  /v1/openapi.yaml:
    get:
      summary: OpenAPI 3.1 spec for this API
      security: []
      responses:
        "200":
          description: ok
          content:
            text/yaml:
              schema: { type: string }
  /v1/me/state:
    get:
      summary: Current tenant + wallet snapshot
      responses:
        "200": { description: ok }
  /v1/products:
    get:
      summary: List products (cursor-paginated)
      parameters:
        - in: query
          name: cursor
          schema: { type: string }
        - in: query
          name: limit
          schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                allOf:
                  - $ref: "#/components/schemas/PaginatedResult"
                  - type: object
                    properties:
                      products: { type: array, items: { $ref: "#/components/schemas/Product" } }
    post:
      summary: Create a product (consumes upload-intent)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [intent_id, name_en, category, uploaded_keys]
              properties:
                intent_id: { type: string }
                sku: { type: string }
                name_en: { type: string }
                name_zh: { type: string }
                category: { type: string }
                kind: { type: string }
                uploaded_keys: { type: array, items: { type: string } }
      responses:
        "200": { description: ok }
        "402": { description: insufficient funds }
  /v1/products/{id}:
    get:
      summary: Single product
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  product: { $ref: "#/components/schemas/Product" }
        "404": { description: not found }
    delete:
      summary: Soft-delete a product (sku tombstoned)
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200": { description: ok }
  /v1/products/upload-intent:
    post:
      summary: Reserve presigned R2 PUT URLs for product reference uploads
      responses:
        "200": { description: ok }
  /v1/launches:
    get:
      summary: List launch runs
      parameters:
        - in: query
          name: cursor
          schema: { type: string }
        - in: query
          name: status
          schema: { type: string }
        - in: query
          name: limit
          schema: { type: integer, default: 20 }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                allOf:
                  - $ref: "#/components/schemas/PaginatedResult"
                  - type: object
                    properties:
                      launches: { type: array, items: { $ref: "#/components/schemas/LaunchRun" } }
    post:
      summary: Trigger a launch for an existing product
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [product_id, platforms]
              properties:
                product_id: { type: string, format: uuid }
                platforms:
                  type: array
                  items: { type: string, enum: [amazon, shopify] }
                dry_run: { type: boolean, default: true }
      responses:
        "200": { description: ok }
        "402": { description: insufficient funds }
  /v1/launches/{runId}:
    get:
      summary: Single launch run details
      parameters:
        - in: path
          name: runId
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200": { description: ok }
  /v1/launches/preview:
    post:
      summary: Predict launch cost without spending
      responses:
        "200": { description: ok }
  /v1/listings:
    get:
      summary: List listings (filter by variant_id or sku)
      parameters:
        - in: query
          name: variant_id
          schema: { type: string, format: uuid }
        - in: query
          name: sku
          schema: { type: string }
      responses:
        "200": { description: ok }
  /v1/listings/{id}:
    get:
      summary: Single listing
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  listing: { $ref: "#/components/schemas/Listing" }
    patch:
      summary: Edit listing copy with version trail
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [patch]
              properties:
                patch: { type: object, additionalProperties: true }
      responses:
        "200": { description: ok }
        "400": { description: validation_failed }
        "404": { description: not_found }
  /v1/listings/{id}/versions:
    get:
      summary: List version history for a listing
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200": { description: ok }
  /v1/skus/{productId}/approve:
    post:
      summary: Approve all listings + assets for a SKU
      parameters:
        - in: path
          name: productId
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200": { description: ok }
  /v1/skus/{productId}/unapprove:
    post:
      summary: Revert SKU approval
      parameters:
        - in: path
          name: productId
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200": { description: ok }
  /v1/skus/{productId}/publish:
    post:
      summary: Build the export bundle and (optionally) email a presigned link
      parameters:
        - in: path
          name: productId
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        required: false
        content:
          application/json:
            schema:
              type: object
              properties:
                target: { type: string, enum: [r2_export, amazon_spapi], default: r2_export }
                email: { type: string, format: email }
      responses:
        "200": { description: ok }
        "501": { description: not_implemented }
  /v1/assets/{id}/regenerate:
    post:
      summary: Regenerate a single asset with operator feedback
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                feedback: { type: string }
                chips: { type: array, items: { type: string } }
      responses:
        "200": { description: ok }
        "402": { description: insufficient funds }
        "403": { description: feature_disabled }
        "429": { description: monthly_cap_reached }
  /v1/assets/regen-cap:
    get:
      summary: Current month's regen usage + cap
      responses:
        "200": { description: ok }
  /v1/audit:
    get:
      summary: Tenant audit log (paginated)
      parameters:
        - in: query
          name: actions
          schema: { type: string, description: "comma-separated action list" }
        - in: query
          name: actor
          schema: { type: string }
        - in: query
          name: limit
          schema: { type: integer, default: 100 }
        - in: query
          name: offset
          schema: { type: integer, default: 0 }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  events: { type: array, items: { $ref: "#/components/schemas/AuditEvent" } }
                  hasMore: { type: boolean }
                  nextOffset: { type: integer, nullable: true }
  /v1/api-keys:
    get:
      summary: List API keys for the current tenant
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  keys: { type: array, items: { $ref: "#/components/schemas/ApiKey" } }
    post:
      summary: Issue a new API key (returns full secret exactly once)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name]
              properties:
                name: { type: string, maxLength: 80 }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema: { $ref: "#/components/schemas/NewApiKey" }
  /v1/api-keys/{id}:
    delete:
      summary: Revoke an API key
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200": { description: ok }
        "404": { description: not_found }
  /v1/billing/checkout-session:
    post:
      summary: Open a Stripe Checkout session for a top-up amount
      responses:
        "200": { description: ok }
  /v1/billing/ledger:
    get:
      summary: Wallet ledger entries
      responses:
        "200": { description: ok }
  /v1/webhooks:
    get:
      summary: List webhook subscriptions for the tenant
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  subscriptions:
                    type: array
                    items: { $ref: "#/components/schemas/WebhookSubscription" }
    post:
      summary: Create a new webhook subscription
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [url, events]
              properties:
                url: { type: string, format: uri }
                events: { type: array, items: { type: string } }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  subscription: { $ref: "#/components/schemas/WebhookSubscription" }
                  secret:
                    type: string
                    description: HMAC-SHA256 secret. Returned exactly once.
  /v1/webhooks/{id}:
    delete:
      summary: Delete (disable) a webhook subscription
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200": { description: ok }
        "404": { description: not_found }
`;

export function getOpenApiYaml(): string {
  return SPEC_YAML;
}

export function getRedocHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>FF Brand Studio API · /docs</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{margin:0}</style>
</head>
<body>
  <redoc spec-url="/v1/openapi.yaml"></redoc>
  <script src="https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js"></script>
</body>
</html>`;
}
