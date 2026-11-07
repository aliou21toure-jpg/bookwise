import "server-only";
import { sql } from "drizzle-orm";

import { getDb, type Tx } from "./index";

/** `anonymous` is a visitor without a session; it sees only public rows. */
export type ActorRole = "anonymous" | "customer" | "provider" | "admin" | "system";

export interface Actor {
  userId: string | null;
  role: ActorRole;
}

/**
 * Run `fn` in a transaction whose row-level-security context identifies the actor.
 *
 * `set_config(name, value, true)` is transaction-local (the same as SET LOCAL): it is
 * discarded at COMMIT or ROLLBACK, so a pooled connection can never carry one user's
 * identity into another request. Policies read it with current_setting('app.user_id', true).
 */
export function withActor<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    // jit=off: request queries are short, and JIT compilation of row-level-security filters
    // cost more than the queries themselves (docs/performance.md). Transaction-local too.
    await tx.execute(sql`
      select set_config('app.user_id', ${actor.userId ?? ""}, true),
             set_config('app.role', ${actor.role}, true),
             set_config('jit', 'off', true)`);
    return fn(tx);
  });
}

/**
 * Run `fn` inside the current transaction with the trusted `system` context, then restore
 * the caller's role. Used for the few operations that touch rows the caller does not own:
 * slot capacity, and releasing other customers' expired holds under the slot lock.
 * Keep the elevated section as small as possible.
 */
export async function elevated<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  const { rows } = await tx.execute<{ role: string | null }>(sql`select current_setting('app.role', true) as role`);
  const previous = rows[0]?.role ?? "";
  await tx.execute(sql`select set_config('app.role', 'system', true)`);
  try {
    return await fn();
  } finally {
    await tx.execute(sql`select set_config('app.role', ${previous}, true)`);
  }
}
