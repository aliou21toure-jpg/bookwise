import { z } from "zod";

import { PageQuery } from "@/lib/http/pagination";
import { BOOKING_STATUSES } from "./state-machine";

/** The client says which slot and how many; it never sends a price. */
export const CreateHoldBody = z.strictObject({
  serviceId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  quantity: z.number().int().min(1).max(1000).default(1),
  note: z.string().trim().max(1000).default(""),
});
export type CreateHoldBody = z.infer<typeof CreateHoldBody>;

export const CheckoutBody = z.strictObject({
  bookingId: z.uuid(),
  note: z.string().trim().max(1000).optional(),
});
export type CheckoutBody = z.infer<typeof CheckoutBody>;

export const CancelBody = z.strictObject({ reason: z.string().trim().min(3).max(500).optional() });
export const RejectBody = z.strictObject({ reason: z.string().trim().min(3).max(500) });

export const BookingListQuery = PageQuery.extend({
  organizationId: z.uuid().optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
  from: z.iso.datetime({ offset: true }).transform((v) => new Date(v)).optional(),
  to: z.iso.datetime({ offset: true }).transform((v) => new Date(v)).optional(),
  timeframe: z.enum(["upcoming", "past"]).optional(),
  serviceId: z.uuid().optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type BookingListQuery = z.infer<typeof BookingListQuery>;

export const IdParams = z.object({ id: z.uuid() });
