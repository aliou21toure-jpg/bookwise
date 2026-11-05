import { z } from "zod";

const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM");
const localDate = z.iso.date();

const ruleFields = {
  weekday: z.number().int().min(0).max(6),
  startLocal: localTime,
  endLocal: localTime,
  slotIntervalMinutes: z.number().int().min(5).max(1440),
  validFrom: localDate,
  validUntil: localDate.nullable(),
};

const timesInOrder = (v: { startLocal?: string; endLocal?: string }) => !v.startLocal || !v.endLocal || v.endLocal > v.startLocal;
const datesInOrder = (v: { validFrom?: string; validUntil?: string | null }) => !v.validFrom || !v.validUntil || v.validUntil >= v.validFrom;

export const CreateRuleBody = z
  .strictObject({
    serviceId: z.uuid(),
    weekday: ruleFields.weekday,
    startLocal: ruleFields.startLocal,
    endLocal: ruleFields.endLocal,
    /** Defaults to the service's duration (back-to-back slots). */
    slotIntervalMinutes: ruleFields.slotIntervalMinutes.optional(),
    /** Defaults to today in the organization's time zone. */
    validFrom: ruleFields.validFrom.optional(),
    validUntil: ruleFields.validUntil.default(null),
  })
  .refine(timesInOrder, { message: "endLocal must be after startLocal", path: ["endLocal"] })
  .refine(datesInOrder, { message: "validUntil must not be before validFrom", path: ["validUntil"] });
export type CreateRuleBody = z.infer<typeof CreateRuleBody>;

export const UpdateRuleBody = z
  .strictObject({
    weekday: ruleFields.weekday.optional(),
    startLocal: ruleFields.startLocal.optional(),
    endLocal: ruleFields.endLocal.optional(),
    slotIntervalMinutes: ruleFields.slotIntervalMinutes.optional(),
    validFrom: ruleFields.validFrom.optional(),
    validUntil: ruleFields.validUntil.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update")
  .refine(timesInOrder, { message: "endLocal must be after startLocal", path: ["endLocal"] })
  .refine(datesInOrder, { message: "validUntil must not be before validFrom", path: ["validUntil"] });
export type UpdateRuleBody = z.infer<typeof UpdateRuleBody>;

export const RulesQuery = z.object({ serviceId: z.uuid() });

export const MAX_RANGE_DAYS = 31;

export const AvailabilityQuery = z
  .object({
    serviceId: z.uuid(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .transform((v) => {
    const from = v.from ? new Date(v.from) : new Date();
    const to = v.to ? new Date(v.to) : new Date(from.getTime() + 7 * 86_400_000);
    return { serviceId: v.serviceId, from, to };
  })
  .refine((v) => v.to > v.from, { message: "to must be after from", path: ["to"] })
  .refine((v) => v.to.getTime() - v.from.getTime() <= MAX_RANGE_DAYS * 86_400_000, {
    message: `The range can cover at most ${MAX_RANGE_DAYS} days`,
    path: ["to"],
  });
export type AvailabilityQuery = z.infer<typeof AvailabilityQuery>;

export const CreatePeriodBody = z
  .strictObject({
    organizationId: z.uuid(),
    /** Omit to close the whole organization. */
    serviceId: z.uuid().nullable().default(null),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().max(200).default(""),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), { message: "endsAt must be after startsAt", path: ["endsAt"] })
  .refine((v) => new Date(v.endsAt).getTime() - new Date(v.startsAt).getTime() <= 366 * 86_400_000, {
    message: "A closure can last at most a year",
    path: ["endsAt"],
  });
export type CreatePeriodBody = z.infer<typeof CreatePeriodBody>;

export const PeriodsQuery = z.object({ organizationId: z.uuid() });
export const IdParams = z.object({ id: z.uuid() });
