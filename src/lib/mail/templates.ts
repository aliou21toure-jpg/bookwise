import type { MailMessage } from "./mailer";

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(heading: string, intro: string, action: { label: string; url: string }, outro: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#111;max-width:520px;margin:0 auto;padding:24px">
<h1 style="font-size:20px">${escapeHtml(heading)}</h1>
<p>${escapeHtml(intro)}</p>
<p><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${escapeHtml(action.label)}</a></p>
<p style="color:#555;font-size:14px">${escapeHtml(outro)}</p>
<p style="color:#555;font-size:12px">If the button does not work, paste this link into your browser:<br>${escapeHtml(action.url)}</p>
</body></html>`;
}

export function verifyEmailMessage(to: string, name: string, url: string): MailMessage {
  const intro = `Hi ${name}, confirm your email address to finish setting up your BookWise account.`;
  const outro = "The link expires in 1 hour. If you did not create an account, you can ignore this email.";
  return {
    kind: "verify-email",
    to,
    subject: "Confirm your email for BookWise",
    text: `${intro}\n\n${url}\n\n${outro}`,
    html: layout("Confirm your email", intro, { label: "Confirm email", url }, outro),
  };
}

export function resetPasswordMessage(to: string, name: string, url: string): MailMessage {
  const intro = `Hi ${name}, we received a request to reset your BookWise password.`;
  const outro = "The link expires in 30 minutes and works once. If you did not ask for this, ignore this email; your password stays the same.";
  return {
    kind: "reset-password",
    to,
    subject: "Reset your BookWise password",
    text: `${intro}\n\n${url}\n\n${outro}`,
    html: layout("Reset your password", intro, { label: "Choose a new password", url }, outro),
  };
}
