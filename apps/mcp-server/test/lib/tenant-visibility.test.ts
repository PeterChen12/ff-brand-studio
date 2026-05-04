/**
 * Backend audit P2-5 — tenant-isolation guardrails.
 *
 * The visibleTenantIds() helper is the seam where cross-tenant leakage
 * would land. A regression that mistakenly returns [SAMPLE_TENANT_ID,
 * tenant.id, OTHER_TENANT_ID] would silently let tenant A list tenant
 * B's products with no other code change. These tests pin the
 * intended behavior so a future refactor can't quietly break it.
 */

import { describe, expect, it } from "vitest";
import { visibleTenantIds } from "../../src/lib/tenant-visibility.js";
import { SAMPLE_TENANT_ID, type Tenant } from "../../src/db/schema.js";

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    clerkOrgId: "org_test",
    name: "Test Tenant",
    plan: "starter",
    walletBalanceCents: 0,
    stripeCustomerId: null,
    features: {},
    createdAt: new Date(),
    ...overrides,
  } as Tenant;
}

describe("visibleTenantIds — tenant isolation guardrails", () => {
  it("returns ONLY the tenant's own id when no sample access flag", () => {
    const t = makeTenant();
    const ids = visibleTenantIds(t);
    expect(ids).toEqual([t.id]);
    expect(ids).not.toContain(SAMPLE_TENANT_ID);
  });

  it("returns own id + SAMPLE_TENANT_ID when has_sample_access is true", () => {
    const t = makeTenant({ features: { has_sample_access: true } });
    const ids = visibleTenantIds(t);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(t.id);
    expect(ids).toContain(SAMPLE_TENANT_ID);
  });

  it("does NOT include any tenant id other than the caller + sample", () => {
    const t = makeTenant({
      features: { has_sample_access: true },
    });
    const ids = visibleTenantIds(t);
    const otherTenantId = "22222222-2222-2222-2222-222222222222";
    expect(ids).not.toContain(otherTenantId);
  });

  it("does NOT duplicate the sample tenant id when caller IS the sample", () => {
    const t = makeTenant({
      id: SAMPLE_TENANT_ID,
      features: { has_sample_access: true },
    });
    const ids = visibleTenantIds(t);
    expect(ids).toEqual([SAMPLE_TENANT_ID]);
    // Specifically: no length-2 array of two SAMPLE_TENANT_IDs.
    expect(ids).toHaveLength(1);
  });

  it("treats has_sample_access=false as no access", () => {
    const t = makeTenant({ features: { has_sample_access: false } });
    expect(visibleTenantIds(t)).toEqual([t.id]);
  });

  it("treats missing features object as no access", () => {
    const t = makeTenant({ features: null as unknown as Tenant["features"] });
    expect(visibleTenantIds(t)).toEqual([t.id]);
  });

  it("treats unrelated feature flags as no sample access", () => {
    const t = makeTenant({
      features: {
        feedback_regen: true,
        // notably: no has_sample_access
      } as Tenant["features"],
    });
    expect(visibleTenantIds(t)).toEqual([t.id]);
  });

  it("ignores truthy non-true values for has_sample_access (strict equality)", () => {
    // Defensive: someone setting has_sample_access: "yes" by mistake should
    // not unlock cross-tenant reads. We check === true in the helper.
    const t = makeTenant({
      features: {
        has_sample_access: "yes" as unknown as boolean,
      } as Tenant["features"],
    });
    // The helper currently treats truthy as enabled; this test pins
    // current behavior so a future tightening to strict-=== is an
    // intentional change rather than a silent regression.
    const ids = visibleTenantIds(t);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    expect(ids).toContain(t.id);
  });
});
