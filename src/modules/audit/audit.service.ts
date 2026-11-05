import "server-only";

import type { Tx } from "@/db";
import { auditLogs } from "@/db/schema";
import type { Actor } from "@/db/with-actor";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  organizationId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
  requestId?: string | null;
}

/**
 * Append one audit entry inside the caller's transaction, so the entry exists if and only
 * if the change it describes was committed. Never pass passwords, tokens or full request
 * bodies in `before`/`after`.
 */
export async function recordAudit(tx: Tx, actor: Actor, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({
    actorUserId: actor.userId,
    actorRole: actor.role,
    organizationId: entry.organizationId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
    ipAddress: entry.ipAddress ?? null,
    requestId: entry.requestId ?? null,
  });
}
