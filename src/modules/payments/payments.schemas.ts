import { z } from "zod";

export const CreateIntentBody = z.strictObject({ bookingId: z.uuid() });
export const SimulateBody = z.strictObject({ outcome: z.enum(["succeed", "fail"]).default("succeed") });
export const IdParams = z.object({ id: z.uuid() });
export const RefundBody = z.strictObject({ reason: z.string().trim().min(3).max(500) });
