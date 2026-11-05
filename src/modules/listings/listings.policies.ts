/**
 * Catalogue permissions and listing status rules. Pure functions, unit tested; the database
 * repeats them (0005_catalogue_rls.sql).
 */

export interface CatalogueAccessInput {
  userRole: "customer" | "provider" | "admin" | null;
  memberRole: "owner" | "staff" | null;
  orgStatus: "active" | "suspended";
}

export type CatalogueDecision = "allow" | "not_found" | "forbidden" | "suspended";

/**
 * Managing listings, services, images and availability: any member (owner or staff) of an
 * active organization. Administrators can read everything but change content only through
 * moderation. Everyone else gets `not_found` for private data.
 */
export function decideCatalogueAccess(action: "manage.read" | "manage.write", input: CatalogueAccessInput): CatalogueDecision {
  if (input.memberRole === null) {
    if (input.userRole === "admin") return action === "manage.read" ? "allow" : "forbidden";
    return "not_found";
  }
  if (action === "manage.read") return "allow";
  return input.orgStatus === "active" ? "allow" : "suspended";
}

export type ListingStatus = "draft" | "published" | "under_review" | "rejected";

export type StatusChangeDecision =
  | { ok: true }
  | { ok: false; code: "INVALID_TRANSITION" | "FORBIDDEN" | "PUBLISH_REQUIREMENTS"; message: string };

export interface PublishFacts {
  activeServices: number;
  archived: boolean;
}

/**
 * Members move listings between draft and published. Rejection and review are moderation
 * states that only administrators set or clear, so a provider cannot republish what an
 * administrator took down.
 */
export function decideListingStatusChange(
  from: ListingStatus,
  to: ListingStatus,
  by: "member" | "admin",
  facts: PublishFacts,
): StatusChangeDecision {
  if (from === to) return { ok: true };
  if (facts.archived) return { ok: false, code: "INVALID_TRANSITION", message: "Archived listings cannot change status." };

  if (by === "member") {
    if (from === "rejected" || from === "under_review" || to === "rejected" || to === "under_review") {
      return { ok: false, code: "FORBIDDEN", message: "This listing is under moderation. Contact support to have it reviewed." };
    }
  }
  if (to === "published" && facts.activeServices === 0) {
    return { ok: false, code: "PUBLISH_REQUIREMENTS", message: "Add at least one service before publishing." };
  }
  return { ok: true };
}
