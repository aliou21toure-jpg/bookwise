import * as betterAuthRoute from "@/app/api/auth/[...all]/route";
import * as loginRoute from "@/app/api/v1/auth/login/route";
import * as registerRoute from "@/app/api/v1/auth/register/route";
import { grantAdminRole } from "@/modules/users";
import { APP, call, cookieFrom, lastMail, linkIn } from "./api";

export const PASSWORD = "correct horse battery";

export interface TestUser {
  id: string;
  email: string;
  cookie: string;
}

/** Follows the verification link from the email, exactly as a browser would. */
export async function verifyByEmailLink(email: string): Promise<Response> {
  const link = linkIn(lastMail(email, "verify-email").text);
  return betterAuthRoute.GET(new Request(`${APP}${link.pathname}${link.search}`, { redirect: "manual" }));
}

export async function signIn(email: string, password = PASSWORD): Promise<string> {
  const res = await call<{ data: { user: { id: string } } }>(loginRoute.POST, "POST", "/api/v1/auth/login", { body: { email, password } });
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.cookie;
}

/** Registers through the public API, confirms the email, and signs in. */
export async function createUser(email: string, extra: Record<string, unknown> = {}): Promise<TestUser> {
  const res = await call(registerRoute.POST, "POST", "/api/v1/auth/register", {
    body: { name: email.split("@")[0], email, password: PASSWORD, ...extra },
  });
  if (res.status !== 202) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const verified = await verifyByEmailLink(email);
  if (verified.status >= 400) throw new Error(`verification failed: ${verified.status}`);
  const cookie = await signIn(email);
  const me = await call<{ data: { user: { id: string } } }>((await import("@/app/api/v1/auth/me/route")).GET, "GET", "/api/v1/auth/me", { cookie });
  return { id: me.body.data.user.id, email, cookie };
}

export const ORG = { name: "Maple Physio", timezone: "America/Toronto", defaultCurrency: "CAD" };

export async function createProvider(email: string, organization: Record<string, unknown> = ORG): Promise<TestUser & { orgId: string }> {
  const user = await createUser(email, { accountType: "provider", organization });
  const me = await call<{ data: { organizations: { id: string }[] } }>((await import("@/app/api/v1/auth/me/route")).GET, "GET", "/api/v1/auth/me", { cookie: user.cookie });
  return { ...user, orgId: me.body.data.organizations[0]!.id };
}

export async function createAdmin(email: string): Promise<TestUser> {
  const user = await createUser(email);
  await grantAdminRole(email, "test-operator");
  return user;
}

export { cookieFrom };
