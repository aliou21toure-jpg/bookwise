import { afterAll, beforeEach, describe, expect, it } from "vitest";

import * as adminOrgStatusRoute from "@/app/api/v1/admin/organizations/[id]/status/route";
import * as orgRoute from "@/app/api/v1/organizations/[id]/route";
import * as memberRoute from "@/app/api/v1/organizations/[id]/members/[userId]/route";
import * as membersRoute from "@/app/api/v1/organizations/[id]/members/route";
import * as orgsRoute from "@/app/api/v1/organizations/route";
import { getPool } from "@/db";
import { clearOutbox } from "@/lib/mail/mailer";
import { call } from "../support/api";
import { ownerQuery, truncateAuthTables } from "../support/db";
import { createAdmin, createProvider, createUser, ORG } from "../support/users";

beforeEach(async () => {
  await truncateAuthTables();
  clearOutbox();
});
afterAll(() => getPool().end());

type Err = { error: { code: string } };
const getOrg = (cookie: string, id: string) => call<{ data: { name: string; memberRole: string | null } } & Err>(orgRoute.GET, "GET", `/api/v1/organizations/${id}`, { cookie, params: { id } });
const patchOrg = (cookie: string, id: string, body: unknown) => call<{ data: { name: string } } & Err>(orgRoute.PATCH, "PATCH", `/api/v1/organizations/${id}`, { cookie, params: { id }, body });
const listMembers = (cookie: string, id: string) => call<{ data: { email: string; role: string }[] } & Err>(membersRoute.GET, "GET", `/api/v1/organizations/${id}/members`, { cookie, params: { id } });
const addMember = (cookie: string, id: string, body: unknown) => call<Err>(membersRoute.POST, "POST", `/api/v1/organizations/${id}/members`, { cookie, params: { id }, body });
const removeMember = (cookie: string, id: string, userId: string) =>
  call<Err>(memberRoute.DELETE, "DELETE", `/api/v1/organizations/${id}/members/${userId}`, { cookie, params: { id, userId } });

describe("creating organizations", () => {
  it("turns a verified customer into the owner of a new organization", async () => {
    const user = await createUser("ana@example.com");
    const res = await call<{ data: { id: string; slug: string; memberRole: string; status: string } }>(orgsRoute.POST, "POST", "/api/v1/organizations", {
      cookie: user.cookie,
      body: { ...ORG, profile: { description: "Sports physiotherapy", country: "CA" } },
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ slug: "maple-physio", memberRole: "owner", status: "active" });
    expect(await ownerQuery("select role from bookwise.users where id = $1", [user.id])).toEqual([{ role: "provider" }]);
  });

  it("gives a second organization with the same name a unique URL", async () => {
    await createProvider("a@example.com");
    const b = await createProvider("b@example.com");
    const [row] = await ownerQuery<{ slug: string }>("select slug from bookwise.organizations where id = $1", [b.orgId]);
    expect(row!.slug).toMatch(/^maple-physio-[0-9a-f]{6}$/);
  });

  it("rejects status, createdBy and unknown time zones", async () => {
    const user = await createUser("ana@example.com");
    for (const body of [
      { ...ORG, status: "suspended" },
      { ...ORG, createdBy: "11111111-1111-4111-8111-111111111111" },
      { ...ORG, timezone: "Moon/Base" },
      { ...ORG, defaultCurrency: "cad" },
    ]) {
      const res = await call(orgsRoute.POST, "POST", "/api/v1/organizations", { cookie: user.cookie, body });
      expect(res.status).toBe(400);
    }
  });

  it("requires a session", async () => {
    expect((await call(orgsRoute.POST, "POST", "/api/v1/organizations", { body: ORG })).status).toBe(401);
  });
});

describe("tenant isolation through the API", () => {
  it("answers 404 for another provider's organization on every route", async () => {
    const a = await createProvider("a@example.com");
    const b = await createProvider("b@example.com", { ...ORG, name: "Other Clinic" });

    expect((await getOrg(b.cookie, a.orgId)).status).toBe(404);
    expect((await patchOrg(b.cookie, a.orgId, { name: "Hijacked" })).status).toBe(404);
    expect((await listMembers(b.cookie, a.orgId)).status).toBe(404);
    expect((await addMember(b.cookie, a.orgId, { email: "b@example.com", role: "owner" })).status).toBe(404);
    expect((await removeMember(b.cookie, a.orgId, a.id)).status).toBe(404);

    expect((await getOrg(a.cookie, a.orgId)).body.data.name).toBe("Maple Physio");
    expect(await ownerQuery("select count(*)::int as n from bookwise.organization_members where organization_id = $1", [a.orgId])).toEqual([{ n: 1 }]);
  });

  it("answers the same 404 for an organization that does not exist", async () => {
    const a = await createProvider("a@example.com");
    const missing = await getOrg(a.cookie, "00000000-0000-4000-8000-000000000000");
    const other = await getOrg((await createUser("c@example.com")).cookie, a.orgId);
    expect(missing.status).toBe(404);
    expect(other.status).toBe(404);
    expect(missing.body.error.code).toBe(other.body.error.code);
  });

  it("lists only the caller's own organizations", async () => {
    const a = await createProvider("a@example.com");
    await createProvider("b@example.com", { ...ORG, name: "Other Clinic" });
    const res = await call<{ data: { id: string }[] }>(orgsRoute.GET, "GET", "/api/v1/organizations", { cookie: a.cookie });
    expect(res.body.data.map((o) => o.id)).toEqual([a.orgId]);
  });
});

