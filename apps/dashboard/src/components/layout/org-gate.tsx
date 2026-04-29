"use client";

/**
 * Phase G follow-up — organization activation gate.
 *
 * Clerk's session JWT only includes `org_id` when the user has an
 * active organization selected. Users with multiple orgs (or one org
 * but no auto-selection) get a JWT without org_id, and the Worker's
 * requireTenant middleware rejects every request with 401
 * `missing_org_context` (apps/mcp-server/src/lib/auth.ts:102).
 *
 * This gate sits between Shell's auth check and the page content:
 *   - If an org is already active, render children unchanged.
 *   - If the user has memberships but none active, auto-activate the
 *     first one (silent — they can switch via the OrganizationSwitcher
 *     in the sidebar).
 *   - If the user has zero memberships, render the create-org gate.
 *     They can't proceed until they create one.
 */

import { useEffect } from "react";
import {
  CreateOrganization,
  useAuth,
  useClerk,
  useOrganization,
  useOrganizationList,
} from "@clerk/react";

export function OrgGate({ children }: { children: React.ReactNode }) {
  const { setActive } = useClerk();
  const { orgId: sessionOrgId } = useAuth();
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const { userMemberships, isLoaded: listLoaded } = useOrganizationList({
    userMemberships: true,
  });

  const memberships = userMemberships?.data ?? [];
  const firstMembershipOrgId = memberships[0]?.organization.id;

  // Activate when the session has no org_id, even if useOrganization()
  // reports a non-null `organization` (client-side cache can lag the
  // session). useAuth().orgId is the SESSION truth — it's what the JWT
  // mint will read. If it's undefined, we MUST setActive or every API
  // call returns missing_org_context.
  useEffect(() => {
    if (!orgLoaded || !listLoaded) return;
    if (sessionOrgId) return;
    if (!firstMembershipOrgId) return;
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.warn("[org-gate] activating", firstMembershipOrgId, {
        sessionOrgId,
        cachedOrg: organization?.id,
      });
    }
    setActive({ organization: firstMembershipOrgId })
      .then(() => {
        if (typeof console !== "undefined") {
          // eslint-disable-next-line no-console
          console.warn("[org-gate] activation resolved");
        }
      })
      .catch((err: unknown) => {
        if (typeof console !== "undefined") {
          // eslint-disable-next-line no-console
          console.error("[org-gate] setActive failed", err);
        }
      });
  }, [
    orgLoaded,
    listLoaded,
    sessionOrgId,
    firstMembershipOrgId,
    organization,
    setActive,
  ]);

  if (!orgLoaded || !listLoaded) {
    return (
      <div className="min-h-screen md-surface flex items-center justify-center">
        <div className="md-typescale-label-small text-on-surface-variant tracking-stamp uppercase">
          Loading…
        </div>
      </div>
    );
  }

  if (!sessionOrgId && memberships.length === 0) {
    return (
      <div className="min-h-screen md-surface flex items-center justify-center px-6 py-12">
        <div className="max-w-lg w-full">
          <div className="ff-stamp-label mb-3">organizations · 工作台</div>
          <h1 className="md-typescale-headline-large text-on-surface mb-3">
            One last step
          </h1>
          <p className="md-typescale-body-large text-on-surface-variant mb-8">
            FF Brand Studio organizes everything — products, library,
            launches, billing — under an organization. Create yours to
            continue.
          </p>
          <div className="md-surface-container-low border ff-hairline rounded-m3-lg p-1">
            <CreateOrganization
              afterCreateOrganizationUrl="/"
              skipInvitationScreen
              appearance={{
                elements: {
                  rootBox: "w-full",
                  cardBox: "shadow-none border-0",
                  card: "bg-transparent shadow-none",
                  formButtonPrimary:
                    "bg-primary text-on-primary rounded-m3-full font-medium tracking-wide",
                },
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (!sessionOrgId) {
    return (
      <div className="min-h-screen md-surface flex items-center justify-center">
        <div className="md-typescale-label-small text-on-surface-variant tracking-stamp uppercase">
          Selecting organization…
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
