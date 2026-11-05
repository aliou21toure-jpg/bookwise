import { sql } from "drizzle-orm";
import { bigint, index, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { bookwise } from "./_schema";

/**
 * Append-only audit trail. No foreign keys on purpose: deleting a user or an organization
 * must never rewrite or remove history (a cascading SET NULL would be an UPDATE, which the
 * append-only trigger rejects). The app role has INSERT and SELECT only.
 */
export const auditLogs = bookwise.table(
  "audit_logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    actorUserId: uuid("actor_user_id"),
    actorRole: text("actor_role").notNull(),
    organizationId: uuid("organization_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    ipAddress: text("ip_address"),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_organization_created_idx").on(t.organizationId, sql`${t.createdAt} desc`),
    index("audit_logs_actor_created_idx").on(t.actorUserId, sql`${t.createdAt} desc`),
  ],
);
