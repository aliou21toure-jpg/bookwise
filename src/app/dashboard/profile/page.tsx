import type { Metadata } from "next";
import Link from "next/link";

import { CreateOrganizationForm } from "@/components/auth/create-organization-form";
import { ApiForm } from "@/components/dashboard/api-form";
import { pageUser } from "@/app/_dashboard/guards";
import { Badge, PageHeader, Section } from "@/components/dashboard/ui";
import { getMe } from "@/modules/users";

export const metadata: Metadata = { title: "Profile" };
export const instant = false;

const ROLE = { customer: "Customer", provider: "Provider", admin: "Administrator" } as const;

export default async function ProfilePage() {
  const ctx = await pageUser("/dashboard/profile");
  const me = await getMe(ctx);

  return (
    <>
      <PageHeader title="Profile" description="Providers see your name, email and phone on bookings you make with them." />
      <div className="grid gap-6">
        <Section title="Your details">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="flex flex-wrap items-center gap-2 break-all">
              {me.user.email} {me.user.emailVerified ? <Badge tone="good">Confirmed</Badge> : <Badge tone="bad">Not confirmed</Badge>}
            </dd>
            <dt className="text-muted-foreground">Account type</dt>
            <dd>{ROLE[me.user.role]}</dd>
          </dl>
          <ApiForm
            url="/api/v1/auth/me"
            method="PATCH"
            changedOnly
            submitLabel="Save profile"
            successMessage="Profile saved."
            fields={[
              { name: "name", label: "Full name", type: "text", required: true, maxLength: 100, autoComplete: "name", defaultValue: me.user.name, span: 3 },
              { name: "phone", label: "Phone", type: "tel", nullable: true, autoComplete: "tel", defaultValue: me.profile.phone, hint: "Optional. Used only by providers you book with.", span: 3 },
            ]}
          />
        </Section>

        <Section title="Organizations" description={me.organizations.length ? "Businesses you manage on BookWise." : "Offer your own services by creating an organization."}>
          {me.organizations.length ? (
            <ul className="grid gap-2">
              {me.organizations.map((org) => (
                <li key={org.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <Link href={`/provider/${org.id}`} className="font-medium underline-offset-4 hover:underline">
                    {org.name}
                  </Link>
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    {org.role === "owner" ? "Owner" : "Staff"}
                    {org.status === "suspended" && <Badge tone="bad">Suspended</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <CreateOrganizationForm />
          )}
        </Section>
      </div>
    </>
  );
}
