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
    await tx.execute(sql`
      select set_config('app.user_id', ${actor.userId ?? ""}, true),
             set_config('app.role', ${actor.role}, true)`);
    return fn(tx);
  });
}
