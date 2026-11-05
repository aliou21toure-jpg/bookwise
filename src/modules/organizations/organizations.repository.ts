import "server-only";
import { and, asc, eq } from "drizzle-orm";

import type { Tx } from "@/db";
import { organizationMembers, organizations, providerProfiles, users } from "@/db/schema";
import type { ProviderProfileInput } from "./organizations.schemas";

/*
 * Every query runs inside withActor(), so row-level security applies on top of the explicit
 * filters below. A row the actor may not see simply does not come back.
 */

const orgColumns = {
  id: organizations.id,
  name: organizations.name,
  slug: organizations.slug,
  timezone: organizations.timezone,
  defaultCurrency: organizations.defaultCurrency,
  status: organizations.status,
  createdAt: organizations.createdAt,
};

export type OrganizationRow = { [K in keyof typeof orgColumns]: (typeof orgColumns)[K]["_"]["data"] };

const profileColumns = {
  description: providerProfiles.description,
  phone: providerProfiles.phone,
  address: providerProfiles.address,
  city: providerProfiles.city,
  country: providerProfiles.country,
};

export interface ProviderProfileRow {
  description: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
}

export async function insertOrganization(
  tx: Tx,
  values: { name: string; slug: string; timezone: string; defaultCurrency: string; createdBy: string },
): Promise<OrganizationRow> {
  const [row] = await tx.insert(organizations).values(values).returning(orgColumns);
  return row!;
}

export async function findOrganization(tx: Tx, id: string): Promise<OrganizationRow | undefined> {
  const [row] = await tx.select(orgColumns).from(organizations).where(eq(organizations.id, id));
  return row;
}

export async function updateOrganization(
  tx: Tx,
  id: string,
  patch: Partial<Pick<OrganizationRow, "name" | "timezone" | "defaultCurrency">>,
): Promise<OrganizationRow | undefined> {
  const [row] = await tx.update(organizations).set(patch).where(eq(organizations.id, id)).returning(orgColumns);
  return row;
}

export async function setOrganizationStatus(tx: Tx, id: string, status: "active" | "suspended"): Promise<void> {
  await tx.update(organizations).set({ status }).where(eq(organizations.id, id));
}

export async function findMembership(tx: Tx, organizationId: string, userId: string): Promise<"owner" | "staff" | null> {
  const [row] = await tx
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)));
  return row?.role ?? null;
}

export async function insertMember(tx: Tx, organizationId: string, userId: string, role: "owner" | "staff"): Promise<void> {
  await tx.insert(organizationMembers).values({ organizationId, userId, role });
}

export async function deleteMember(tx: Tx, organizationId: string, userId: string): Promise<boolean> {
  const deleted = await tx
    .delete(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)))
    .returning({ userId: organizationMembers.userId });
  return deleted.length > 0;
}

export async function countOwners(tx: Tx, organizationId: string): Promise<number> {
  const rows = await tx
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.role, "owner")));
  return rows.length;
}

export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  role: "owner" | "staff";
  joinedAt: Date;
}

export async function listMembers(tx: Tx, organizationId: string): Promise<MemberRow[]> {
  return tx
    .select({
      userId: organizationMembers.userId,
      name: users.name,
      email: users.email,
      role: organizationMembers.role,
      joinedAt: organizationMembers.createdAt,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, organizationId))
    .orderBy(asc(organizationMembers.createdAt));
}

export interface MembershipRow extends OrganizationRow {
  memberRole: "owner" | "staff";
}

export async function listOrganizationsForUser(tx: Tx, userId: string): Promise<MembershipRow[]> {
  return tx
    .select({ ...orgColumns, memberRole: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, userId))
    .orderBy(asc(organizations.name));
}

export async function insertProviderProfile(tx: Tx, organizationId: string, profile: ProviderProfileInput = {}): Promise<void> {
  await tx.insert(providerProfiles).values({ organizationId, ...profile });
}

export async function updateProviderProfile(tx: Tx, organizationId: string, patch: ProviderProfileInput): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await tx.update(providerProfiles).set(patch).where(eq(providerProfiles.organizationId, organizationId));
}

export async function findProviderProfile(tx: Tx, organizationId: string): Promise<ProviderProfileRow | null> {
  const [row] = await tx.select(profileColumns).from(providerProfiles).where(eq(providerProfiles.organizationId, organizationId));
  return row ?? null;
}
