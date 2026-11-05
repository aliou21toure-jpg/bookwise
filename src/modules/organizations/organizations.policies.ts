/**
 * Who may do what with an organization. Pure functions, so every combination is unit
 * tested; row-level security repeats these rules in the database (0003_identity_rls.sql).
 */

export type OrgAction = "org.read" | "org.update" | "members.read" | "members.manage";

export interface OrgAccessInput {
  /** The platform role of the signed-in user. */
  userRole: "customer" | "provider" | "admin";
  /** The user's role inside this organization, or null if they are not a member. */
  memberRole: "owner" | "staff" | null;
  orgStatus: "active" | "suspended";
}

/**
 * - `not_found`: the caller may not know the organization's private details exist, so the
 *   API answers 404, never 403 (ids cannot be probed).
 * - `forbidden`: a member without enough rights.
 * - `suspended`: an owner trying to change a suspended organization.
 */
export type OrgDecision = "allow" | "not_found" | "forbidden" | "suspended";

export function decideOrgAccess(action: OrgAction, input: OrgAccessInput): OrgDecision {
  const { userRole, memberRole, orgStatus } = input;
  const reads = action === "org.read" || action === "members.read";

  if (memberRole === null) {
    // Administrators can inspect any organization, but change it only through the
    // dedicated, audited admin endpoints (suspend / reinstate).
    if (userRole === "admin") return reads ? "allow" : "forbidden";
    return "not_found";
  }

  if (reads) return "allow";
  if (memberRole !== "owner") return "forbidden";
  return orgStatus === "active" ? "allow" : "suspended";
}
