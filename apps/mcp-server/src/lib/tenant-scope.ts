/**
 * Phase G · G02 — defense-in-depth helper for tenant-scoped queries.
 *
 * Use this INSTEAD of inline `inArray(table.tenantId, visibleTenantIds(tenant))`:
 *
 *     db.select()
 *       .from(products)
 *       .where(tenantScope(products.tenantId, tenant))
 *
 * Why a helper exists: every Drizzle SELECT/UPDATE/DELETE that hits a
 * tenant-scoped table MUST filter by tenant. The DB has no row-level
 * security; isolation is application-layer only. A new endpoint that
 * forgets the filter exfiltrates cross-tenant data silently — has
 * happened in similar codebases (audit §1.10).
 *
 * Today every call site uses the inline pattern, which is correct but
 * not enforceable. This helper makes the intent explicit and lets a
 * future iteration add an ESLint rule "every Drizzle query that
 * references *.tenantId MUST be wrapped in tenantScope()."
 */

import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { inArray, type SQL } from "drizzle-orm";
import type { Tenant } from "../db/schema.js";
import { visibleTenantIds } from "./tenant-visibility.js";

export function tenantScope(
  tenantIdColumn: AnyPgColumn,
  tenant: Tenant
): SQL {
  return inArray(tenantIdColumn, visibleTenantIds(tenant));
}

/**
 * Strict variant — own tenant only, no sample-catalog visibility. Use
 * for write paths (UPDATE, DELETE, INSERT-then-confirm) where a stray
 * cross-tenant write would be catastrophic.
 */
export function tenantScopeStrict(
  tenantIdColumn: AnyPgColumn,
  tenant: Tenant
): SQL {
  return inArray(tenantIdColumn, [tenant.id]);
}
