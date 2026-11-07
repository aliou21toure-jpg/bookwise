import type { MailMessage } from "@/lib/mail/mailer";
import { formatMoney } from "@/lib/money";
import type { NotificationKind } from "./rules";

/** Everything an email shows, captured when the event happened. */
export interface BookingMailData {
  reference: string;
  serviceName: string;
  listingTitle: string;
  organizationName: string;
  timezone: string;
  startsAt: string;
  quantity: number;
  totalMinor: number;
  currency: string;
  customerName: string;
  reason: string | null;
  bookingUrl: string;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function when(d: BookingMailData): string {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: d.timezone, dateStyle: "full", timeStyle: "short" });
  return `${f.format(new Date(d.startsAt))} (${d.timezone.replace(/_/g, " ")} time)`;
}

function render(heading: string, lines: string[], d: BookingMailData, linkLabel: string): { text: string; html: string } {
  const details = [
    `${d.serviceName} · ${d.listingTitle}`,
    d.organizationName,
    when(d),
    `${d.quantity > 1 ? `${d.quantity} people · ` : ""}${d.totalMinor === 0 ? "Free" : formatMoney(d.totalMinor, d.currency)}`,
    `Reference ${d.reference}`,
  ];
  const text = [heading, "", ...lines, "", ...details, "", `${linkLabel}: ${d.bookingUrl}`].join("\n");
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#111;max-width:520px;margin:0 auto;padding:24px">
<h1 style="font-size:20px">${escapeHtml(heading)}</h1>
${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n")}
<table style="border-collapse:collapse;margin:16px 0;font-size:14px">${details.map((l) => `<tr><td style="padding:2px 0">${escapeHtml(l)}</td></tr>`).join("")}</table>
<p><a href="${escapeHtml(d.bookingUrl)}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${escapeHtml(linkLabel)}</a></p>
<p style="color:#555;font-size:12px">You receive this email because of a booking on BookWise.</p>
</body></html>`;
  return { text, html };
}

/** Subject and body for one notification. Unknown kinds throw, so a typo fails loudly in tests. */
export function bookingMessage(kind: NotificationKind, to: string, d: BookingMailData): MailMessage {
  const reason = d.reason ? [`Reason: ${d.reason}`] : [];
  const t = (subject: string, heading: string, lines: string[], link = "View booking") => ({ kind, to, subject, ...render(heading, lines, d, link) });
  switch (kind) {
    case "booking-confirmed":
      return t(`Confirmed: ${d.serviceName} on ${when(d)}`, "Your booking is confirmed", [`Hi ${d.customerName}, you are booked with ${d.organizationName}.`]);
    case "booking-requested":
      return t(`Request sent: ${d.serviceName}`, "Your request was sent", [`${d.organizationName} approves each booking. We will email you as soon as they answer.`, "If you paid by card, it is only authorized for now; you are charged when they accept."]);
    case "booking-declined":
      return t(`Not available: ${d.serviceName}`, "Your request was declined", [`${d.organizationName} could not accept this booking. You have not been charged.`, ...reason], "Find another time");
    case "booking-cancelled":
      return t(`Cancelled: ${d.serviceName}`, "Your booking is cancelled", [`This booking with ${d.organizationName} is cancelled.`, ...reason, ...(d.totalMinor > 0 ? ["Any payment is refunded to your card; refunds usually arrive within 5 to 10 business days."] : [])]);
    case "payment-too-late":
      return t(`Refund on its way: ${d.serviceName}`, "Your payment arrived after the time was taken", ["Your hold expired and someone else booked this time before your payment came through. We are refunding the full amount."], "View booking");
    case "refund-issued":
      return t(`Refunded: ${d.serviceName}`, "Your refund is on its way", [`${formatMoney(d.totalMinor, d.currency)} was refunded to your card. It usually appears within 5 to 10 business days.`]);
    case "booking-reminder":
      return t(`Tomorrow: ${d.serviceName}`, "See you soon", [`A reminder of your booking with ${d.organizationName}.`, "Need to change plans? Open the booking to see the cancellation policy."]);
    case "provider-new-booking":
      return t(`New booking: ${d.serviceName} · ${d.customerName}`, "You have a new booking", [`${d.customerName} booked ${d.serviceName}.`], "Open reservation");
    case "provider-approval-request":
      return t(`Approval needed: ${d.serviceName} · ${d.customerName}`, "A customer is waiting for your answer", [`${d.customerName} asked for ${d.serviceName}. Approve or decline it within 24 hours, or the request is declined automatically.`], "Review request");
    case "provider-booking-cancelled":
      return t(`Cancelled by customer: ${d.serviceName}`, "A customer cancelled", [`${d.customerName} cancelled their booking. The time is open again.`, ...reason], "Open reservation");
  }
  throw new Error(`No template for ${kind as string}`);
}
