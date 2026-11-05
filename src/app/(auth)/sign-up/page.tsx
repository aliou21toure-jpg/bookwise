import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { FormSkeleton } from "@/components/auth/form-skeleton";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = { title: "Create an account" };

async function Form({ searchParams }: { searchParams: PageProps<"/sign-up">["searchParams"] }) {
  const { type } = await searchParams;
  return <SignUpForm initialType={type === "provider" ? "provider" : "customer"} />;
}

export default function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Create an account</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Already have one?{" "}
        <Link href="/sign-in" className="text-primary underline underline-offset-4">
          Sign in
        </Link>
      </p>
      <Suspense fallback={<FormSkeleton fields={4} />}>
        <Form searchParams={searchParams} />
      </Suspense>
    </>
  );
}
