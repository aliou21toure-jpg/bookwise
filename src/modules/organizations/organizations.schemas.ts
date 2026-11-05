import { z } from "zod";

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
}

const name = z.string().trim().min(2).max(100);
const timezone = z.string().trim().max(64).refine(isValidTimeZone, "Use an IANA time zone such as America/Toronto");
const currency = z.string().regex(/^[A-Z]{3}$/, "Use an ISO 4217 code such as CAD");
const slug = z
  .string()
  .min(3)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lower-case letters, digits and single hyphens");

export const ProviderProfileInput = z.strictObject({
  description: z.string().trim().max(2000).nullable().optional(),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number").nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  country: z.string().regex(/^[A-Z]{2}$/, "Use an ISO 3166 country code such as CA").nullable().optional(),
});
export type ProviderProfileInput = z.infer<typeof ProviderProfileInput>;

/** strictObject everywhere: `status`, `createdBy` and other server-owned fields are rejected. */
export const CreateOrganizationBody = z.strictObject({
  name,
  slug: slug.optional(),
  timezone,
  defaultCurrency: currency.default("CAD"),
  profile: ProviderProfileInput.optional(),
});
export type CreateOrganizationBody = z.infer<typeof CreateOrganizationBody>;

export const UpdateOrganizationBody = z
  .strictObject({
    name: name.optional(),
    timezone: timezone.optional(),
    defaultCurrency: currency.optional(),
    profile: ProviderProfileInput.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");
export type UpdateOrganizationBody = z.infer<typeof UpdateOrganizationBody>;

export const AddMemberBody = z.strictObject({
  email: z.email().max(254),
  role: z.enum(["owner", "staff"]).default("staff"),
});
export type AddMemberBody = z.infer<typeof AddMemberBody>;

export const OrgParams = z.object({ id: z.uuid() });
export const MemberParams = z.object({ id: z.uuid(), userId: z.uuid() });

/** "Café Lumière & Co." -> "cafe-lumiere-co" */
export function slugify(value: string): string {
  const base = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return base.length >= 3 ? base : `${base || "org"}-provider`.replace(/^-/, "");
}
