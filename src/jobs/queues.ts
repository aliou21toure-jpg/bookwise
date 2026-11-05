/** Queue names in one place, shared by producers (web app) and consumers (worker). */
export const QUEUES = {
  system: "system",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
