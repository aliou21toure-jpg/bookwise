"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api, fieldErrors, type ApiError } from "./api-client";
import { Field } from "./field";
import { useHydrated } from "./use-hydrated";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-card px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:text-sm";

export function CreateOrganizationForm() {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();
  const uid = useId();
  const timeZones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  const localZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const result = await api("/api/v1/organizations", {
      body: { name: form.get("name"), timezone: form.get("timezone"), defaultCurrency: form.get("currency") },
    });
    setPending(false);
    if (!result.ok) return setError(result.error);
    router.refresh();
  }

  return (
    <form method="post" onSubmit={onSubmit} className="grid gap-4" noValidate>
      <Field label="Business name" name="name" required error={fieldErrors(error).name} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-org-timezone`}>Time zone</Label>
          <select id={`${uid}-org-timezone`} name="timezone" defaultValue={localZone} className={selectClass}>
            {timeZones.map((tz) => (
              <option key={tz}>{tz}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-org-currency`}>Currency</Label>
          <select id={`${uid}-org-currency`} name="currency" defaultValue="CAD" className={selectClass}>
            {["CAD", "USD", "EUR", "GBP", "XOF"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      {error && !error.details && <Alert tone="error">{error.message}</Alert>}
      <Button type="submit" disabled={pending || !hydrated} className="justify-self-start">
        {pending ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
