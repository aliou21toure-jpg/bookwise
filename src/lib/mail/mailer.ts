import "server-only";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Machine-readable kind, for tests and logs (never the content). */
  kind: string;
  /**
   * Same key, same email: providers that support it (Resend) deliver a retried send once.
   * The notification outbox passes its row id.
   */
  idempotencyKey?: string;
}

/** In-process outbox used by the `memory` transport (tests read it). */
const outbox: MailMessage[] = [];

/** Tests can make the next sends fail, to exercise retries. */
let failNext = 0;
export function failNextSends(count: number): void {
  failNext = count;
}

export function readOutbox(): readonly MailMessage[] {
  return outbox;
}

export function clearOutbox(): void {
  outbox.length = 0;
}

function parseFrom(from: string): { Email: string; Name?: string } {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  return match ? { Name: match[1] || undefined, Email: match[2]! } : { Email: from.trim() };
}

/**
 * Send one transactional email. Delivery failures are logged and re-thrown so callers
 * (and, from Phase 8, the job queue) can retry. Logs never include the body, which can
 * carry single-use links.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  const config = env();
  const log = logger.child({ mail: message.kind });

  switch (config.MAIL_TRANSPORT) {
    case "memory":
      if (failNext > 0) {
        failNext--;
        throw new Error("simulated delivery failure");
      }
      outbox.push(message);
      return;
    case "resend": {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: config.MAIL_FROM,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          tags: [{ name: "kind", value: message.kind.replace(/[^A-Za-z0-9_-]/g, "_") }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        // The response body can echo the recipient; log the status only.
        log.error({ status: res.status }, "email delivery failed");
        throw new Error(`Resend returned ${res.status}`);
      }
      return;
    }
    case "log":
      log.info({ subject: message.subject }, "email not delivered (MAIL_TRANSPORT=log)");
      return;
    case "mailpit": {
      const res = await fetch(new URL("/api/v1/send", config.MAILPIT_URL), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          From: parseFrom(config.MAIL_FROM),
          To: [{ Email: message.to }],
          Subject: message.subject,
          Text: message.text,
          HTML: message.html,
          Tags: [message.kind],
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        log.error({ status: res.status }, "email delivery failed");
        throw new Error(`Mailpit returned ${res.status}`);
      }
      return;
    }
  }
}
