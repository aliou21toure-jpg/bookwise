import { z } from "zod";

import { PageQuery } from "@/lib/http/pagination";

const q = z.string().trim().min(1).max(100).optional();

export const ProviderCustomersQuery = PageQuery.extend({ q, sort: z.enum(["recent", "bookings", "spent", "name"]).default("recent") });
export type ProviderCustomersQuery = z.infer<typeof ProviderCustomersQuery>;

export const RevenueQuery = z.object({ months: z.coerce.number().int().min(1).max(24).default(6) });
export type RevenueQuery = z.infer<typeof RevenueQuery>;

/** A calendar week starting on the given local date (YYYY-MM-DD, in the organization's time zone). */
export const CalendarQuery = z.object({ week: z.iso.date().optional(), serviceId: z.uuid().optional() });
export type CalendarQuery = z.infer<typeof CalendarQuery>;

export const AdminOrganizationsQuery = PageQuery.extend({ q, status: z.enum(["active", "suspended"]).optional() });
export type AdminOrganizationsQuery = z.infer<typeof AdminOrganizationsQuery>;

export const AdminListingsQuery = PageQuery.extend({
  q,
  status: z.enum(["draft", "published", "under_review", "rejected"]).optional(),
  archived: z.enum(["true", "false"]).optional(),
});
export type AdminListingsQuery = z.infer<typeof AdminListingsQuery>;

export const AdminPaymentsQuery = PageQuery.extend({
  q,
  status: z.enum(["requires_payment", "authorized", "succeeded", "failed", "canceled"]).optional(),
});
export type AdminPaymentsQuery = z.infer<typeof AdminPaymentsQuery>;

export const AdminAuditQuery = PageQuery.extend({
  action: z
    .string()
    .trim()
    .regex(/^[a-z_.]{2,60}$/, "Use an action such as booking or user.suspended")
    .optional(),
  entityType: z
    .string()
    .trim()
    .regex(/^[a-z_]{2,40}$/)
    .optional(),
  organizationId: z.uuid().optional(),
  actorUserId: z.uuid().optional(),
});
export type AdminAuditQuery = z.infer<typeof AdminAuditQuery>;

export const AdminReviewsQuery = PageQuery.extend({ hidden: z.enum(["true", "false"]).optional(), maxRating: z.coerce.number().int().min(1).max(5).optional() });
export type AdminReviewsQuery = z.infer<typeof AdminReviewsQuery>;
