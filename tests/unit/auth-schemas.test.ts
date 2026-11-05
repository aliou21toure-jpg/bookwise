import { describe, expect, it } from "vitest";

import { LoginBody, RegisterBody, ResetPasswordBody } from "@/modules/auth/auth.schemas";
import { CreateOrganizationBody, isValidTimeZone, slugify, UpdateOrganizationBody } from "@/modules/organizations/organizations.schemas";
import { AdminUserQuery, StatusChangeBody, UpdateMeBody } from "@/modules/users/users.schemas";

const base = { name: "Ana", email: "Ana@Example.COM", password: "correct horse battery" };
const org = { name: "Maple Physio", timezone: "America/Toronto" };

describe("RegisterBody", () => {
  it("defaults to a customer account and lower-cases the email", () => {
    expect(RegisterBody.parse(base)).toEqual({ ...base, email: "ana@example.com", accountType: "customer" });
  });

  it("requires organization details for providers and fills the currency", () => {
    expect(RegisterBody.safeParse({ ...base, accountType: "provider" }).success).toBe(false);
    const parsed = RegisterBody.parse({ ...base, accountType: "provider", organization: org });
    expect(parsed).toMatchObject({ accountType: "provider", organization: { ...org, defaultCurrency: "CAD" } });
  });

  it.each([{ role: "admin" }, { status: "active" }, { emailVerified: true }, { accountType: "admin" }])("rejects %o", (extra) => {
    expect(RegisterBody.safeParse({ ...base, ...extra }).success).toBe(false);
  });

  it("rejects an organization on a customer registration", () => {
    expect(RegisterBody.safeParse({ ...base, accountType: "customer", organization: org }).success).toBe(false);
  });

  it("enforces password length 10..128", () => {
    expect(RegisterBody.safeParse({ ...base, password: "123456789" }).success).toBe(false);
    expect(RegisterBody.safeParse({ ...base, password: "x".repeat(129) }).success).toBe(false);
    expect(RegisterBody.safeParse({ ...base, password: "x".repeat(10) }).success).toBe(true);
  });
});

describe("other auth bodies", () => {
  it("LoginBody defaults rememberMe and rejects extra keys", () => {
    expect(LoginBody.parse({ email: "a@b.co", password: "x" })).toEqual({ email: "a@b.co", password: "x", rememberMe: true });
    expect(LoginBody.safeParse({ email: "a@b.co", password: "x", role: "admin" }).success).toBe(false);
  });

  it("ResetPasswordBody applies the password rules to the new password", () => {
    expect(ResetPasswordBody.safeParse({ token: "token-1234567", newPassword: "short" }).success).toBe(false);
  });
});

describe("organization input", () => {
  it.each(["America/Toronto", "Europe/Paris", "Africa/Bamako", "UTC"])("accepts the time zone %s", (tz) => {
    expect(isValidTimeZone(tz)).toBe(true);
  });

  it.each(["Mars/Olympus", "EST5EDT-not", "", "Toronto"])("rejects the time zone %j", (tz) => {
    expect(isValidTimeZone(tz)).toBe(false);
  });

  it("rejects server-owned fields and bad currency codes", () => {
    expect(CreateOrganizationBody.safeParse({ ...org, status: "active" }).success).toBe(false);
    expect(CreateOrganizationBody.safeParse({ ...org, defaultCurrency: "cad" }).success).toBe(false);
    expect(CreateOrganizationBody.safeParse({ ...org, slug: "Bad Slug" }).success).toBe(false);
    expect(UpdateOrganizationBody.safeParse({}).success).toBe(false);
    expect(UpdateOrganizationBody.safeParse({ status: "active" }).success).toBe(false);
  });
});

describe("slugify", () => {
  it.each([
    ["Café Lumière & Co.", "cafe-lumiere-co"],
    ["  Maple   Physio  ", "maple-physio"],
    ["Ō", "o-provider"],
    ["!!!", "org-provider"],
    ["a".repeat(80), "a".repeat(50)],
  ])("%j -> %j", (input, slug) => {
    expect(slugify(input)).toBe(slug);
    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe("user bodies", () => {
  it("UpdateMeBody needs at least one allowed field", () => {
    expect(UpdateMeBody.safeParse({}).success).toBe(false);
    expect(UpdateMeBody.safeParse({ role: "admin" }).success).toBe(false);
    expect(UpdateMeBody.safeParse({ phone: null }).success).toBe(true);
    expect(UpdateMeBody.safeParse({ locale: "english" }).success).toBe(false);
  });

  it("StatusChangeBody requires a reason", () => {
    expect(StatusChangeBody.safeParse({ status: "suspended" }).success).toBe(false);
    expect(StatusChangeBody.safeParse({ status: "banned", reason: "spam" }).success).toBe(false);
  });

  it("AdminUserQuery coerces and bounds pagination", () => {
    expect(AdminUserQuery.parse({})).toEqual({ page: 1, pageSize: 20, sort: "-createdAt" });
    expect(AdminUserQuery.parse({ page: "3", pageSize: "50" })).toMatchObject({ page: 3, pageSize: 50 });
    expect(AdminUserQuery.safeParse({ pageSize: "101" }).success).toBe(false);
    expect(AdminUserQuery.safeParse({ page: "0" }).success).toBe(false);
  });
});
