import { z } from "zod";

import { CreateOrganizationBody } from "@/modules/organizations/organizations.schemas";

const email = z.email().max(254).transform((v) => v.toLowerCase());
const password = z.string().min(10, "Use at least 10 characters").max(128);
const name = z.string().trim().min(1).max(100);

/**
 * Registration. strictObject rejects unknown keys, so `role`, `status`, `emailVerified`
 * and similar fields fail with 400 instead of being silently dropped.
 */
const CustomerRegistration = z.strictObject({
  accountType: z.literal("customer"),
  name,
  email,
  password,
});

const ProviderRegistration = z.strictObject({
  accountType: z.literal("provider"),
  name,
  email,
  password,
  organization: CreateOrganizationBody,
});

export const RegisterBody = z.preprocess(
  (v) => (v && typeof v === "object" && !("accountType" in v) ? { ...v, accountType: "customer" } : v),
  z.discriminatedUnion("accountType", [CustomerRegistration, ProviderRegistration]),
);
export type RegisterBody = z.infer<typeof RegisterBody>;

export const LoginBody = z.strictObject({
  email,
  password: z.string().min(1).max(128),
  rememberMe: z.boolean().default(true),
});
export type LoginBody = z.infer<typeof LoginBody>;

export const EmailBody = z.strictObject({ email });

export const ChangePasswordBody = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
  /** Sign out every other device; this one gets a fresh session. */
  revokeOtherSessions: z.boolean().default(true),
});
export type ChangePasswordBody = z.infer<typeof ChangePasswordBody>;

export const ResetPasswordBody = z.strictObject({
  token: z.string().min(10).max(512),
  newPassword: password,
});
