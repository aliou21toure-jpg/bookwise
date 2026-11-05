import { z } from "zod";

import { PageQuery } from "@/lib/http/pagination";

const title = z.string().trim().min(3).max(120);
const description = z.string().trim().max(5000);
const city = z.string().trim().min(1).max(100);
const category = z.enum(["service", "activity", "accommodation"]);

/** strictObject: status, organizationId changes and other server-owned fields are rejected. */
export const CreateListingBody = z.strictObject({
  organizationId: z.uuid(),
  category,
  title,
  description: description.default(""),
  city,
});
export type CreateListingBody = z.infer<typeof CreateListingBody>;

export const UpdateListingBody = z
  .strictObject({
    category: category.optional(),
    title: title.optional(),
    description: description.optional(),
    city: city.optional(),
    // Members may publish or unpublish; moderation states are refused by the policy.
    status: z.enum(["draft", "published"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");
export type UpdateListingBody = z.infer<typeof UpdateListingBody>;

export const ModerateListingBody = z.strictObject({
  status: z.enum(["published", "draft", "rejected", "under_review"]),
  reason: z.string().trim().min(3).max(500),
});
export type ModerateListingBody = z.infer<typeof ModerateListingBody>;

const minor = z.coerce.number().int().min(0).max(100_000_000);

export const SearchQuery = PageQuery.extend({
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
  q: z.string().trim().min(1).max(100).optional(),
  category: category.optional(),
  city: z.string().trim().min(1).max(100).optional(),
  minPrice: minor.optional(),
  maxPrice: minor.optional(),
  sort: z.enum(["relevance", "newest", "price_asc", "price_desc"]).default("relevance"),
}).refine((v) => v.minPrice === undefined || v.maxPrice === undefined || v.minPrice <= v.maxPrice, {
  message: "minPrice must not exceed maxPrice",
  path: ["minPrice"],
});
export type SearchQuery = z.infer<typeof SearchQuery>;

const serviceFields = {
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000),
  durationMinutes: z.number().int().min(5).max(1440),
  // Integer minor units (cents). The currency is the organization's; clients never set it.
  priceMinor: z.number().int().min(0).max(100_000_000),
  pricing: z.enum(["per_booking", "per_participant"]),
  capacity: z.number().int().min(1).max(1000),
  maxPerBooking: z.number().int().min(1).max(1000),
  requiresApproval: z.boolean(),
  cancellationWindowHours: z.number().int().min(0).max(720),
};

export const CreateServiceBody = z
  .strictObject({
    ...serviceFields,
    description: serviceFields.description.default(""),
    pricing: serviceFields.pricing.default("per_booking"),
    capacity: serviceFields.capacity.default(1),
    maxPerBooking: serviceFields.maxPerBooking.default(1),
    requiresApproval: serviceFields.requiresApproval.default(false),
    cancellationWindowHours: serviceFields.cancellationWindowHours.default(24),
  })
  .refine((v) => v.maxPerBooking <= v.capacity, { message: "maxPerBooking cannot exceed capacity", path: ["maxPerBooking"] });
export type CreateServiceBody = z.infer<typeof CreateServiceBody>;

export const UpdateServiceBody = z
  .strictObject({
    name: serviceFields.name.optional(),
    description: serviceFields.description.optional(),
    durationMinutes: serviceFields.durationMinutes.optional(),
    priceMinor: serviceFields.priceMinor.optional(),
    pricing: serviceFields.pricing.optional(),
    capacity: serviceFields.capacity.optional(),
    maxPerBooking: serviceFields.maxPerBooking.optional(),
    requiresApproval: serviceFields.requiresApproval.optional(),
    cancellationWindowHours: serviceFields.cancellationWindowHours.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");
export type UpdateServiceBody = z.infer<typeof UpdateServiceBody>;

export const IdParams = z.object({ id: z.uuid() });
export const ImageParams = z.object({ id: z.uuid(), imageId: z.uuid() });
export const MediaParams = z.object({
  orgId: z.uuid(),
  file: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/),
});
