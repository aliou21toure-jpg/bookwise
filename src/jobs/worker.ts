/**
 * Background worker entry point (a separate long-running process; see ADR-005).
 * Phase 2 starts the process, connects to Redis and shuts down cleanly. Queues for hold
 * expiry, emails, reminders and reconciliation are registered in later phases.
 */
import { Worker } from "bullmq";
import { Redis } from "ioredis";

import { logger } from "@/lib/logger";
import { QUEUES } from "./queues";

// BOOKWISE_SERVICE=worker is set by the start script and Docker image.
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
  ];

  for (const w of workers) {
    w.on("failed", (job, err) => log.error({ queue: w.name, jobId: job?.id, err }, "job failed"));
  }
  log.info({ queues: workers.map((w) => w.name) }, "worker ready");

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down: finishing in-flight jobs");
    await Promise.all(workers.map((w) => w.close()));
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
