import { afterAll, beforeEach, describe, expect, it } from "vitest";

import * as forgotRoute from "@/app/api/v1/auth/password/forgot/route";
import * as resetRoute from "@/app/api/v1/auth/password/reset/route";
import * as loginRoute from "@/app/api/v1/auth/login/route";
import * as logoutRoute from "@/app/api/v1/auth/logout/route";
import * as meRoute from "@/app/api/v1/auth/me/route";
import * as registerRoute from "@/app/api/v1/auth/register/route";
import * as resendRoute from "@/app/api/v1/auth/verification/resend/route";
import { getPool } from "@/db";
import { clearOutbox, readOutbox } from "@/lib/mail/mailer";
import { call, lastMail, linkIn } from "../support/api";
import { ownerQuery, truncateAuthTables } from "../support/db";
import { createProvider, createUser, ORG, PASSWORD, signIn, verifyByEmailLink } from "../support/users";

beforeEach(async () => {
  await truncateAuthTables();
  clearOutbox();
});
afterAll(() => getPool().end());

const register = (body: unknown) => call<{ data: unknown; error?: { code: string } }>(registerRoute.POST, "POST", "/api/v1/auth/register", { body });
const login = (email: string, password: string, headers?: Record<string, string>) =>
  call<{ data?: { user: { role: string } }; error?: { code: string; message: string } }>(loginRoute.POST, "POST", "/api/v1/auth/login", {
    body: { email, password },
    headers,
  });
const me = (cookie?: string) => call<{ data?: { user: { role: string; email: string }; organizations: unknown[] }; error?: { code: string } }>(meRoute.GET, "GET", "/api/v1/auth/me", { cookie });

describe("customer registration and email verification", () => {
  it("requires a confirmed email before the first sign-in", async () => {
    const res = await register({ name: "Ana", email: "Ana@Example.com", password: PASSWORD });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ data: { verificationRequired: true, email: "ana@example.com" } });
    expect(res.headers.getSetCookie()).toEqual([]);

    const before = await login("ana@example.com", PASSWORD);
    expect(before.status).toBe(403);
    expect(before.body.error?.code).toBe("EMAIL_NOT_VERIFIED");

    const verified = await verifyByEmailLink("ana@example.com");
    expect(verified.status).toBe(302);
    expect(verified.headers.get("location")).toContain("/account?verified=1");

    const after = await login("ana@example.com", PASSWORD);
    expect(after.status).toBe(200);
    expect(after.body.data?.user.role).toBe("customer");
    const cookie = after.headers.getSetCookie().find((c) => c.startsWith("bookwise.session_token="));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("answers a duplicate registration exactly like a new one (no account discovery)", async () => {
    const first = await register({ name: "Ana", email: "ana@example.com", password: PASSWORD });
    const second = await register({ name: "Mallory", email: "ana@example.com", password: "another password!" });
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(await ownerQuery("select name from bookwise.users")).toEqual([{ name: "Ana" }]);
  });

  it("rejects role, status and other server-owned fields with 400 (mass assignment)", async () => {
    for (const extra of [{ role: "admin" }, { status: "active" }, { emailVerified: true }]) {
      const res = await register({ name: "Eve", email: "eve@example.com", password: PASSWORD, ...extra });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("VALIDATION_FAILED");
    }
    expect(await ownerQuery("select id from bookwise.users")).toEqual([]);
  });

  it("rejects short passwords and malformed emails", async () => {
    expect((await register({ name: "Bo", email: "bo@example.com", password: "short" })).status).toBe(400);
    expect((await register({ name: "Bo", email: "not-an-email", password: PASSWORD })).status).toBe(400);
  });

  it("resends a verification link only for accounts that need one, with the same answer", async () => {
    await register({ name: "Ana", email: "ana@example.com", password: PASSWORD });
    clearOutbox();
    const known = await call(resendRoute.POST, "POST", "/api/v1/auth/verification/resend", { body: { email: "ana@example.com" } });
    const unknown = await call(resendRoute.POST, "POST", "/api/v1/auth/verification/resend", { body: { email: "ghost@example.com" } });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(readOutbox().map((m) => m.to)).toEqual(["ana@example.com"]);
  });
});

describe("provider registration", () => {
  it("creates the account, the organization, the owner membership and an audit entry", async () => {
    const provider = await createProvider("owner@example.com", { ...ORG, profile: { city: "Toronto", country: "CA" } });
    const res = await me(provider.cookie);
    expect(res.body.data?.user.role).toBe("provider");
    expect(res.body.data?.organizations).toEqual([
      { id: provider.orgId, name: "Maple Physio", slug: "maple-physio", status: "active", role: "owner" },
    ]);
    const audit = await ownerQuery("select action, actor_user_id, organization_id from bookwise.audit_logs where action = 'organization.created'");
    expect(audit).toEqual([{ action: "organization.created", actor_user_id: provider.id, organization_id: provider.orgId }]);
  });

  it("requires valid organization details and creates nothing when they are wrong", async () => {
    const res = await register({
      accountType: "provider",
      name: "Pat",
      email: "pat@example.com",
      password: PASSWORD,
      organization: { name: "Pat's Studio", timezone: "Mars/Olympus_Mons" },
    });
    expect(res.status).toBe(400);
    expect(await ownerQuery("select id from bookwise.users")).toEqual([]);
  });

  it("does not attach an organization to someone else's existing account", async () => {
    await createUser("victim@example.com");
    const res = await register({ accountType: "provider", name: "Mallory", email: "victim@example.com", password: PASSWORD, organization: ORG });
    expect(res.status).toBe(202);
    expect(await ownerQuery("select id from bookwise.organizations")).toEqual([]);
    expect(await ownerQuery("select role from bookwise.users")).toEqual([{ role: "customer" }]);
  });
});

