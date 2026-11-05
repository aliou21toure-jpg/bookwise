import { afterAll, beforeEach, describe, expect, it } from "vitest";

import * as loginRoute from "@/app/api/v1/auth/login/route";
import * as meRoute from "@/app/api/v1/auth/me/route";
import * as userStatusRoute from "@/app/api/v1/admin/users/[id]/status/route";
import * as usersRoute from "@/app/api/v1/admin/users/route";
import { getPool } from "@/db";
import { clearOutbox } from "@/lib/mail/mailer";
import { grantAdminRole } from "@/modules/users";
import { call } from "../support/api";
import { ownerQuery, truncateAuthTables } from "../support/db";
import { createAdmin, createProvider, createUser, PASSWORD, signIn } from "../support/users";

beforeEach(async () => {
  await truncateAuthTables();
  clearOutbox();
});
afterAll(() => getPool().end());

type Err = { error: { code: string } };
const listUsers = (cookie: string | undefined, query = "") => call<{ data: { email: string; role: string }[]; meta: { page: number; pageSize: number; total: number } } & Err>(usersRoute.GET, "GET", `/api/v1/admin/users${query}`, { cookie });
const setStatus = (cookie: string, id: string, body: unknown) =>
  call<{ data: { status: string; sessionsRevoked: number } } & Err>(userStatusRoute.PATCH, "PATCH", `/api/v1/admin/users/${id}/status`, { cookie, params: { id }, body });

describe("admin routes are server-side protected", () => {
  it("answers 401 without a session and 403 for customers and providers", async () => {
    const customer = await createUser("c@example.com");
    const provider = await createProvider("p@example.com");
    expect((await listUsers(undefined)).status).toBe(401);
    expect((await listUsers(customer.cookie)).status).toBe(403);
    expect((await listUsers(provider.cookie)).status).toBe(403);
    expect((await setStatus(provider.cookie, customer.id, { status: "suspended", reason: "escalation attempt" })).status).toBe(403);
    expect(await ownerQuery("select status from bookwise.users where id = $1", [customer.id])).toEqual([{ status: "active" }]);
  });

  it("lists users with pagination, search and filters", async () => {
    const admin = await createAdmin("admin@example.com");
    for (const n of [1, 2, 3]) await createUser(`user${n}@example.com`);

    const page1 = await listUsers(admin.cookie, "?pageSize=2&sort=email");
    expect(page1.status).toBe(200);
    expect(page1.body.meta).toEqual({ page: 1, pageSize: 2, total: 4 });
    expect(page1.body.data.map((u) => u.email)).toEqual(["admin@example.com", "user1@example.com"]);

    const search = await listUsers(admin.cookie, "?q=user2");
    expect(search.body.data.map((u) => u.email)).toEqual(["user2@example.com"]);
    const admins = await listUsers(admin.cookie, "?role=admin");
    expect(admins.body.data.map((u) => u.email)).toEqual(["admin@example.com"]);
    // Wildcards are escaped: "_" is not "any character".
    expect((await listUsers(admin.cookie, "?q=user_")).body.data).toEqual([]);
    expect((await listUsers(admin.cookie, "?pageSize=1000")).status).toBe(400);
  });
});

describe("suspension", () => {
  it("revokes every session at once and blocks new sign-ins until reinstated", async () => {
    const admin = await createAdmin("admin@example.com");
    const user = await createUser("ana@example.com");
    const laptop = await signIn("ana@example.com");

    const res = await setStatus(admin.cookie, user.id, { status: "suspended", reason: "Chargeback fraud investigation" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("suspended");
    expect(res.body.data.sessionsRevoked).toBeGreaterThanOrEqual(2);

    expect((await call(meRoute.GET, "GET", "/api/v1/auth/me", { cookie: user.cookie })).status).toBe(401);
    expect((await call(meRoute.GET, "GET", "/api/v1/auth/me", { cookie: laptop })).status).toBe(401);
    expect(await ownerQuery("select id from bookwise.sessions where user_id = $1", [user.id])).toEqual([]);

    const login = await call<Err>(loginRoute.POST, "POST", "/api/v1/auth/login", { body: { email: "ana@example.com", password: PASSWORD } });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe("ACCOUNT_SUSPENDED");
    expect(await ownerQuery("select id from bookwise.sessions where user_id = $1", [user.id])).toEqual([]);

    expect((await setStatus(admin.cookie, user.id, { status: "active", reason: "Investigation closed" })).status).toBe(200);
    expect((await call(loginRoute.POST, "POST", "/api/v1/auth/login", { body: { email: "ana@example.com", password: PASSWORD } })).status).toBe(200);

    const audit = await ownerQuery<{ action: string; reason: string; actor_user_id: string }>(
      "select action, reason, actor_user_id from bookwise.audit_logs where entity_id = $1 and action like 'user.%' order by id",
      [user.id],
    );
    expect(audit).toEqual([
      { action: "user.suspended", reason: "Chargeback fraud investigation", actor_user_id: admin.id },
      { action: "user.reinstated", reason: "Investigation closed", actor_user_id: admin.id },
    ]);
  });

  it("protects administrators and the caller's own account", async () => {
    const admin = await createAdmin("admin@example.com");
    const other = await createAdmin("other-admin@example.com");
    expect((await setStatus(admin.cookie, admin.id, { status: "suspended", reason: "oops" })).status).toBe(409);
    expect((await setStatus(admin.cookie, other.id, { status: "suspended", reason: "turf war" })).status).toBe(409);
  });

  it("requires a reason and rejects unknown fields", async () => {
    const admin = await createAdmin("admin@example.com");
    const user = await createUser("ana@example.com");
    expect((await setStatus(admin.cookie, user.id, { status: "suspended" })).status).toBe(400);
    expect((await setStatus(admin.cookie, user.id, { status: "suspended", reason: "spam", role: "admin" })).status).toBe(400);
    expect((await setStatus(admin.cookie, "not-a-uuid", { status: "suspended", reason: "spam" })).status).toBe(400);
  });
});

describe("admin:create (operator command)", () => {
  it("promotes a verified account and records who ran it", async () => {
    const user = await createUser("ana@example.com");
    await grantAdminRole("ana@example.com", "ops-alice");
    expect(await ownerQuery("select role from bookwise.users where id = $1", [user.id])).toEqual([{ role: "admin" }]);
    const audit = await ownerQuery("select action, actor_role, reason from bookwise.audit_logs where action = 'user.admin_granted'");
    expect(audit).toEqual([{ action: "user.admin_granted", actor_role: "system", reason: "admin:create run by ops-alice" }]);
  });

  it("refuses unknown and unverified accounts", async () => {
    await expect(grantAdminRole("ghost@example.com", "ops")).rejects.toThrow(/not found/);
    await ownerQuery("insert into bookwise.users (name, email) values ('New', 'new@example.com')");
    await expect(grantAdminRole("new@example.com", "ops")).rejects.toThrow(/confirm its email/);
  });
});
