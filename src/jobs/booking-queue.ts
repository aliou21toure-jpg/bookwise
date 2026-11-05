import "server-only";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { env } from "@/lib/env";
import { BOOKING_JOBS, QUEUES } from "./queues";

const globalForQueue = globalThis as unknown as { bookwiseBookingsQueue?: Queue };

export function bookingsQueue(): Queue {
  globalForQueue.bookwiseBookingsQueue ??= new Queue(QUEUES.bookings, {
    connection: new Redis(env().REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 2_000 }),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
  });
  return globalForQueue.bookwiseBookingsQueue;
}

/**
 * The job id is the business key, so enqueueing twice for the same hold is a no-op. The
 * handler re-reads the hold, so a job that runs late or twice changes nothing.
 */
export async function enqueueHoldExpiry(holdId: string, at: Date): Promise<void> {
  await bookingsQueue().add(
    BOOKING_JOBS.expireHold,
    { holdId },
    { jobId: `expire-${holdId}`, delay: Math.max(0, at.getTime() - Date.now()) + 1_000 },
  );
}
