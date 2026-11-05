import { cn } from "@/lib/utils";

const LABELS: Record<string, { text: string; tone: string }> = {
  PENDING_PAYMENT: { text: "Held, not confirmed", tone: "bg-accent text-accent-foreground" },
  AWAITING_APPROVAL: { text: "Waiting for the provider", tone: "bg-accent text-accent-foreground" },
  CONFIRMED: { text: "Confirmed", tone: "bg-success/15 text-foreground" },
  CANCELLED: { text: "Cancelled", tone: "bg-muted text-muted-foreground" },
  EXPIRED: { text: "Expired", tone: "bg-muted text-muted-foreground" },
  COMPLETED: { text: "Completed", tone: "bg-muted text-foreground" },
  REFUNDED: { text: "Refunded", tone: "bg-muted text-muted-foreground" },
};

export function StatusBadge({ status }: { status: string }) {
  const label = LABELS[status] ?? { text: status, tone: "bg-muted" };
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", label.tone)}>{label.text}</span>;
}
