import { z } from "zod";

import { PageQuery } from "@/lib/http/pagination";

const name = z.string().trim().min(1).max(100);
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number");
const locale = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, "Use a locale such as en or fr-CA");

/** strictObject: unknown keys such as `role`, `status` or `email` are rejected with 400. */
export const UpdateMeBody = z
  .strictObject({
    name: name.optional(),
    phone: phone.nullable().optional(),
    locale: locale.optional(),
    marketingOptIn: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");
export type UpdateMeBody = z.infer<typeof UpdateMeBody>;

export const AdminUserQuery = PageQuery.extend({
  q: z.string().trim().min(1).max(100).optional(),
  role: z.enum(["customer", "provider", "admin"]).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  sort: z.enum(["-createdAt", "createdAt", "email"]).default("-createdAt"),
});
export type AdminUserQuery = z.infer<typeof AdminUserQuery>;

export const StatusChangeBody = z.strictObject({
  status: z.enum(["active", "suspended"]),
  reason: z.string().trim().min(3).max(500),
});
export type StatusChangeBody = z.infer<typeof StatusChangeBody>;

export const IdParams = z.object({ id: z.uuid() });
