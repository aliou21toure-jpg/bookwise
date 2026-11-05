"use client";

import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api } from "./api-client";
import { Field } from "./field";
import { useHydrated } from "./use-hydrated";

export function ForgotPasswordForm() {
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const result = await api<{ message: string }>("/api/v1/auth/password/forgot", {
      body: { email: new FormData(event.currentTarget).get("email") },
    });
    setPending(false);
    setMessage(
      result.ok
        ? { tone: "success", text: `${result.data.message} The link expires in 30 minutes.` }
        : { tone: "error", text: result.error.code === "VALIDATION_FAILED" ? "Enter a valid email address." : result.error.message },
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} className="grid gap-5" noValidate>
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <Button type="submit" size="lg" disabled={pending || !hydrated}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