describe("sign-in, sessions and sign-out", () => {
  it("gives the same answer for an unknown email and a wrong password", async () => {
    await createUser("ana@example.com");
    const wrong = await login("ana@example.com", "wrong password!!");
    const unknown = await login("ghost@example.com", "wrong password!!");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error?.code).toBe("INVALID_CREDENTIALS");
    expect({ ...wrong.body.error, requestId: undefined }).toEqual({ ...unknown.body.error, requestId: undefined });
  });

  it("returns 401 without a session and with a forged or tampered cookie", async () => {
    const user = await createUser("ana@example.com");
    expect((await me()).status).toBe(401);
    expect((await me("bookwise.session_token=forged.token")).status).toBe(401);
    const tampered = user.cookie.replace(/session_token=([^.;]+)/, "session_token=$1x");
    expect((await me(tampered)).status).toBe(401);
    expect((await me(user.cookie)).status).toBe(200);
  });

  it("deletes the session on sign-out, so the old cookie stops working", async () => {
    const user = await createUser("ana@example.com");
    const sessionsBefore = await ownerQuery("select id from bookwise.sessions where user_id = $1", [user.id]);
    const out = await call(logoutRoute.POST, "POST", "/api/v1/auth/logout", { cookie: user.cookie });
    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie().some((c) => /session_token=;/.test(c) || /Max-Age=0/i.test(c))).toBe(true);
    expect((await me(user.cookie)).status).toBe(401);
    // Only this device's session is gone (verifying the email signed in another one).
    const sessionsAfter = await ownerQuery("select id from bookwise.sessions where user_id = $1", [user.id]);
    expect(sessionsAfter).toHaveLength(sessionsBefore.length - 1);
  });

  it("refuses a sign-in posted from another site (CSRF)", async () => {
    await createUser("ana@example.com");
    const res = await login("ana@example.com", PASSWORD, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("CROSS_ORIGIN_BLOCKED");
  });

  it("records successful sign-ins in the audit log without secrets", async () => {
    const user = await createUser("ana@example.com");
    const rows = await ownerQuery<{ action: string; before: unknown; after: unknown }>(
      "select action, before, after from bookwise.audit_logs where actor_user_id = $1 and action = 'auth.sign_in'",
      [user.id],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(rows)).not.toContain(PASSWORD);
  });
});

describe("profile", () => {
  it("updates the name and customer profile but rejects role, status and email", async () => {
    const user = await createUser("ana@example.com");
    const ok = await call<{ data: { user: { name: string }; profile: { phone: string; locale: string } } }>(meRoute.PATCH, "PATCH", "/api/v1/auth/me", {
      cookie: user.cookie,
      body: { name: "Ana Silva", phone: "+1 416 555 0100", locale: "fr-CA" },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.user.name).toBe("Ana Silva");
    expect(ok.body.data.profile).toMatchObject({ phone: "+1 416 555 0100", locale: "fr-CA" });

    for (const body of [{ role: "admin" }, { status: "suspended" }, { email: "x@example.com" }, {}]) {
      const res = await call(meRoute.PATCH, "PATCH", "/api/v1/auth/me", { cookie: user.cookie, body });
      expect(res.status).toBe(400);
    }
    expect(await ownerQuery("select role, status, email from bookwise.users")).toEqual([{ role: "customer", status: "active", email: "ana@example.com" }]);
  });
});

describe("password reset", () => {
  it("answers the same for unknown emails and sends nothing", async () => {
    await createUser("ana@example.com");
    clearOutbox();
    const known = await call(forgotRoute.POST, "POST", "/api/v1/auth/password/forgot", { body: { email: "ana@example.com" } });
    const unknown = await call(forgotRoute.POST, "POST", "/api/v1/auth/password/forgot", { body: { email: "ghost@example.com" } });
    expect(known.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    expect(readOutbox().map((m) => [m.to, m.kind])).toEqual([["ana@example.com", "reset-password"]]);
  });

  it("sets the new password, signs out every session, and works only once", async () => {
    const user = await createUser("ana@example.com");
    const secondDevice = await signIn("ana@example.com");
    await call(forgotRoute.POST, "POST", "/api/v1/auth/password/forgot", { body: { email: "ana@example.com" } });
    const token = linkIn(lastMail("ana@example.com", "reset-password").text).pathname.split("/").pop()!;

    const reset = await call(resetRoute.POST, "POST", "/api/v1/auth/password/reset", { body: { token, newPassword: "a brand new passphrase" } });
    expect(reset.status).toBe(200);

    expect((await me(user.cookie)).status).toBe(401);
    expect((await me(secondDevice)).status).toBe(401);
    expect((await login("ana@example.com", PASSWORD)).status).toBe(401);
    expect((await login("ana@example.com", "a brand new passphrase")).status).toBe(200);

    const reuse = await call<{ error: { code: string } }>(resetRoute.POST, "POST", "/api/v1/auth/password/reset", { body: { token, newPassword: "yet another passphrase" } });
    expect(reuse.status).toBe(400);

    const audit = await ownerQuery("select action from bookwise.audit_logs where action = 'auth.password_reset'");
    expect(audit).toHaveLength(1);
  });

  it("rejects a made-up token", async () => {
    const res = await call(resetRoute.POST, "POST", "/api/v1/auth/password/reset", { body: { token: "made-up-token-123", newPassword: "a brand new passphrase" } });
    expect(res.status).toBe(400);
  });
});
