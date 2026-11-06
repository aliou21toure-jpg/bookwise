/**
 * Background worker entry point (a separate long-running process; see ADR-005).
 * Runs hold expiry, the minute-by-minute sweeper and the daily capacity check. Every
 * handler is idempotent: it re-reads the database and does nothing if work is already done.
 */
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";

import { logger } from "@/lib/logger";
import { capacityDrift, expireHold, sweep } from "@/modules/bookings";
import { reconcilePayments } from "@/modules/payments";
import { BOOKING_JOBS, QUEUES } from "./queues";

const log = logger;

async function main(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");

  // BullMQ workers need blocking commands, so retries must be unlimited on this connection.
  const connection = new Redis(url, { maxRetriesPerRequest: null });

  const workers = [
    new Worker(
      QUEUES.system,
      async (job) => {
        if (job.name === "ping") return { pong: true, at: new Date().toISOString() };
        throw new Error(`Unknown job ${job.name}`);
      },
      { connection, concurrency: 1 },
    ),
    new Worker(
      QUEUES.bookings,
      async (job) => {
        switch (job.name) {
          case BOOKING_JOBS.expireHold:
            return { expired: await expireHold(String(job.data.holdId)) };
          case BOOKING_JOBS.sweep:
            return sweep();
          case BOOKING_JOBS.reconcilePayments:
            return reconcilePayments();
          case BOOKING_JOBS.consistency: {
            const drift = await capacityDrift();
            if (drift.length) log.error({ drift }, "slot capacity drift detected");
            return { driftedSlots: drift.length };
          }
          default:
            throw new Error(`Unknown job ${job.name}`);
        }
      },
      { connection, concurrency: 5 },
    ),
  ];

  // Repeatable safety nets. upsertJobScheduler is idempotent across restarts and replicas.
  const scheduler = new Queue(QUEUES.bookings, { connection });
  await scheduler.upsertJobScheduler("bookings-sweep", { every: 60_000 }, { name: BOOKING_JOBS.sweep });
  await scheduler.upsertJobScheduler("payments-reconcile", { every: 15 * 60_000 }, { name: BOOKING_JOBS.reconcilePayments });
  await scheduler.upsertJobScheduler("bookings-consistency", { pattern: "17 3 * * *" }, { name: BOOKING_JOBS.consistency });

  for (const w of workers) {
    w.on("failed", (job, err) => log.error({ queue: w.name, jobId: job?.id, err }, "job failed"));
  }
  log.info({ queues: workers.map((w) => w.name) }, "worker ready");

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down: finishing in-flight jobs");
    await Promise.all(workers.map((w) => w.close()));
    await scheduler.close();
    await connection.quit();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  log.fatal({ err }, "worker failed to start");
  process.exit(1);
});
