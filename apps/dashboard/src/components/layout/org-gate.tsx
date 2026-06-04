"use client";

/**
 * Organization activation gate.
 *
 * Renders <CreateOrganization /> when the signed-in user has zero
 * organization memberships. Otherwise renders children.
 *
 * Org resolution happens server-side in apps/mcp-server/src/lib/auth.ts:
 * the Worker derives the active org from the verified `sub` claim (or
 * an explicit `X-Org-Id` header for multi-org users). We no longer
 * inspect JWT claims here — the dashboard's role is just to ensure the
 * user has at least one org to act under.
 *
 * Previous design checked for `org_id` in the JWT and rendered a
 * "Clerk JWT template needs org_id claim" panel when it was missing.
 * That panel was a workaround for a fragile Clerk dashboard config
 * dependency; the Worker now resolves the org from the user_id
 * server-side, so the workaround is no longer needed.
 */

import { CreateOrganization, useAuth, useUser } from "@clerk/react";

export function OrgGate({ children }: { children: React.ReactNode }) {
  const { isSignedIn } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();

  if (!isSignedIn || !userLoaded) {
    return (
      <div className="min-h-screen md-surface flex items-center justify-center">
        <div className="md-typescale-label-small text-on-surface-variant tracking-stamp uppercase">
          Loading…
        </div>
      </div>
    );
  }

  const memberships = user?.organizationMemberships ?? [];
  if (memberships.length === 0) {
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

  return <>{children}</>;
}
