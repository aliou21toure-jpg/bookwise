"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api, type ApiError } from "./api-client";
import { Field } from "./field";
import { useHydrated } from "./use-hydrated";
import { ResendVerification } from "./resend-verification";

export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const result = await api("/api/v1/auth/login", { body: { email: form.get("email"), password: form.get("password") } });
    setPending(false);
    if (!result.ok) return setError(result.error);
    // `next` was already reduced to a same-origin path on the server.
    router.push(next);
    router.refresh();
  }

  return (
    <form method="post" onSubmit={onSubmit} className="grid gap-5" noValidate>
      <Field label="Email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      {error && (
        <Alert tone="error">
          {error.code === "VALIDATION_FAILED" ? "Enter your email and password." : error.message}
        </Alert>
      )}
      {error?.code === "EMAIL_NOT_VERIFIED" && email && <ResendVerification email={email} />}
      <Button type="submit" size="lg" disabled={pending || !hydrated}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-sm">
        <Link href="/forgot-password" className="text-primary underline underline-offset-4">
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}
