import "server-only";
import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { getRedis } from "@/lib/redis";
import { checkHealth, type HealthReport } from "./health";

export async function getHealthReport(): Promise<HealthReport> {
  return checkHealth({
    pingDatabase: async () => {
      await getDb().execute(sql`select 1`);
    },
    pingRedis: async () => {
      const redis = getRedis();
      if (redis.status === "wait") await redis.connect();
      await redis.ping();
    },
  });
}
