import type { Metadata } from "next";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { ApiForm } from "@/components/dashboard/api-form";
import { pageUser } from "@/app/_dashboard/guards";
import { PageHeader, Section } from "@/components/dashboard/ui";
import { getMe } from "@/modules/users";

export const metadata: Metadata = { title: "Settings" };
export const instant = false;

const LOCALES = [
  { value: "en", label: "English" },
  { value: "en-CA", label: "English (Canada)" },
  { value: "fr", label: "Français" },
  { value: "fr-CA", label: "Français (Canada)" },
];

export default async function SettingsPage() {
  const ctx = await pageUser("/dashboard/settings");
  const me = await getMe(ctx);

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6">
        <Section title="Preferences">
          <ApiForm
            url="/api/v1/auth/me"
            method="PATCH"
            changedOnly
            submitLabel="Save preferences"
            successMessage="Preferences saved."
            fields={[
              { name: "locale", label: "Language for emails", type: "select", required: true, options: LOCALES, defaultValue: me.profile.locale, span: 3 },
              {
                name: "marketingOptIn",
                label: "Send me news and offers",
                type: "checkbox",
                defaultValue: me.profile.marketingOptIn,
                hint: "Booking confirmations and reminders are always sent; this only covers marketing.",
              },
            ]}
          />
        </Section>

        <Section title="Password" description="Changing it signs you out on your other devices unless you untick the box.">
          <ApiForm
            url="/api/v1/auth/password/change"
            submitLabel="Change password"
            successMessage="Password changed."
            resetOnSuccess
            fields={[
              { name: "currentPassword", label: "Current password", type: "password", required: true, autoComplete: "current-password", span: 3 },
              { name: "newPassword", label: "New password", type: "password", required: true, minLength: 10, autoComplete: "new-password", hint: "At least 10 characters.", span: 3 },
              { name: "revokeOtherSessions", label: "Sign out of my other devices", type: "checkbox", defaultValue: true },
            ]}
          />
        </Section>

        <Section title="Session" description="Sign out of BookWise on this device.">
          <div>
            <SignOutButton />
          </div>
        </Section>
      </div>
    </>
  );
}
