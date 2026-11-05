import { describe, expect, it } from "vitest";

import { pgErrorCode, toAppError } from "@/lib/http/handler";
import { resetPasswordMessage, verifyEmailMessage } from "@/lib/mail/templates";
import { requestMeta } from "@/modules/audit/request-meta";

describe("database error mapping", () => {
  it("unwraps Drizzle's wrapper to find the PostgreSQL code", () => {
    const pg = Object.assign(new Error("new row violates row-level security policy"), { code: "42501" });
    const drizzle = Object.assign(new Error("Failed query"), { cause: pg });
    expect(pgErrorCode(drizzle)).toBe("42501");
    expect(pgErrorCode(new Error("plain"))).toBeUndefined();
    expect(pgErrorCode(Object.assign(new Error(), { code: "ECONNREFUSED" }))).toBeUndefined();
  });

  it("turns an RLS refusal into 403 and a unique violation into 409, without leaking SQL", () => {
    const rls = toAppError(Object.assign(new Error("policy for relation organizations"), { code: "42501" }));
    expect(rls.status).toBe(403);
    expect(rls.message).not.toMatch(/policy|relation/);
    expect(toAppError(Object.assign(new Error("duplicate key"), { code: "23505" })).status).toBe(409);
    expect(toAppError(new Error("secret internals")).message).not.toContain("secret");
  });
});

describe("email templates", () => {
  it("escape user-controlled names in HTML", () => {
    const mail = verifyEmailMessage("a@example.com", "<script>alert(1)</script>", "https://app.example/verify?token=abc&x=1");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("token=abc&amp;x=1");
    expect(mail.text).toContain("https://app.example/verify?token=abc&x=1");
  });

  it("state the expiry so users know when to ask again", () => {
    expect(resetPasswordMessage("a@example.com", "Ana", "https://x").text).toContain("30 minutes");
    expect(verifyEmailMessage("a@example.com", "Ana", "https://x").text).toContain("1 hour");
  });
});

describe("requestMeta", () => {
  it("takes the first forwarded address and ignores oversized values", () => {
    const req = (headers: Record<string, string>) => new Request("http://localhost/x", { headers });
    expect(requestMeta(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }), "req_1")).toEqual({ requestId: "req_1", ipAddress: "203.0.113.7" });
    expect(requestMeta(req({}), "req_1").ipAddress).toBeNull();
    expect(requestMeta(req({ "x-forwarded-for": "x".repeat(100) }), "req_1").ipAddress).toBeNull();
  });
});
