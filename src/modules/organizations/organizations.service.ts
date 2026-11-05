import "server-only";
import { randomBytes } from "node:crypto";

import type { Tx } from "@/db";
import { withActor, type Actor } from "@/db/with-actor";
import { AppError, notFound } from "@/lib/http/errors";
import { pgErrorCode } from "@/lib/http/handler";
import { recordAudit } from "@/modules/audit";
import type { AuthContext } from "@/modules/auth/session";
import type { RequestMeta } from "@/modules/audit/request-meta";
import { findUserByEmail, findUserById, updateUserRole } from "@/modules/users/users.repository";
import { decideOrgAccess, type OrgAction } from "./organizations.policies";
import * as repo from "./organizations.repository";
import {
  slugify,
  type AddMemberBody,
  type CreateOrganizationBody,
  type UpdateOrganizationBody,
} from "./organizations.schemas";

export interface OrganizationDto extends repo.OrganizationRow {
  profile: repo.ProviderProfileRow | null;
  /** The caller's role in the organization; null for administrators who are not members. */
  memberRole: "owner" | "staff" | null;
}

async function insertWithUniqueSlug(tx: Tx, input: CreateOrganizationBody, createdBy: string): Promise<repo.OrganizationRow> {
  const base = input.slug ?? slugify(input.name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base.slice(0, 54)}-${randomBytes(3).toString("hex")}`;
    try {
      // A savepoint, so a duplicate slug does not abort the surrounding transaction.
      return await tx.transaction((sp) =>
        repo.insertOrganization(sp, {
          name: input.name,
          slug,
          timezone: input.timezone,
          defaultCurrency: input.defaultCurrency,
          createdBy,
        }),
      );
    } catch (err) {
      if (pgErrorCode(err) !== "23505") throw err;
      if (input.slug) throw new AppError("CONFLICT", "That organization URL is already taken.");
    }
  }
  throw new AppError("CONFLICT", "Could not find a free organization URL. Try another name.");
}

/**
 * Creates an organization with the caller as its owner, in one transaction: organization,
 * owner membership, provider profile, the user's provider role, and the audit entry.
 * `actor` must identify the creator (a signed-in user, or a user registered moments ago).
 */
export async function createOrganization(actor: Actor & { userId: string }, input: CreateOrganizationBody, meta: RequestMeta): Promise<OrganizationDto> {
  return withActor(actor, async (tx) => {
    const org = await insertWithUniqueSlug(tx, input, actor.userId);
    await repo.insertMember(tx, org.id, actor.userId, "owner");
    await repo.insertProviderProfile(tx, org.id, input.profile);

    const user = await findUserById(tx, actor.userId);
    if (user?.role === "customer") await updateUserRole(tx, actor.userId, "provider");

    await recordAudit(tx, actor, {
      action: "organization.created",
      entityType: "organization",
      entityId: org.id,
      organizationId: org.id,
      after: { name: org.name, slug: org.slug, timezone: org.timezone, defaultCurrency: org.defaultCurrency },
      ...meta,
    });
    return { ...org, profile: await repo.findProviderProfile(tx, org.id), memberRole: "owner" };
  });
}

/** Loads the organization and applies the access policy; throws 404/403 as decided. */
async function authorize(tx: Tx, ctx: AuthContext, orgId: string, action: OrgAction) {
  const org = await repo.findOrganization(tx, orgId);
  if (!org) throw notFound("Organization");
  const memberRole = await repo.findMembership(tx, orgId, ctx.user.id);
  const decision = decideOrgAccess(action, { userRole: ctx.user.role, memberRole, orgStatus: org.status });
  switch (decision) {
    case "allow":
      return { org, memberRole };
    case "not_found":
      throw notFound("Organization");
    case "suspended":
      throw new AppError("ORGANIZATION_SUSPENDED", "This organization is suspended. Contact support.");
    case "forbidden":
      throw new AppError("FORBIDDEN", "Only an owner of this organization can do that.");
  }
}

export async function listMyOrganizations(ctx: AuthContext): Promise<repo.MembershipRow[]> {
  return withActor(ctx.actor, (tx) => repo.listOrganizationsForUser(tx, ctx.user.id));
}

export async function getOrganization(ctx: AuthContext, orgId: string): Promise<OrganizationDto> {
  return withActor(ctx.actor, async (tx) => {
    const { org, memberRole } = await authorize(tx, ctx, orgId, "org.read");
    return { ...org, profile: await repo.findProviderProfile(tx, orgId), memberRole };
  });
}

export async function updateOrganization(
  ctx: AuthContext,
  orgId: string,
  input: UpdateOrganizationBody,
  meta: RequestMeta,
): Promise<OrganizationDto> {
  return withActor(ctx.actor, async (tx) => {
    const { org: before, memberRole } = await authorize(tx, ctx, orgId, "org.update");
    const { profile, ...fields } = input;
    const updated = Object.keys(fields).length ? await repo.updateOrganization(tx, orgId, fields) : before;
    if (profile) await repo.updateProviderProfile(tx, orgId, profile);
    await recordAudit(tx, ctx.actor, {
      action: "organization.updated",
      entityType: "organization",
      entityId: orgId,
      organizationId: orgId,
      before: { name: before.name, timezone: before.timezone, defaultCurrency: before.defaultCurrency },
      after: { ...fields, ...(profile ? { profile } : {}) },
      ...meta,
    });
    return { ...updated!, profile: await repo.findProviderProfile(tx, orgId), memberRole };
  });
}

export async function listMembers(ctx: AuthContext, orgId: string): Promise<repo.MemberRow[]> {
  return withActor(ctx.actor, async (tx) => {
    await authorize(tx, ctx, orgId, "members.read");
    return repo.listMembers(tx, orgId);
  });
}

export async function addMember(ctx: AuthContext, orgId: string, input: AddMemberBody, meta: RequestMeta): Promise<repo.MemberRow> {
  return withActor(ctx.actor, async (tx) => {
    await authorize(tx, ctx, orgId, "members.manage");
    const user = await findUserByEmail(tx, input.email);
    if (!user || user.status !== "active") {
      throw notFound("Active account with that email");
    }
    if (await repo.findMembership(tx, orgId, user.id)) {
      throw new AppError("CONFLICT", "That person is already a member of this organization.");
    }
    await repo.insertMember(tx, orgId, user.id, input.role);
    if (user.role === "customer") await updateUserRole(tx, user.id, "provider");
    await recordAudit(tx, ctx.actor, {
      action: "organization.member_added",
      entityType: "organization_member",
      entityId: user.id,
      organizationId: orgId,
      after: { userId: user.id, role: input.role },
      ...meta,
    });
    const members = await repo.listMembers(tx, orgId);
    return members.find((m) => m.userId === user.id)!;
  });
}

export async function removeMember(ctx: AuthContext, orgId: string, userId: string, meta: RequestMeta): Promise<void> {
  return withActor(ctx.actor, async (tx) => {
    await authorize(tx, ctx, orgId, "members.manage");
    const role = await repo.findMembership(tx, orgId, userId);
    if (!role) throw notFound("Member");
    if (role === "owner" && (await repo.countOwners(tx, orgId)) <= 1) {
      throw new AppError("LAST_OWNER", "An organization must keep at least one owner. Add another owner first.");
    }
    await repo.deleteMember(tx, orgId, userId);
    await recordAudit(tx, ctx.actor, {
      action: "organization.member_removed",
      entityType: "organization_member",
      entityId: userId,
      organizationId: orgId,
      before: { userId, role },
      ...meta,
    });
  });
}

/** Admin only (checked by the route and by RLS): suspend or reinstate an organization. */
export async function setOrganizationStatusAsAdmin(
  ctx: AuthContext,
  orgId: string,
  input: { status: "active" | "suspended"; reason: string },
  meta: RequestMeta,
): Promise<repo.OrganizationRow> {
  return withActor(ctx.actor, async (tx) => {
    const org = await repo.findOrganization(tx, orgId);
    if (!org) throw notFound("Organization");
    if (org.status !== input.status) {
      await repo.setOrganizationStatus(tx, orgId, input.status);
      await recordAudit(tx, ctx.actor, {
        action: input.status === "suspended" ? "organization.suspended" : "organization.reinstated",
        entityType: "organization",
        entityId: orgId,
        organizationId: orgId,
        before: { status: org.status },
        after: { status: input.status },
        reason: input.reason,
        ...meta,
      });
    }
    return { ...org, status: input.status };
  });
}
