import "server-only";
import { Redis, type RedisOptions } from "ioredis";

import { env } from "@/lib/env";

const globalForRedis = globalThis as unknown as { bookwiseRedis?: Redis };

/**
 * Shared connection for rate limiting and enqueueing jobs from the web app.
 * Commands fail fast instead of queueing while Redis is down: Redis is never on the
 * critical path of a booking (PostgreSQL is the source of truth).
 */
export function getRedis(options: RedisOptions = {}): Redis {
  globalForRedis.bookwiseRedis ??= new Redis(env().REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
    ...options,
  });
  return globalForRedis.bookwiseRedis;
}
