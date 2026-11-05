/** Queue names in one place, shared by producers (web app) and consumers (worker). */
export const QUEUES = {
  system: "system",
  bookings: "bookings",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const BOOKING_JOBS = {
  /** Delayed job per hold: expire it if still unpaid at expires_at. */
  expireHold: "hold.expire",
  /** Every minute: expire any due holds and approval requests the delayed jobs missed. */
  sweep: "bookings.sweep",
  /** Daily: report slots whose reserved_count disagrees with holds and bookings. */
  consistency: "bookings.consistency",
} as const;
