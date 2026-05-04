/**
 * P2-5 — extracted helper so tenant-isolation behavior is unit-testable
 * without booting the whole Worker.
 *
 * Returns the set of tenant_ids a given tenant can READ from. The
 * locked decision (FF v2 plan) is: every signed-in tenant sees their
 * own data + the Sample Catalog (SAMPLE_TENANT_ID) IF
 * tenant.features.has_sample_access is set. Same-tenant always wins;
 * SAMPLE_TENANT_ID is never duplicated when called for the sample
 * tenant itself.
 */

import { SAMPLE_TENANT_ID, type Tenant } from "../db/schema.js";

export function visibleTenantIds(tenant: Tenant): string[] {
  const features = (tenant.features ?? {}) as { has_sample_access?: boolean };
  const ids = [tenant.id];
  if (features.has_sample_access && tenant.id !== SAMPLE_TENANT_ID) {
    ids.push(SAMPLE_TENANT_ID);
  }
  return ids;
}
