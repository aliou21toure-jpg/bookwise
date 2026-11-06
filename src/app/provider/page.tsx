import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CreateOrganizationForm } from "@/components/auth/create-organization-form";
import { pageUser } from "@/app/_dashboard/guards";
import { listMyOrganizations } from "@/modules/organizations";

export const metadata: Metadata = { title: "Provider dashboard", robots: { index: false } };
export const instant = false;

/** Opens the only organization directly; lets members of several choose. */
export default async function ProviderIndex() {
  const ctx = await pageUser("/provider");
  const orgs = await listMyOrganizations(ctx);
  if (orgs.length === 1) redirect(`/provider/${orgs[0]!.id}`);
  return (
    <main className="mx-auto grid w-full max-w-xl flex-1 content-start gap-6 px-4 py-12 sm:px-6">
      <Link href="/dashboard" className="text-sm text-primary underline underline-offset-4">
        ← My BookWise
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{orgs.length ? "Choose an organization" : "Start offering your services"}</h1>
      {orgs.length ? (
        <ul className="grid gap-2">
          {orgs.map((o) => (
            <li key={o.id}>
              <Link href={`/provider/${o.id}`} className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 font-medium hover:bg-muted">
                {o.name}
                <span className="text-sm font-normal text-muted-foreground">{o.memberRole === "owner" ? "Owner" : "Staff"}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <CreateOrganizationForm />
      )}
    </main>
  );
}
