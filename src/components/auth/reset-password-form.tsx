"use client";

import { useState } from "react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api, fieldErrors, type ApiError } from "./api-client";
import { Field } from "./field";
import { useHydrated } from "./use-hydrated";

export function ResetPasswordForm({ token }: { token: string | null }) {
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();

  if (!token) {
    return (
      <Alert tone="error">
        This reset link is incomplete. <Link href="/forgot-password" className="underline">Request a new one</Link>.
      </Alert>
    );
  }
  if (done) {
    return (
      <div className="grid gap-4">
        <Alert tone="success">Your password was changed and you were signed out on every device.</Alert>
        <Button asChild size="lg">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await api("/api/v1/auth/password/reset", {
      body: { token, newPassword: new FormData(event.currentTarget).get("newPassword") },
    });
    setPending(false);
    if (result.ok) setDone(true);
    else setError(result.error);
  }

  return (
    <form method="post" onSubmit={onSubmit} className="grid gap-5" noValidate>
      <Field
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint="At least 10 characters."
        error={fieldErrors(error).newPassword}
      />
      {error && !error.details && <Alert tone="error">{error.message}</Alert>}
      <Button type="submit" size="lg" disabled={pending || !hydrated}>
        {pending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
