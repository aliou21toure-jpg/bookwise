"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "@/components/auth/api-client";
import { useHydrated } from "@/components/auth/use-hydrated";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  url: string;
  method?: "POST" | "PATCH" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
  label: string;
  pendingLabel?: string;
  variant?: "default" | "outline" | "destructive" | "secondary" | "ghost";
  size?: "sm" | "default";
  /** Ask for a reason (3–500 characters) and send it as `reason`. */
  reason?: { label: string; required?: boolean };
  /** Show a second "Yes, …" step before acting. */
  confirm?: string;
  /** Send an Idempotency-Key header (payment and booking commands). */
  idempotent?: boolean;
  /** Accessible name when the visible label is ambiguous in a list ("Approve BW-1234"). */
  ariaLabel?: string;
}

/**
 * One API command as a button: optional confirmation and reason, inline error, and a
 * refresh of the server-rendered page afterwards so every number on screen is re-read.
 */
export function ApiButton({ url, method = "POST", body, label, pendingLabel, variant = "outline", size = "sm", reason, confirm, idempotent, ariaLabel }: Props) {
  const router = useRouter();
  const hydrated = useHydrated();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsStep = Boolean(reason || confirm);

  async function run() {
    setPending(true);
    setError(null);
    const payload = reason && text.trim() ? { ...body, reason: text.trim() } : body;
    const res = idempotent
      ? await fetch(url, {
          method,
          headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(payload ?? {}),
        })
          .then(async (r) => (r.ok ? { ok: true as const } : { ok: false as const, error: (await r.json().catch(() => ({}))).error ?? { message: "Something went wrong." } }))
          .catch(() => ({ ok: false as const, error: { message: "We could not reach BookWise. Check your connection and try again." } }))
      : await api(url, { method, body: method === "DELETE" && !payload ? undefined : (payload ?? {}) });
    setPending(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setOpen(false);
    setText("");
    router.refresh();
  }

  const reasonOk = !reason?.required || text.trim().length >= 3;

  return (
    <div className="grid justify-items-start gap-2">
      {!open || !needsStep ? (
        <Button
          type="button"
          size={size}
          variant={variant}
          aria-label={ariaLabel}
          disabled={!hydrated || pending}
          onClick={() => (needsStep ? setOpen(true) : run())}
        >
          {pending ? (pendingLabel ?? `${label}…`) : label}
        </Button>
      ) : (
        <div className="grid w-full max-w-sm gap-2 rounded-md border bg-card p-3">
          {confirm && <p className="text-sm">{confirm}</p>}
          {reason && (
            <div className="grid gap-1">
              <label htmlFor={`${id}-reason`} className="text-xs font-medium">
                {reason.label}
                {reason.required ? "" : " (optional)"}
              </label>
              <textarea
                id={`${id}-reason`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={500}
                rows={2}
                className="rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={variant === "outline" ? "default" : variant} disabled={pending || !reasonOk} onClick={run}>
              {pending ? (pendingLabel ?? `${label}…`) : `Yes, ${label.toLowerCase()}`}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
              Keep as is
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className={cn("text-sm text-destructive")}>
          {error}
        </p>
      )}
    </div>
  );
}
