import "server-only";

import type { Tx } from "@/db";
import { withActor } from "@/db/with-actor";
import { AppError, notFound } from "@/lib/http/errors";
import { recordAudit } from "@/modules/audit";
import type { RequestMeta } from "@/modules/audit/request-meta";
import type { AuthContext } from "@/modules/auth/session";
import { findListing, findService, type ServiceRow } from "@/modules/listings/listings.repository";
import { ANONYMOUS, requireCatalogueAccess } from "@/modules/listings/listings.service";
import { findOrganization } from "@/modules/organizations/organizations.repository";
import * as repo from "./availability.repository";
import type { AvailabilityQuery, CreatePeriodBody, CreateRuleBody, UpdateRuleBody } from "./availability.schemas";
import { generateSlots } from "./slots";
import { formatLocalDate, toLocalMs } from "./time-zone";

async function serviceForManage(tx: Tx, ctx: AuthContext, serviceId: string, action: "manage.read" | "manage.write"): Promise<ServiceRow & { timezone: string }> {
  const service = await findService(tx, serviceId);
  if (!service) throw notFound("Service");
  try {
    const org = await requireCatalogueAccess(tx, ctx, service.organizationId, action);
    return { ...service, timezone: org.timezone };
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") throw notFound("Service");
    throw err;
  }
}

const toRuleDto = (r: repo.RuleRow) => ({
  id: r.id,
  serviceId: r.serviceId,
  weekday: r.weekday,
  startLocal: r.startLocal.slice(0, 5),
  endLocal: r.endLocal.slice(0, 5),
  slotIntervalMinutes: r.slotIntervalMinutes,
  validFrom: r.validFrom,
  validUntil: r.validUntil,
});
export type RuleDto = ReturnType<typeof toRuleDto>;

export async function listRules(ctx: AuthContext, serviceId: string): Promise<RuleDto[]> {
  return withActor(ctx.actor, async (tx) => {
    await serviceForManage(tx, ctx, serviceId, "manage.read");
    return (await repo.listRules(tx, serviceId)).map(toRuleDto);
  });
}

export async function createRule(ctx: AuthContext, input: CreateRuleBody, meta: RequestMeta): Promise<RuleDto> {
  return withActor(ctx.actor, async (tx) => {
    const service = await serviceForManage(tx, ctx, input.serviceId, "manage.write");
    if (service.archivedAt) throw new AppError("INVALID_TRANSITION", "Archived services cannot get opening hours.");
    const interval = input.slotIntervalMinutes ?? service.durationMinutes;
    const rule = await repo.insertRule(tx, {
      organizationId: service.organizationId,
      serviceId: service.id,
      weekday: input.weekday,
      startLocal: input.startLocal,
      endLocal: input.endLocal,
      slotIntervalMinutes: interval,
      validFrom: input.validFrom ?? formatLocalDate(toLocalMs(Date.now(), service.timezone)),
      validUntil: input.validUntil,
    });
    await recordAudit(tx, ctx.actor, { action: "availability.rule_created", entityType: "availability_rule", entityId: rule.id, organizationId: service.organizationId, after: toRuleDto(rule), ...meta });
    return toRuleDto(rule);
  });
}

async function ruleForWrite(tx: Tx, ctx: AuthContext, id: string) {
  const rule = await repo.findRule(tx, id);
  if (!rule) throw notFound("Availability rule");
  try {
    await requireCatalogueAccess(tx, ctx, rule.organizationId, "manage.write");
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") throw notFound("Availability rule");
    throw err;
  }
  return rule;
}

export async function updateRule(ctx: AuthContext, id: string, input: UpdateRuleBody, meta: RequestMeta): Promise<RuleDto> {
  return withActor(ctx.actor, async (tx) => {
    const before = await ruleForWrite(tx, ctx, id);
    const start = input.startLocal ?? before.startLocal.slice(0, 5);
    const end = input.endLocal ?? before.endLocal.slice(0, 5);
    if (end <= start) throw new AppError("VALIDATION_FAILED", "endLocal must be after startLocal", [{ path: "endLocal", message: "Must be after startLocal" }]);
    const rule = await repo.updateRule(tx, id, input);
    await recordAudit(tx, ctx.actor, { action: "availability.rule_updated", entityType: "availability_rule", entityId: id, organizationId: rule.organizationId, before: toRuleDto(before), after: toRuleDto(rule), ...meta });
    return toRuleDto(rule);
  });
}

