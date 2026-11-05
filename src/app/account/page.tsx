import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CreateOrganizationForm } from "@/components/auth/create-organization-form";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthContext } from "@/modules/auth";
import { getMe } from "@/modules/users";

export const metadata: Metadata = { title: "Your account" };

const ROLE_LABEL = { customer: "Customer", provider: "Provider", admin: "Administrator" } as const;

async function AccountDetails({ searchParams }: { searchParams: PageProps<"/account">["searchParams"] }) {
  const ctx = await getAuthContext(await headers());
  if (!ctx || ctx.user.status !== "active") redirect("/sign-in?next=/account");
  const [me, { verified }] = await Promise.all([getMe(ctx), searchParams]);

  return (
    <div className="grid gap-6">
      {verified === "1" && <Alert tone="success">Email confirmed. Welcome to BookWise.</Alert>}
      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2>{me.user.name}</h2>
          </CardTitle>
          <CardDescription>{me.user.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Account type</dt>
            <dd>{ROLE_LABEL[me.user.role]}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd>{me.user.emailVerified ? "Confirmed" : "Not confirmed"}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2>Organizations</h2>
          </CardTitle>
          <CardDescription>
            {me.organizations.length ? "Businesses you manage on BookWise." : "Offer your own services by creating an organization."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {me.organizations.length ? (
            <ul className="grid gap-3">
              {me.organizations.map((org) => (
                <li key={org.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <span className="font-medium">{org.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {org.role === "owner" ? "Owner" : "Staff"}
                    {org.status === "suspended" ? " · Suspended" : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <CreateOrganizationForm />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AccountPage({ searchParams }: PageProps<"/account">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/" className="text-sm font-semibold tracking-wide text-primary uppercase">
            BookWise
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Your account</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/bookings">Your bookings</Link>
          </Button>
          <SignOutButton />
        </div>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading your account…</p>}>
        <AccountDetails searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
