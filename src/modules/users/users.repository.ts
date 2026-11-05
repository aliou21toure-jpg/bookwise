import "server-only";
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import type { Tx } from "@/db";
import { customerProfiles, sessions, users } from "@/db/schema";
import { pageOffset } from "@/lib/http/pagination";
import type { AdminUserQuery } from "./users.schemas";

const userColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  status: users.status,
  emailVerified: users.emailVerified,
  createdAt: users.createdAt,
};

export type UserRow = { [K in keyof typeof userColumns]: (typeof userColumns)[K]["_"]["data"] };

export async function findUserById(tx: Tx, id: string): Promise<UserRow | undefined> {
  const [row] = await tx.select(userColumns).from(users).where(eq(users.id, id));
  return row;
}

export async function findUserByEmail(tx: Tx, email: string): Promise<UserRow | undefined> {
  const [row] = await tx
    .select(userColumns)
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`);
  return row;
}

/** Escape LIKE wildcards so a search for "a_b" does not match "axb". */
const likeEscape = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listUsers(tx: Tx, query: AdminUserQuery): Promise<{ rows: UserRow[]; total: number }> {
  const filters: SQL[] = [];
  if (query.q) {
    const pattern = `%${likeEscape(query.q)}%`;
    filters.push(or(ilike(users.email, pattern), ilike(users.name, pattern))!);
  }
  if (query.role) filters.push(eq(users.role, query.role));
  if (query.status) filters.push(eq(users.status, query.status));
  const where = filters.length ? and(...filters) : undefined;

  const order =
    query.sort === "email" ? [asc(users.email)] : query.sort === "createdAt" ? [asc(users.createdAt), asc(users.id)] : [desc(users.createdAt), desc(users.id)];

  const [rows, [totals]] = await Promise.all([
    tx.select(userColumns).from(users).where(where).orderBy(...order).limit(query.pageSize).offset(pageOffset(query)),
    tx.select({ total: count() }).from(users).where(where),
  ]);
  return { rows, total: totals?.total ?? 0 };
}

export async function updateUserStatus(tx: Tx, id: string, status: "active" | "suspended"): Promise<void> {
  await tx.update(users).set({ status }).where(eq(users.id, id));
}

export async function updateUserRole(tx: Tx, id: string, role: "customer" | "provider" | "admin"): Promise<void> {
  await tx.update(users).set({ role }).where(eq(users.id, id));
}

export async function updateUserName(tx: Tx, id: string, name: string): Promise<void> {
  await tx.update(users).set({ name }).where(eq(users.id, id));
}

/** Deletes every session of a user: they are signed out on all devices immediately. */
export async function deleteSessionsForUser(tx: Tx, userId: string): Promise<number> {
  const deleted = await tx.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id });
  return deleted.length;
}

const profileColumns = {
  phone: customerProfiles.phone,
  locale: customerProfiles.locale,
  marketingOptIn: customerProfiles.marketingOptIn,
};

export type CustomerProfileRow = { phone: string | null; locale: string; marketingOptIn: boolean };

/** Profiles are created lazily, so sign-up through any Better Auth endpoint is covered. */
export async function getOrCreateCustomerProfile(tx: Tx, userId: string): Promise<CustomerProfileRow> {
  await tx.insert(customerProfiles).values({ userId }).onConflictDoNothing();
  const [row] = await tx.select(profileColumns).from(customerProfiles).where(eq(customerProfiles.userId, userId));
  return row!;
}

export async function updateCustomerProfile(
  tx: Tx,
  userId: string,
  patch: Partial<CustomerProfileRow>,
): Promise<CustomerProfileRow> {
  await tx.insert(customerProfiles).values({ userId }).onConflictDoNothing();
  const [row] = await tx
    .update(customerProfiles)
    .set(patch)
    .where(eq(customerProfiles.userId, userId))
    .returning(profileColumns);
  return row!;
}
