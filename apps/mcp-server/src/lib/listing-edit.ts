/**
 * Phase K1 — listing edit + version trail.
 *
 * Validates an inbound copy patch against the platform's brand-rules
 * rubric, archives the current row to platform_listings_versions,
 * then updates platform_listings with the new copy, bumped iter
 * counter, and refreshed rating. Audit event 'listing.edit' fires
 * with a short diff summary so /library's audit tab shows what
 * changed.
 */

import { and, eq, sql } from "drizzle-orm";
import {
  platformListings,
  platformListingsVersions,
  type PlatformListing,
} from "../db/schema.js";
import type { DbClient } from "../db/client.js";
import { auditEvent } from "./audit.js";
import {
  scoreSeoCompliance,
  type SeoSurface,
  type SeoLanguage,
} from "@ff/brand-rules";

export interface ListingEditInput {
  listingId: string;
  tenantIdsInScope: string[];
  actor: string | null;
  /** Partial copy patch — keys depend on the listing's surface. */
  patch: Record<string, unknown>;
}

export type ListingEditResult =
  | { ok: true; listing: PlatformListing; rating: string | null; issues: string[] }
  | { ok: false; reason: "not_found" | "validation_failed"; issues: string[] };

export async function applyListingEdit(
  db: DbClient,
  input: ListingEditInput
): Promise<ListingEditResult> {
  const [current] = await db
    .select()
    .from(platformListings)
    .where(eq(platformListings.id, input.listingId))
    .limit(1);

  if (!current || !input.tenantIdsInScope.includes(current.tenantId)) {
    return { ok: false, reason: "not_found", issues: [] };
  }

  // Merge patch into current copy and validate.
  const mergedCopy = {
    ...((current.copy ?? {}) as Record<string, unknown>),
    ...input.patch,
  };
  const verdict = scoreSeoCompliance({
    surface: current.surface as SeoSurface,
    language: current.language as SeoLanguage,
    copy: mergedCopy,
    violations: [],
    flags: [],
  });

  if (verdict.blocking) {
    return { ok: false, reason: "validation_failed", issues: verdict.issues };
  }

  // Archive current row to versions, then update.
  await db.insert(platformListingsVersions).values({
    parentListingId: current.id,
    tenantId: current.tenantId,
    variantId: current.variantId,
    surface: current.surface,
    language: current.language,
    copy: current.copy,
    flags: current.flags,
    violations: current.violations,
    rating: current.rating,
    iterations: current.iterations,
    costCents: current.costCents,
    status: current.status,
    version: current.iterations,
  });

  const [updated] = await db
    .update(platformListings)
    .set({
      copy: mergedCopy,
      rating: verdict.rating,
      violations: verdict.issues,
      iterations: sql`${platformListings.iterations} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(platformListings.id, current.id))
    .returning();

  const editedFields = Object.keys(input.patch);
  await auditEvent(db, {
    tenantId: current.tenantId,
    actor: input.actor,
    action: "listing.edit",
    targetType: "platform_listing",
    targetId: current.id,
    metadata: {
      surface: current.surface,
      language: current.language,
      fields: editedFields,
      iterations: updated.iterations,
      newRating: verdict.rating,
    },
  });

  return { ok: true, listing: updated, rating: verdict.rating, issues: verdict.issues };
}

export async function listListingVersions(
  db: DbClient,
  listingId: string,
  tenantIdsInScope: string[]
) {
  const [parent] = await db
    .select({ tenantId: platformListings.tenantId })
    .from(platformListings)
    .where(eq(platformListings.id, listingId))
    .limit(1);
  if (!parent || !tenantIdsInScope.includes(parent.tenantId)) return null;

  return db
    .select()
    .from(platformListingsVersions)
    .where(
      and(
        eq(platformListingsVersions.parentListingId, listingId),
        eq(platformListingsVersions.tenantId, parent.tenantId)
      )
    )
    .orderBy(platformListingsVersions.version);
}
