"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MailCheck } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { api, fieldErrors, type ApiError } from "./api-client";
import { Field } from "./field";
import { useHydrated } from "./use-hydrated";
import { ResendVerification } from "./resend-verification";

const CURRENCIES = ["CAD", "USD", "EUR", "GBP", "XOF"] as const;
const selectClass =
  "h-10 w-full rounded-md border border-input bg-card px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:text-sm";

type Registered = { verificationRequired: true; email: string } | { verificationRequired: false };

export function SignUpForm({ initialType }: { initialType: "customer" | "provider" }) {
  const router = useRouter();
  const [accountType, setAccountType] = useState(initialType);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();
  const uid = useId();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const timeZones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  const localZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const errors = fieldErrors(error);

  if (sentTo) {
    return (
      <div className="grid gap-4">
        <MailCheck aria-hidden className="size-8 text-primary" />
        <h2 className="text-lg font-semibold">Check your email</h2>
        <p className="text-sm text-muted-foreground">
          We sent a confirmation link to <strong className="text-foreground">{sentTo}</strong>. Open it to activate your account.
          The link expires in 1 hour.
        </p>
        <ResendVerification email={sentTo} />
      </div>
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {
      accountType,
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
    };
    if (accountType === "provider") {
      body.organization = {
        name: form.get("organizationName"),
        timezone: form.get("timezone"),
        defaultCurrency: form.get("currency"),
      };
    }
    setPending(true);
    setError(null);
    const result = await api<Registered>("/api/v1/auth/register", { body });
    setPending(false);
    if (!result.ok) return setError(result.error);
    if (result.data.verificationRequired) setSentTo(result.data.email);
    else {
      router.push("/account");
      router.refresh();
    }
  }

  // Organization fields are named organizationName etc. in the form; map API paths back.
  const orgErrors = { organizationName: error?.details?.find((d) => d.path === "organization.name")?.message };

  return (
    <form method="post" onSubmit={onSubmit} className="grid gap-5" noValidate>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">I want to</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["customer", "Book services"],
              ["provider", "Offer services"],
            ] as const
          ).map(([value, label]) => (
            <Label
              key={value}
              className={cn(
                "flex h-10 cursor-pointer items-center justify-center rounded-md border text-sm has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
                accountType === value ? "border-primary bg-accent text-accent-foreground" : "bg-card",
              )}
            >
              <input
                type="radio"
                name="accountType"
                value={value}
                checked={accountType === value}
                onChange={() => setAccountType(value)}
                className="sr-only"
              />
              {label}
            </Label>
          ))}
        </div>
      </fieldset>

      <Field label="Your name" name="name" autoComplete="name" required error={errors.name} />
      <Field label="Email" name="email" type="email" autoComplete="email" required error={errors.email} />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint="At least 10 characters."
        error={errors.password}
      />

      {accountType === "provider" && (
        <fieldset className="grid gap-4 rounded-lg border p-4">
          <legend className="px-1 text-sm font-medium">Your business</legend>
          <Field label="Business name" name="organizationName" required error={orgErrors.organizationName} />
          <div className="grid gap-2">
            <Label htmlFor={`${uid}-field-timezone`}>Time zone</Label>
            <select id={`${uid}-field-timezone`} name="timezone" defaultValue={localZone} className={selectClass}>
              {timeZones.map((tz) => (
                <option key={tz}>{tz}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${uid}-field-currency`}>Currency</Label>
            <select id={`${uid}-field-currency`} name="currency" defaultValue="CAD" className={selectClass}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </fieldset>
      )}

      {error && !error.details && <Alert tone="error">{error.message}</Alert>}
      {error?.details && <Alert tone="error">Please fix the highlighted fields.</Alert>}

      <Button type="submit" size="lg" disabled={pending || !hydrated}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
