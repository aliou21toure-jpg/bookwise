"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

import { api, fieldErrors, type ApiError } from "@/components/auth/api-client";
import { useHydrated } from "@/components/auth/use-hydrated";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fromLocalMs } from "@/lib/time-zone";

export type FieldSpec = {
  /** Body path; "profile.phone" nests. */
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  /** Empty input is sent as null (clearable fields) instead of being left out. */
  nullable?: boolean;
  /** Grid columns on wide screens (out of 6). */
  span?: 2 | 3 | 6;
} & (
  | { type: "text" | "email" | "password" | "tel"; defaultValue?: string | null; maxLength?: number; minLength?: number; autoComplete?: string; placeholder?: string }
  | { type: "textarea"; defaultValue?: string | null; maxLength?: number; rows?: number }
  | { type: "number"; defaultValue?: number | null; min?: number; max?: number; step?: number }
  /** Decimal amount shown in major units, sent as integer minor units. */
  | { type: "money"; defaultValue?: number | null; currency: string; digits?: number }
  | { type: "select"; defaultValue?: string | null; options: { value: string; label: string }[]; numeric?: boolean; emptyLabel?: string }
  | { type: "checkbox"; defaultValue?: boolean }
  | { type: "time" | "date"; defaultValue?: string | null }
  /** Wall-clock time in `timeZone`, sent as an ISO instant. */
  | { type: "datetime"; defaultValue?: string | null; timeZone: string }
);

interface Props {
  url: string;
  method?: "POST" | "PATCH" | "PUT";
  fields: FieldSpec[];
  submitLabel: string;
  /** Merged into the body (ids the form belongs to). */
  extra?: Record<string, unknown>;
  successMessage?: string;
  resetOnSuccess?: boolean;
  /** Navigate here on success instead of refreshing (e.g. a new listing's page). `{id}` is filled from the response. */
  redirectTo?: string;
  /** Only send fields the user changed (PATCH forms). */
  changedOnly?: boolean;
  /** Show the values without allowing changes (for example, staff viewing owner settings). */
  disabled?: boolean;
  className?: string;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let node = target;
  for (const key of keys.slice(0, -1)) node = (node[key] ??= {}) as Record<string, unknown>;
  node[keys.at(-1)!] = value;
}

function readField(form: FormData, f: FieldSpec): { value: unknown; error?: string } | undefined {
  if (f.type === "checkbox") return { value: form.get(f.name) === "on" };
  const raw = String(form.get(f.name) ?? "").trim();
  if (raw === "") return f.nullable ? { value: null } : undefined;
  switch (f.type) {
    case "number":
      return { value: Number(raw) };
    case "money": {
      const amount = Number(raw.replace(",", "."));
      if (!Number.isFinite(amount) || amount < 0) return { value: undefined, error: "Enter an amount such as 45 or 45.50" };
      return { value: Math.round(amount * 10 ** (f.digits ?? 2)) };
    }
    case "select":
      return { value: f.numeric ? Number(raw) : raw };
    case "datetime": {
      const [d, t] = raw.split("T");
      const [y, m, day] = d!.split("-").map(Number);
      const [h, min] = t!.split(":").map(Number);
      const utc = fromLocalMs(Date.UTC(y!, m! - 1, day!, h!, min!), f.timeZone);
      if (utc === null) return { value: undefined, error: "That time does not exist on this day (clocks change). Pick another." };
      return { value: new Date(utc).toISOString() };
    }
    default:
      return { value: raw };
  }
}

const initial = (f: FieldSpec): string => {
  if (f.type === "checkbox") return f.defaultValue ? "on" : "";
  if (f.type === "money") return f.defaultValue == null ? "" : (f.defaultValue / 10 ** (f.digits ?? 2)).toFixed(f.digits ?? 2);
  return f.defaultValue == null ? "" : String(f.defaultValue);
};

const control = "w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive";

/**
 * A JSON form for one API endpoint. Submits with fetch (never a native submission, so no
 * field can end up in a URL), shows field errors from the API's validation details, and
 * refreshes the page so server-rendered data reflects the change.
 */
