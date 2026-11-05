import { Suspense } from "react";
import type { Metadata } from "next";

import { FormSkeleton } from "@/components/auth/form-skeleton";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Choose a new password", referrer: "no-referrer" };

async function Form({ searchParams }: { searchParams: PageProps<"/reset-password">["searchParams"] }) {
  const { token, error } = await searchParams;
  return <ResetPasswordForm token={typeof token === "string" && !error ? token : null} />;
}

export default function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <Suspense fallback={<FormSkeleton fields={1} />}>
        <Form searchParams={searchParams} />
      </Suspense>
    </>
  );
}
