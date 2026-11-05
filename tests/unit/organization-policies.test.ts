import { describe, expect, it } from "vitest";

import { decideOrgAccess, type OrgAccessInput, type OrgAction, type OrgDecision } from "@/modules/organizations/organizations.policies";

const ACTIONS: OrgAction[] = ["org.read", "members.read", "org.update", "members.manage"];
const READS = new Set<OrgAction>(["org.read", "members.read"]);

/** The full matrix, written out independently of the implementation. */
function expected(action: OrgAction, input: OrgAccessInput): OrgDecision {
  const read = READS.has(action);
  if (input.memberRole === null) return input.userRole === "admin" ? (read ? "allow" : "forbidden") : "not_found";
  if (read) return "allow";
  if (input.memberRole === "staff") return "forbidden";
  return input.orgStatus === "active" ? "allow" : "suspended";
}

describe("decideOrgAccess", () => {
  const cases: [OrgAction, OrgAccessInput][] = [];
  for (const action of ACTIONS)
    for (const userRole of ["customer", "provider", "admin"] as const)
      for (const memberRole of [null, "staff", "owner"] as const)
        for (const orgStatus of ["active", "suspended"] as const) cases.push([action, { userRole, memberRole, orgStatus }]);

  it.each(cases)("%s %o", (action, input) => {
    expect(decideOrgAccess(action, input)).toBe(expected(action, input));
  });

  it("hides organizations from non-members with not_found, never forbidden (no id probing)", () => {
    for (const action of ACTIONS) {
      expect(decideOrgAccess(action, { userRole: "provider", memberRole: null, orgStatus: "active" })).toBe("not_found");
    }
  });

  it("never lets staff change an organization", () => {
    expect(decideOrgAccess("members.manage", { userRole: "provider", memberRole: "staff", orgStatus: "active" })).toBe("forbidden");
  });
});
