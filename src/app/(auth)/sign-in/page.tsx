import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { FormSkeleton } from "@/components/auth/form-skeleton";
import { SignInForm } from "@/components/auth/sign-in-form";
import { Alert } from "@/components/ui/alert";
import { safeNextPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign in" };

async function Form({ searchParams }: { searchParams: PageProps<"/sign-in">["searchParams"] }) {
  const { next, verified } = await searchParams;
  return (
    <>
      {verified === "1" && (
        <Alert tone="success" className="mb-5">
          Email confirmed. You can sign in now.
        </Alert>
      )}
      <SignInForm next={safeNextPath(typeof next === "string" ? next : null)} />
    </>
  );
}

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        New to BookWise?{" "}
        <Link href="/sign-up" className="text-primary underline underline-offset-4">
          Create an account
        </Link>
      </p>
      <Suspense fallback={<FormSkeleton fields={2} />}>
        <Form searchParams={searchParams} />
      </Suspense>
    </>
  );
}
