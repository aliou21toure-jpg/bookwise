export const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: "Held (unpaid)",
  AWAITING_APPROVAL: "Waiting for approval",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  EXPIRED: "Expired",
};

export const LISTING_STATUS = {
  draft: { label: "Draft", tone: "muted" },
  published: { label: "Published", tone: "good" },
  under_review: { label: "Under review", tone: "info" },
  rejected: { label: "Rejected", tone: "bad" },
} as const;

export const CATEGORY_OPTIONS = [
  { value: "service", label: "Service (appointment)" },
  { value: "activity", label: "Activity or class" },
  { value: "accommodation", label: "Stay" },
];

export const PAYMENT_STATUS = {
  requires_payment: { label: "Awaiting payment", tone: "muted" },
  authorized: { label: "Authorized", tone: "info" },
  succeeded: { label: "Paid", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  canceled: { label: "Canceled", tone: "muted" },
} as const;

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
