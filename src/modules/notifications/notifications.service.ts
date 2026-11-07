import "server-only";
import { sql } from "drizzle-orm";

import type { Tx } from "@/db";
import { elevated, withActor, type Actor } from "@/db/with-actor";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/mail/mailer";
import type { BookingEvent, BookingStatus } from "@/modules/bookings/state-machine";
import { notificationsFor, type NotificationKind } from "./rules";
import { bookingMessage, type BookingMailData } from "./templates";

const SYSTEM: Actor = { userId: null, role: "system" };

/** Delivery attempts before a notification is marked failed (about 4 hours of retries). */
export const MAX_ATTEMPTS = 8;
/** How long a claimed row stays reserved; a worker that dies mid-send frees it after this. */
const LEASE_SECONDS = 120;

/** 30 s, 1 min, 2 min … capped at one hour. */
export const backoffSeconds = (attempts: number) => Math.min(30 * 2 ** Math.max(0, attempts - 1), 3_600);

interface Recipient {
  userId: string;
  email: string;
}

interface BookingFacts {
  data: BookingMailData;
  organizationId: string;
  customer: Recipient;
  owners: Recipient[];
}

/** Everything the emails show, read once in the system context (the caller may be a customer). */
async function bookingFacts(tx: Tx, bookingId: string, reason: string | null): Promise<BookingFacts | null> {
  const { rows } = await tx.execute<{
    reference: string;
    starts_at: Date;
    quantity: number;
    total_minor: number;
    currency: string;
    organization_id: string;
    service_name: string;
    listing_title: string;
    organization_name: string;
    timezone: string;
    customer_id: string;
    customer_name: string;
    customer_email: string;
    owners: { userId: string; email: string }[] | null;
  }>(sql`
    select b.reference, b.starts_at, b.quantity, b.total_minor, b.currency, b.organization_id,
           s.name as service_name, l.title as listing_title, o.name as organization_name, o.timezone,
           u.id as customer_id, u.name as customer_name, u.email as customer_email,
           (select json_agg(json_build_object('userId', ou.id, 'email', ou.email))
              from bookwise.organization_members m join bookwise.users ou on ou.id = m.user_id
             where m.organization_id = b.organization_id and m.role = 'owner' and ou.status = 'active') as owners
    from bookwise.bookings b
    join bookwise.services s on s.id = b.service_id
    join bookwise.listings l on l.id = s.listing_id
    join bookwise.organizations o on o.id = b.organization_id
    join bookwise.users u on u.id = b.customer_id
    where b.id = ${bookingId}`);
  const r = rows[0];
  if (!r) return null;
  return {
    organizationId: r.organization_id,
    customer: { userId: r.customer_id, email: r.customer_email },
    owners: r.owners ?? [],
    data: {
      reference: r.reference,
      serviceName: r.service_name,
      listingTitle: r.listing_title,
      organizationName: r.organization_name,
      timezone: r.timezone,
      startsAt: new Date(r.starts_at).toISOString(),
      quantity: Number(r.quantity),
      totalMinor: Number(r.total_minor),
      currency: r.currency,
      customerName: r.customer_name,
      reason,
      bookingUrl: new URL(`/bookings/${bookingId}`, env().APP_URL).toString(),
    },
  };
}

