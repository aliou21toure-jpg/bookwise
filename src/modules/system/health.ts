export type CheckStatus = "up" | "down";

export interface CheckResult {
  status: CheckStatus;
  latencyMs: number;
}

export interface HealthReport {
  status: "ok" | "degraded" | "down";
  checks: { database: CheckResult; redis: CheckResult };
}

export interface HealthDependencies {
  pingDatabase: () => Promise<void>;
  pingRedis: () => Promise<void>;
  timeoutMs?: number;
}

async function timed(fn: () => Promise<void>, timeoutMs: number): Promise<CheckResult> {
  const started = performance.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    return { status: "up", latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { status: "down", latencyMs: Math.round(performance.now() - started) };
  }
}

/**
 * The database is required: without it nothing works, so the app reports "down".
 * Redis only delays background work, so the app is "degraded" but still serves requests.
 */
export async function checkHealth(deps: HealthDependencies): Promise<HealthReport> {
  const timeoutMs = deps.timeoutMs ?? 2_000;
  const [database, redis] = await Promise.all([timed(deps.pingDatabase, timeoutMs), timed(deps.pingRedis, timeoutMs)]);
  const status = database.status === "down" ? "down" : redis.status === "down" ? "degraded" : "ok";
  return { status, checks: { database, redis } };
}
