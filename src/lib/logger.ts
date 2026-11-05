import pino from "pino";

/**
 * Structured JSON logs. Never log passwords, tokens, cookies, card data or request bodies;
 * the redact list is a safety net, not permission to log them.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: process.env.BOOKWISE_SERVICE ?? "web" },
  redact: {
    paths: ["*.password", "*.token", "*.cookie", "*.authorization", "headers.cookie", "headers.authorization"],
    censor: "[redacted]",
  },
});

export type Logger = typeof logger;