export function ApiForm({ url, method = "POST", fields, submitLabel, extra, successMessage, resetOnSuccess, redirectTo, changedOnly, disabled, className }: Props) {
  const router = useRouter();
  const hydrated = useHydrated();
  const uid = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [local, setLocal] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const body: Record<string, unknown> = { ...extra };
    const problems: Record<string, string> = {};
    for (const f of fields) {
      if (changedOnly) {
        const now = f.type === "checkbox" ? (form.get(f.name) === "on" ? "on" : "") : String(form.get(f.name) ?? "").trim();
        if (now === initial(f)) continue;
      }
      const read = readField(form, f);
      if (!read) continue;
      if (read.error) problems[f.name.split(".").pop()!] = read.error;
      else setPath(body, f.name, read.value);
    }
    setLocal(problems);
    setDone(false);
    if (Object.keys(problems).length) return;
    if (changedOnly && Object.keys(body).length === Object.keys(extra ?? {}).length) {
      setDone(true);
      return;
    }
    setPending(true);
    setError(null);
    const res = await api<{ id?: string }>(url, { method, body });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (resetOnSuccess) formEl.reset();
    setDone(true);
    if (redirectTo) router.push(redirectTo.replace("{id}", res.data?.id ?? ""));
    else router.refresh();
  }

  const errors = { ...fieldErrors(error), ...local };
  const formLevel = error && !error.details?.length ? error.message : error?.details?.some((d) => !fields.some((f) => f.name.split(".").pop() === (d.path.split(".").pop() || "form"))) ? error.message : null;

  return (
    <form method="post" noValidate={false} onSubmit={onSubmit} className={cn("grid gap-4", className)}>
      <fieldset disabled={disabled} className="grid gap-4 disabled:opacity-80 sm:grid-cols-6">
        {fields.map((f) => {
          const id = `${uid}-${f.name}`;
          const key = f.name.split(".").pop()!;
          const err = errors[key];
          const described = [f.hint && `${id}-hint`, err && `${id}-error`].filter(Boolean).join(" ") || undefined;
          const common = { id, name: f.name, required: f.required, "aria-invalid": err ? true : undefined, "aria-describedby": described } as const;
          const span = f.span === 2 ? "sm:col-span-2" : f.span === 3 ? "sm:col-span-3" : "sm:col-span-6";
          if (f.type === "checkbox") {
            return (
              <div key={f.name} className={cn("flex items-start gap-2", span)}>
                <input type="checkbox" {...common} defaultChecked={f.defaultValue} className="mt-0.5 size-4 accent-[var(--primary)]" />
                <div className="grid gap-0.5">
                  <label htmlFor={id} className="text-sm font-medium">
                    {f.label}
                  </label>
                  {f.hint && (
                    <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                      {f.hint}
                    </p>
                  )}
                  {err && (
                    <p id={`${id}-error`} className="text-sm text-destructive">
                      {err}
                    </p>
                  )}
                </div>
              </div>
            );
          }
          let input: React.ReactNode;
          if (f.type === "textarea") input = <textarea {...common} defaultValue={initial(f)} maxLength={f.maxLength} rows={f.rows ?? 3} className={cn(control, "py-2")} />;
          else if (f.type === "select")
            input = (
              <select {...common} defaultValue={initial(f)} className={cn(control, "h-9")}>
                {!f.required && <option value="">{f.emptyLabel ?? "—"}</option>}
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            );
          else
            input = (
              <input
                {...common}
                type={f.type === "money" ? "text" : f.type === "datetime" ? "datetime-local" : f.type}
                inputMode={f.type === "money" ? "decimal" : undefined}
                defaultValue={initial(f)}
                min={f.type === "number" ? f.min : undefined}
                max={f.type === "number" ? f.max : undefined}
                step={f.type === "number" ? f.step : undefined}
                maxLength={"maxLength" in f ? f.maxLength : undefined}
                minLength={"minLength" in f ? f.minLength : undefined}
                autoComplete={"autoComplete" in f ? f.autoComplete : undefined}
                placeholder={"placeholder" in f ? f.placeholder : undefined}
                className={cn(control, "h-9")}
              />
            );
          return (
            <div key={f.name} className={cn("grid min-w-0 content-start gap-1.5", span)}>
              <label htmlFor={id} className="text-sm font-medium">
                {f.label}
                {f.type === "money" && <span className="font-normal text-muted-foreground"> ({f.currency})</span>}
              </label>
              {input}
              {f.hint && (
                <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                  {f.hint}
                </p>
              )}
              {err && (
                <p id={`${id}-error`} className="text-sm text-destructive">
                  {err}
                </p>
              )}
            </div>
          );
        })}
      </fieldset>
      {formLevel && <Alert tone="error">{formLevel}</Alert>}
      {done && successMessage && <Alert tone="success">{successMessage}</Alert>}
      {!disabled && (
        <div>
          <Button type="submit" disabled={!hydrated || pending}>
            {pending ? "Saving…" : submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
