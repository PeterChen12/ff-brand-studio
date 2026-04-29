"use client";

/**
 * Phase G follow-up — organization activation gate.
 *
 * Clerk's session JWT only includes `org_id` when the user has an
 * active organization on the SERVER side. The client-side
 * `useAuth().orgId` can be populated from local SDK state while the
 * server's session has no active org — in which case every token
 * mint returns without `org_id` and the Worker rejects every request
 * with 401 `missing_org_context` (apps/mcp-server/src/lib/auth.ts:102).
 *
 * The fix: on mount, mint a token, decode it, and check for `org_id`.
 * If missing but the user has memberships, call `setActive` and BLOCK
 * children from rendering until the next mint actually carries
 * `org_id`. We only trust the JWT, not the SDK cache.
 */

import { useEffect, useRef, useState } from "react";
import {
  CreateOrganization,
  useAuth,
  useClerk,
  useUser,
} from "@clerk/react";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "===".slice(0, (4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

type GateState = "checking" | "needs-create" | "ready";

export function OrgGate({ children }: { children: React.ReactNode }) {
  const { setActive } = useClerk();
  const { isSignedIn, getToken, orgId: sessionOrgId } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();

  // user.organizationMemberships is sync-available once user is loaded,
  // unlike useOrganizationList's paginated .data which can be empty on
  // first render. Use both as fallbacks.
  const userMemberships = user?.organizationMemberships ?? [];
  const firstMembershipOrgId = userMemberships[0]?.organization.id;
  // Candidate org to activate: prefer the SDK-cached active org (it's
  // what the user was last using), fall back to first membership.
  const candidateOrgId = sessionOrgId ?? firstMembershipOrgId;

  const [state, state_set] = useState<GateState>("checking");
  const ranRef = useRef(false);

  useEffect(() => {
    if (!isSignedIn) return;
    if (!userLoaded) return;
    if (ranRef.current) return;
    ranRef.current = true;

    let cancelled = false;

    async function ensureOrgInJwt() {
      // Mint a token, check for org_id. Do NOT trust useAuth().orgId —
      // that's an SDK cache that can lie about server-side state.
      try {
        const initial = await getToken({ skipCache: true });
        const initialPayload = initial ? decodeJwtPayload(initial) : null;
        const initialOrg = initialPayload?.org_id as string | undefined;
        if (typeof console !== "undefined") {
          // eslint-disable-next-line no-console
          console.warn("[org-gate] initial check", {
            jwt_org_id: initialOrg,
            useAuth_orgId: sessionOrgId,
            userMembershipCount: userMemberships.length,
            firstMembership: firstMembershipOrgId,
            candidate: candidateOrgId,
          });
        }

        if (initialOrg) {
          if (!cancelled) state_set("ready");
          return;
        }

        // No org_id in JWT. We need a candidate org to activate.
        if (!candidateOrgId) {
          if (!cancelled) state_set("needs-create");
          return;
        }

        if (typeof console !== "undefined") {
          // eslint-disable-next-line no-console
          console.warn("[org-gate] activating", candidateOrgId);
        }
        try {
          await setActive({ organization: candidateOrgId });
        } catch (err: unknown) {
          // setActive fails if the user isn't actually a member of the
          // org (stale SDK cache). Fall back to first real membership
          // if we have one and the candidate was the cached sessionOrgId.
          // eslint-disable-next-line no-console
          console.warn("[org-gate] setActive failed", err, {
            candidateOrgId,
            firstMembershipOrgId,
          });
          if (
            firstMembershipOrgId &&
            firstMembershipOrgId !== candidateOrgId
          ) {
            // eslint-disable-next-line no-console
            console.warn(
              "[org-gate] retrying with firstMembership",
              firstMembershipOrgId
            );
            await setActive({ organization: firstMembershipOrgId });
          } else {
            if (!cancelled) state_set("needs-create");
            return;
          }
        }

        // Verify: re-mint with skipCache. If org_id appears, we're good.
        const after = await getToken({ skipCache: true });
        const afterPayload = after ? decodeJwtPayload(after) : null;
        const afterOrg = afterPayload?.org_id as string | undefined;
        if (typeof console !== "undefined") {
          // eslint-disable-next-line no-console
          console.warn("[org-gate] post-setActive check", {
            jwt_org_id: afterOrg,
          });
        }

        if (cancelled) return;
        if (afterOrg) {
          state_set("ready");
        } else {
          // setActive resolved but JWT still lacks org_id — likely a
          // Clerk session-token-claim config issue. Render children
          // anyway so the user sees underlying API errors instead of an
          // infinite loading state.
          // eslint-disable-next-line no-console
          console.error(
            "[org-gate] JWT still missing org_id after setActive — " +
              "Clerk session token isn't carrying the org_id claim"
          );
          state_set("ready");
        }
      } catch (err: unknown) {
        if (typeof console !== "undefined") {
          // eslint-disable-next-line no-console
          console.error("[org-gate] ensureOrgInJwt failed", err);
        }
        if (!cancelled) state_set("ready");
      }
    }

    void ensureOrgInJwt();
    return () => {
      cancelled = true;
    };
  }, [
    isSignedIn,
    userLoaded,
    candidateOrgId,
    firstMembershipOrgId,
    sessionOrgId,
    userMemberships.length,
    getToken,
    setActive,
  ]);

  if (!userLoaded || state === "checking") {
    return (
      <div className="min-h-screen md-surface flex items-center justify-center">
        <div className="md-typescale-label-small text-on-surface-variant tracking-stamp uppercase">
          Loading…
        </div>
      </div>
    );
  }

  if (state === "needs-create") {
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