/** Insert-or-ignore on the unique dedupe key: queuing the same event twice is a no-op. */
async function insertNotification(tx: Tx, n: { kind: NotificationKind; bookingId: string; organizationId: string; to: Recipient; payload: BookingMailData }): Promise<boolean> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into bookwise.notifications (kind, dedupe_key, booking_id, organization_id, recipient_user_id, recipient_email, payload)
    values (${n.kind}, ${`${n.kind}:${n.bookingId}:${n.to.userId}`}, ${n.bookingId}, ${n.organizationId}, ${n.to.userId}, ${n.to.email}, ${JSON.stringify(n.payload)}::jsonb)
    on conflict (dedupe_key) do nothing
    returning id`);
  return rows.length > 0;
}

/**
 * Called inside the booking transition's transaction: the emails exist if and only if the
 * transition commits. Returns how many notifications were queued.
 */
export async function queueBookingNotifications(tx: Tx, bookingId: string, from: BookingStatus, to: BookingStatus, event: BookingEvent, reason: string | null): Promise<number> {
  const planned = notificationsFor(from, to, event);
  if (planned.length === 0) return 0;
  return elevated(tx, async () => {
    const facts = await bookingFacts(tx, bookingId, reason);
    if (!facts) return 0;
    let queued = 0;
    for (const p of planned) {
      const recipients = p.audience === "customer" ? [facts.customer] : facts.owners;
      for (const to of recipients) {
        if (await insertNotification(tx, { kind: p.kind, bookingId, organizationId: facts.organizationId, to, payload: facts.data })) queued++;
      }
    }
    return queued;
  });
}

/** Job: queue a reminder for confirmed bookings starting in the next 24 hours (once each). */
export async function queueReminders(now = new Date()): Promise<{ queued: number }> {
  return withActor(SYSTEM, async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(sql`
      select b.id from bookwise.bookings b
      where b.status = 'CONFIRMED'
        and b.starts_at > ${new Date(now.getTime() + 60 * 60_000)}
        and b.starts_at <= ${new Date(now.getTime() + 24 * 3_600_000)}
        and not exists (select 1 from bookwise.notifications n where n.booking_id = b.id and n.kind = 'booking-reminder')
      limit 500`);
    let queued = 0;
    for (const { id } of rows) {
      const facts = await bookingFacts(tx, id, null);
      if (facts && (await insertNotification(tx, { kind: "booking-reminder", bookingId: id, organizationId: facts.organizationId, to: facts.customer, payload: facts.data }))) queued++;
    }
    return { queued };
  });
}

type ClaimedRow = {
  id: string;
  kind: NotificationKind;
  booking_id: string | null;
  recipient_email: string;
  payload: BookingMailData;
  attempts: number;
};

/**
 * Claim due notifications for this worker. FOR UPDATE SKIP LOCKED lets several workers run
 * side by side without ever claiming the same row; rows left in `sending` by a worker that
 * crashed are reclaimed once their lease runs out.
 */
async function claim(limit: number): Promise<ClaimedRow[]> {
  return withActor(SYSTEM, async (tx) => {
    const { rows } = await tx.execute<ClaimedRow>(sql`
      update bookwise.notifications n
         set status = 'sending', attempts = n.attempts + 1, locked_until = now() + make_interval(secs => ${LEASE_SECONDS})
       where n.id in (
         select id from bookwise.notifications
          where (status = 'pending' and next_attempt_at <= now()) or (status = 'sending' and locked_until < now())
          order by created_at
          limit ${limit}
          for update skip locked)
      returning n.id, n.kind, n.booking_id, n.recipient_email, n.payload, n.attempts`);
    return rows;
  });
}

async function finish(id: string, outcome: { status: "sent" | "skipped" } | { status: "retry"; attempts: number; error: string }): Promise<void> {
  await withActor(SYSTEM, async (tx) => {
    if (outcome.status === "retry") {
      const failed = outcome.attempts >= MAX_ATTEMPTS;
      await tx.execute(sql`
        update bookwise.notifications
           set status = ${failed ? "failed" : "pending"}, locked_until = null, last_error = ${outcome.error.slice(0, 1000)},
               next_attempt_at = now() + make_interval(secs => ${backoffSeconds(outcome.attempts)})
         where id = ${id} and status = 'sending'`);
    } else {
      await tx.execute(sql`
        update bookwise.notifications set status = ${outcome.status}, locked_until = null, sent_at = now(), last_error = null
         where id = ${id} and status = 'sending'`);
    }
  });
}

/** A reminder for a booking that was cancelled or has started since is not sent. */
async function stillRelevant(row: ClaimedRow): Promise<boolean> {
  if (row.kind !== "booking-reminder" || !row.booking_id) return true;
  return withActor(SYSTEM, async (tx) => {
    const { rows } = await tx.execute<{ ok: boolean }>(sql`
      select status = 'CONFIRMED' and starts_at > now() as ok from bookwise.bookings where id = ${row.booking_id}`);
    return rows[0]?.ok === true;
  });
}

/**
 * Job (every few seconds): send due notifications. Safe to run concurrently and to repeat:
 * a row is claimed by one worker at a time, and its id is sent as the email provider's
 * idempotency key, so a send that succeeded just before a crash is not delivered twice.
 */
export async function dispatchNotifications(limit = 50): Promise<{ sent: number; retried: number; failed: number; skipped: number }> {
  const result = { sent: 0, retried: 0, failed: 0, skipped: 0 };
  for (const row of await claim(limit)) {
    if (!(await stillRelevant(row))) {
      await finish(row.id, { status: "skipped" });
      result.skipped++;
      continue;
    }
    try {
      await sendMail({ ...bookingMessage(row.kind, row.recipient_email, row.payload), idempotencyKey: row.id });
      await finish(row.id, { status: "sent" });
      result.sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ notificationId: row.id, kind: row.kind, attempts: row.attempts, err: message }, "notification not delivered; will retry");
      await finish(row.id, { status: "retry", attempts: row.attempts, error: message });
      if (row.attempts >= MAX_ATTEMPTS) result.failed++;
      else result.retried++;
    }
  }
  return result;
}