describe("membership roles", () => {
  it("lets owners add staff; staff can read but not change anything", async () => {
    const owner = await createProvider("owner@example.com");
    const staff = await createUser("staff@example.com");

    expect((await addMember(owner.cookie, owner.orgId, { email: "staff@example.com" })).status).toBe(201);
    expect((await getOrg(staff.cookie, owner.orgId)).body.data.memberRole).toBe("staff");
    expect((await listMembers(staff.cookie, owner.orgId)).body.data.map((m) => [m.email, m.role])).toEqual([
      ["owner@example.com", "owner"],
      ["staff@example.com", "staff"],
    ]);

    expect((await patchOrg(staff.cookie, owner.orgId, { name: "Staff Rename" })).status).toBe(403);
    expect((await addMember(staff.cookie, owner.orgId, { email: "staff@example.com", role: "owner" })).status).toBe(403);
    // Privilege escalation attempt: staff removes the owner.
    expect((await removeMember(staff.cookie, owner.orgId, owner.id)).status).toBe(403);
    expect(await ownerQuery("select role from bookwise.organization_members where user_id = $1", [owner.id])).toEqual([{ role: "owner" }]);
  });

  it("never removes the last owner", async () => {
    const owner = await createProvider("owner@example.com");
    const res = await removeMember(owner.cookie, owner.orgId, owner.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LAST_OWNER");
  });

  it("lets owners remove staff, and audits additions and removals", async () => {
    const owner = await createProvider("owner@example.com");
    const staff = await createUser("staff@example.com");
    await addMember(owner.cookie, owner.orgId, { email: "staff@example.com" });
    expect((await removeMember(owner.cookie, owner.orgId, staff.id)).status).toBe(204);
    expect((await getOrg(staff.cookie, owner.orgId)).status).toBe(404);
    const actions = await ownerQuery<{ action: string }>(
      "select action from bookwise.audit_logs where organization_id = $1 order by id",
      [owner.orgId],
    );
    expect(actions.map((a) => a.action)).toEqual(["organization.created", "organization.member_added", "organization.member_removed"]);
  });

  it("refuses unknown emails and existing members", async () => {
    const owner = await createProvider("owner@example.com");
    expect((await addMember(owner.cookie, owner.orgId, { email: "nobody@example.com" })).status).toBe(404);
    expect((await addMember(owner.cookie, owner.orgId, { email: "owner@example.com" })).status).toBe(409);
  });
});

describe("suspended organizations", () => {
  it("can be read by their members but not changed", async () => {
    const owner = await createProvider("owner@example.com");
    const admin = await createAdmin("admin@example.com");
    const suspend = await call(adminOrgStatusRoute.PATCH, "PATCH", `/api/v1/admin/organizations/${owner.orgId}/status`, {
      cookie: admin.cookie,
      params: { id: owner.orgId },
      body: { status: "suspended", reason: "Reported listing under review" },
    });
    expect(suspend.status).toBe(200);

    expect((await getOrg(owner.cookie, owner.orgId)).status).toBe(200);
    const patch = await patchOrg(owner.cookie, owner.orgId, { name: "New Name" });
    expect(patch.status).toBe(403);
    expect(patch.body.error.code).toBe("ORGANIZATION_SUSPENDED");
    expect((await addMember(owner.cookie, owner.orgId, { email: "admin@example.com" })).body.error.code).toBe("ORGANIZATION_SUSPENDED");
  });

  it("lets only administrators change an organization's status", async () => {
    const owner = await createProvider("owner@example.com");
    const res = await call(adminOrgStatusRoute.PATCH, "PATCH", `/api/v1/admin/organizations/${owner.orgId}/status`, {
      cookie: owner.cookie,
      params: { id: owner.orgId },
      body: { status: "active", reason: "self-reinstate" },
    });
    expect(res.status).toBe(403);
  });
});

describe("owners editing their organization", () => {
  it("updates details and the provider profile", async () => {
    const owner = await createProvider("owner@example.com");
    const res = await call<{ data: { name: string; timezone: string; profile: { city: string } } }>(orgRoute.PATCH, "PATCH", `/api/v1/organizations/${owner.orgId}`, {
      cookie: owner.cookie,
      params: { id: owner.orgId },
      body: { name: "Maple Physio & Rehab", timezone: "America/Vancouver", profile: { city: "Vancouver" } },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: "Maple Physio & Rehab", timezone: "America/Vancouver", profile: { city: "Vancouver" } });
  });
});
