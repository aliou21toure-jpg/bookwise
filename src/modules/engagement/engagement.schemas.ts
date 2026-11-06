import { z } from "zod";

import { PageQuery } from "@/lib/http/pagination";

const rating = z.number().int().min(1).max(5);
const comment = z.string().trim().max(2000);

/** The client names the booking; listing, organization and author come from the database. */
export const CreateReviewBody = z.strictObject({ rating, comment: comment.default("") });
export type CreateReviewBody = z.infer<typeof CreateReviewBody>;

export const UpdateReviewBody = z
  .strictObject({ rating: rating.optional(), comment: comment.optional() })
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");
export type UpdateReviewBody = z.infer<typeof UpdateReviewBody>;

export const ModerateReviewBody = z.strictObject({
  hidden: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});
export type ModerateReviewBody = z.infer<typeof ModerateReviewBody>;

export const ListingReviewsQuery = PageQuery.extend({ pageSize: z.coerce.number().int().min(1).max(50).default(10) });
export type ListingReviewsQuery = z.infer<typeof ListingReviewsQuery>;

export const IdParams = z.object({ id: z.uuid() });
