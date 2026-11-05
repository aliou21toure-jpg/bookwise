import "server-only";

import { withActor } from "@/db/with-actor";
import { AppError, notFound } from "@/lib/http/errors";
import { pageMeta } from "@/lib/http/pagination";
import type { PageMeta } from "@/lib/http/response";
import { recordAudit } from "@/modules/audit";
import type { RequestMeta } from "@/modules/audit/request-meta";
import type { AuthContext, AuthUser } from "@/modules/auth/session";
import { listOrganizationsForUser } from "@/modules/organizations/organizations.repository";
import * as repo from "./users.repository";
import type { AdminUserQuery, StatusChangeBody, UpdateMeBody } from "./users.schemas";

export interface MeDto {
  user: AuthUser;
  profile: repo.CustomerProfileRow;
  organizations: { id: string; name: string; slug: string; status: "active" | "suspended"; role: "owner" | "staff" }[];
}

export async function getMe(ctx: AuthContext): Promise<MeDto> {
  return withActor(ctx.actor, async (tx) => {
    const [profile, memberships] = [
      await repo.getOrCreateCustomerProfile(tx, ctx.user.id),
      await listOrganizationsForUser(tx, ctx.user.id),
    ];
    return {
      user: ctx.user,
      profile,
      organizations: memberships.map((m) => ({ id: m.id, name: m.name, slug: m.slug, status: m.status, role: m.memberRole })),
    };
  });
}

export async function updateMe(ctx: AuthContext, input: UpdateMeBody): Promise<MeDto> {
  await withActor(ctx.actor, async (tx) => {
    const { name, ...profile } = input;
    if (name !== undefined) await repo.updateUserName(tx, ctx.user.id, name);
    if (Object.keys(profile).length) await repo.updateCustomerProfile(tx, ctx.user.id, profile);
  });
  return getMe({ ...ctx, user: { ...ctx.user, ...(input.name !== undefined ? { name: input.name } : {}) } });
}

export async function listUsersAsAdmin(ctx: AuthContext, query: AdminUserQuery): Promise<{ rows: repo.UserRow[]; meta: PageMeta }> {
  return withActor(ctx.actor, async (tx) => {
    const { rows, total } = await repo.listUsers(tx, query);
    return { rows, meta: pageMeta(query, total) };
  });
}

/**
 * Suspend or reinstate an account. Suspension deletes every session in the same transaction,
 * so the user is signed out everywhere at once, and Better Auth's session hook refuses new
 * sign-ins while the status is `suspended`.
 */
export async function setUserStatusAsAdmin(
  ctx: AuthContext,
  targetId: string,
  input: StatusChangeBody,
  meta: RequestMeta,
): Promise<repo.UserRow & { sessionsRevoked: number }> {
  return withActor(ctx.actor, async (tx) => {
    const target = await repo.findUserById(tx, targetId);
    if (!target) throw notFound("User");
    if (target.id === ctx.user.id) throw new AppError("CONFLICT", "You cannot change the status of your own account.");
    if (target.role === "admin") throw new AppError("CONFLICT", "Administrator accounts are managed by an operator, not through the API.");

    let sessionsRevoked = 0;
    if (target.status !== input.status) {
      await repo.updateUserStatus(tx, targetId, input.status);
      if (input.status === "suspended") sessionsRevoked = await repo.deleteSessionsForUser(tx, targetId);
      await recordAudit(tx, ctx.actor, {
        action: input.status === "suspended" ? "user.suspended" : "user.reinstated",
        entityType: "user",
        entityId: targetId,
        before: { status: target.status },
        after: { status: input.status, sessionsRevoked },
        reason: input.reason,
        ...meta,
      });
    }
    return { ...target, status: input.status, sessionsRevoked };
  });
}

/**
 * Operator-only (scripts/admin-create.ts): grant the admin role to an existing account.
 * Runs as the `system` context, the only one the database lets create administrators.
 */
export async function grantAdminRole(email: string, operator: string): Promise<repo.UserRow> {
  return withActor({ userId: null, role: "system" }, async (tx) => {
    const user = await repo.findUserByEmail(tx, email);
    if (!user) throw notFound("User");
    if (!user.emailVerified) throw new AppError("EMAIL_NOT_VERIFIED", "The account must confirm its email before becoming an administrator.");
    if (user.role !== "admin") {
      await repo.updateUserRole(tx, user.id, "admin");
      await recordAudit(tx, { userId: null, role: "system" }, {
        action: "user.admin_granted",
        entityType: "user",
        entityId: user.id,
        before: { role: user.role },
        after: { role: "admin" },
        reason: `admin:create run by ${operator}`,
      });
    }
    return { ...user, role: "admin" };
  });
}
