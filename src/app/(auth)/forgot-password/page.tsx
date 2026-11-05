import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mb-6 text-sm text-muted-foreground">Enter your email and we will send you a link to choose a new password.</p>
      <ForgotPasswordForm />
    </>
  );
}