export async function deleteRule(ctx: AuthContext, id: string, meta: RequestMeta): Promise<void> {
  await withActor(ctx.actor, async (tx) => {
    const rule = await ruleForWrite(tx, ctx, id);
    await repo.deleteRule(tx, id);
    await recordAudit(tx, ctx.actor, { action: "availability.rule_deleted", entityType: "availability_rule", entityId: id, organizationId: rule.organizationId, before: toRuleDto(rule), ...meta });
  });
}

// ---------------------------------------------------------------------------------------
// Closures
// ---------------------------------------------------------------------------------------

const toPeriodDto = (p: repo.PeriodRow) => ({ id: p.id, organizationId: p.organizationId, serviceId: p.serviceId, startsAt: p.startsAt, endsAt: p.endsAt, reason: p.reason });
export type PeriodDto = ReturnType<typeof toPeriodDto>;

export async function createPeriod(ctx: AuthContext, input: CreatePeriodBody, meta: RequestMeta): Promise<PeriodDto> {
  return withActor(ctx.actor, async (tx) => {
    await requireCatalogueAccess(tx, ctx, input.organizationId, "manage.write");
    if (input.serviceId) {
      const service = await findService(tx, input.serviceId);
      // The composite foreign key would also refuse another organization's service.
      if (!service || service.organizationId !== input.organizationId) throw notFound("Service");
    }
    const period = await repo.insertPeriod(tx, {
      organizationId: input.organizationId,
      serviceId: input.serviceId,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      reason: input.reason,
    });
    await recordAudit(tx, ctx.actor, { action: "availability.closure_created", entityType: "unavailable_period", entityId: period.id, organizationId: period.organizationId, ...meta });
    return toPeriodDto(period);
  });
}

export async function listPeriods(ctx: AuthContext, organizationId: string): Promise<PeriodDto[]> {
  return withActor(ctx.actor, async (tx) => {
    await requireCatalogueAccess(tx, ctx, organizationId, "manage.read");
    return (await repo.listPeriods(tx, organizationId)).map(toPeriodDto);
  });
}

export async function deletePeriod(ctx: AuthContext, id: string, meta: RequestMeta): Promise<void> {
  await withActor(ctx.actor, async (tx) => {
    const period = await repo.findPeriod(tx, id);
    if (!period) throw notFound("Closure");
    try {
      await requireCatalogueAccess(tx, ctx, period.organizationId, "manage.write");
    } catch (err) {
      if (err instanceof AppError && err.code === "NOT_FOUND") throw notFound("Closure");
      throw err;
    }
    await repo.deletePeriod(tx, id);
    await recordAudit(tx, ctx.actor, { action: "availability.closure_deleted", entityType: "unavailable_period", entityId: id, organizationId: period.organizationId, ...meta });
  });
}

// ---------------------------------------------------------------------------------------
// Public availability
// ---------------------------------------------------------------------------------------

export interface AvailabilityDto {
  serviceId: string;
  timeZone: string;
  from: Date;
  to: Date;
  slots: { startsAt: Date; endsAt: Date; localStart: string; remaining: number; capacity: number }[];
}

/**
 * Bookable slots for a service between `from` and `to`. Anyone may ask about a published
 * service; members may also ask about their drafts. Everything else is 404.
 */
export async function getAvailability(ctx: AuthContext | null, query: AvailabilityQuery, now = new Date()): Promise<AvailabilityDto> {
  return withActor(ctx?.actor ?? ANONYMOUS, async (tx) => {
    const service = await findService(tx, query.serviceId);
    if (!service || service.archivedAt) throw notFound("Service");
    const [listing, org] = [await findListing(tx, service.listingId), await findOrganization(tx, service.organizationId)];
    if (!listing || listing.archivedAt || !org) throw notFound("Service");

    const [rules, blocked, materialized] = [
      await repo.listRules(tx, service.id),
      await repo.blockedRanges(tx, service.id, query.from, query.to),
      await repo.materializedSlots(tx, service.id, query.from, query.to),
    ];
    const slots = generateSlots({
      timeZone: org.timezone,
      durationMinutes: service.durationMinutes,
      capacity: service.capacity,
      rules,
      blocked,
      materialized,
      from: query.from,
      to: query.to,
      now,
    });
    return {
      serviceId: service.id,
      timeZone: org.timezone,
      from: query.from,
      to: query.to,
      slots: slots.map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt, localStart: s.localStart, remaining: s.remaining, capacity: s.capacity })),
    };
  });
}
