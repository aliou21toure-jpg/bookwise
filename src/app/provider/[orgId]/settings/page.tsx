import type { Metadata } from "next";

import { ApiButton } from "@/components/dashboard/api-button";
import { ApiForm } from "@/components/dashboard/api-form";
import { pageProvider } from "@/app/_dashboard/guards";
import { Badge, PageHeader, Section, TableWrap } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { formatDate, formatDateTime } from "@/lib/format";
import { providerAuditLogs } from "@/modules/dashboards";
import { getOrganization, listMembers } from "@/modules/organizations";

export const metadata: Metadata = { title: "Organization settings" };
export const instant = false;

const CURRENCIES = ["CAD", "USD", "EUR", "GBP", "XOF", "MAD"].map((c) => ({ value: c, label: c }));

export default async function ProviderSettingsPage({ params }: PageProps<"/provider/[orgId]/settings">) {
  const { orgId } = await params;
  const { ctx, memberRole } = await pageProvider(orgId, `/provider/${orgId}/settings`);
  const [org, members, activity] = [
    await getOrganization(ctx, orgId),
    await listMembers(ctx, orgId),
    await providerAuditLogs(ctx, orgId, { page: 1, pageSize: 15 }),
  ];
  const owner = memberRole === "owner";
  const canEdit = owner && org.status === "active";
  const zones = Intl.supportedValuesOf("timeZone").map((z) => ({ value: z, label: z.replace(/_/g, " ") }));
  const currencies = CURRENCIES.some((c) => c.value === org.defaultCurrency) ? CURRENCIES : [...CURRENCIES, { value: org.defaultCurrency, label: org.defaultCurrency }];

  return (
    <>
      <PageHeader title="Settings" description={owner ? "Owners can change these settings." : "Only owners can change these settings; ask an owner of this organization."} />
      <div className="grid gap-6">
        {org.status === "suspended" && <Alert tone="error">This organization is suspended, so settings are read-only.</Alert>}
        <Section title="Organization">
          <ApiForm
            url={`/api/v1/organizations/${orgId}`}
            method="PATCH"
            changedOnly
            disabled={!canEdit}
            submitLabel="Save organization"
            successMessage="Saved."
            fields={[
              { name: "name", label: "Business name", type: "text", required: true, minLength: 2, maxLength: 100, defaultValue: org.name, span: 3 },
              { name: "timezone", label: "Time zone", type: "select", required: true, options: zones, defaultValue: org.timezone, span: 3, hint: "Opening hours and booking times use this zone." },
              { name: "defaultCurrency", label: "Currency for new services", type: "select", required: true, options: currencies, defaultValue: org.defaultCurrency, span: 2 },
            ]}
          />
        </Section>

        <Section title="Public profile" description="Shown to customers next to your listings.">
          <ApiForm
            url={`/api/v1/organizations/${orgId}`}
            method="PATCH"
            changedOnly
            disabled={!canEdit}
            submitLabel="Save profile"
            successMessage="Saved."
            fields={[
              { name: "profile.description", label: "About", type: "textarea", nullable: true, maxLength: 2000, defaultValue: org.profile?.description },
              { name: "profile.phone", label: "Phone", type: "tel", nullable: true, defaultValue: org.profile?.phone, span: 3 },
              { name: "profile.address", label: "Address", type: "text", nullable: true, maxLength: 200, defaultValue: org.profile?.address, span: 3 },
              { name: "profile.city", label: "City", type: "text", nullable: true, maxLength: 100, defaultValue: org.profile?.city, span: 3 },
              { name: "profile.country", label: "Country code", type: "text", nullable: true, maxLength: 2, placeholder: "CA", defaultValue: org.profile?.country, span: 3, hint: "Two letters, such as CA or ML." },
            ]}
          />
        </Section>

        <Section title="Team" description="Owners manage settings and the team; staff manage listings and reservations.">
          <TableWrap label="Team members">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Joined</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId}>
                  <td>
                    {m.name} {m.userId === ctx.user.id && <span className="text-muted-foreground">(you)</span>}
                    <span className="block text-xs text-muted-foreground">{m.email}</span>
                  </td>
                  <td>
                    <Badge tone={m.role === "owner" ? "info" : "neutral"}>{m.role === "owner" ? "Owner" : "Staff"}</Badge>
                  </td>
                  <td>{formatDate(m.joinedAt, org.timezone)}</td>
                  <td>
                    {canEdit && m.userId !== ctx.user.id && (
                      <ApiButton
                        url={`/api/v1/organizations/${orgId}/members/${m.userId}`}
                        method="DELETE"
                        label="Remove"
                        variant="ghost"
                        ariaLabel={`Remove ${m.name}`}
                        confirm={`Remove ${m.name} from ${org.name}?`}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          {canEdit && (
            <div className="grid gap-2 border-t pt-4">
              <h3 className="text-sm font-semibold">Add a member</h3>
              <ApiForm
                url={`/api/v1/organizations/${orgId}/members`}
                submitLabel="Add member"
                resetOnSuccess
                successMessage="Member added."
                fields={[
                  { name: "email", label: "Email of an existing BookWise account", type: "email", required: true, span: 3 },
                  {
                    name: "role",
                    label: "Role",
                    type: "select",
                    required: true,
                    options: [
                      { value: "staff", label: "Staff" },
                      { value: "owner", label: "Owner" },
                    ],
                    defaultValue: "staff",
                    span: 3,
                  },
                ]}
              />
            </div>
          )}
        </Section>

        <Section title="Recent activity" description="Changes made by your team and by BookWise to this organization.">
          {activity.rows.length ? (
            <ul className="grid gap-1 text-sm">
              {activity.rows.map((a) => (
                <li key={a.id} className="flex flex-wrap gap-x-2 border-b py-1.5 last:border-0">
                  <span className="text-muted-foreground tabular-nums">{formatDateTime(a.createdAt, org.timezone)}</span>
                  <span className="font-mono text-xs leading-5">{a.action}</span>
                  <span className="text-muted-foreground">by {a.actor.email ?? a.actor.role}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
          )}
        </Section>
      </div>
    </>
  );
}
