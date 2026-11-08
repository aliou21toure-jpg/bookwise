import { existsSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import pg from "pg";

/*
 * Dashboards, end to end: real data seeded through the public API, then every view opened
 * in a browser at 360, 768 and 1280 px. Each view must render without horizontal page
 * scrolling and without serious or critical axe violations.
 */

if (!process.env.DATABASE_MIGRATION_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");

const tag = () => `db${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = "correct horse battery";

interface World {
  orgId: string;
  listingId: string;
  serviceId: string;
  providerEmail: string;
  customerEmail: string;
  bookingIds: string[];
  slots: string[];
}

async function seed(provider: APIRequestContext, customer: APIRequestContext, word: string): Promise<World> {
  const providerEmail = `p-${word}@example.com`;
  const customerEmail = `c-${word}@example.com`;
  const reg = await provider.post("/api/v1/auth/register", {
    data: { accountType: "provider", name: "Pat Morin", email: providerEmail, password: PASSWORD, organization: { name: `Studio ${word}`, timezone: "America/Toronto" } },
  });
  const orgId = (await reg.json()).data.organization.id as string;
  const listing = await provider.post("/api/v1/listings", { data: { organizationId: orgId, category: "activity", title: `Climbing ${word}`, city: "Toronto" } });
  const listingId = (await listing.json()).data.id as string;
  const svc = await provider.post(`/api/v1/listings/${listingId}/services`, { data: { name: "Intro session", durationMinutes: 60, priceMinor: 0, capacity: 4, cancellationWindowHours: 0 } });
  const serviceId = (await svc.json()).data.id as string;
  for (let weekday = 0; weekday < 7; weekday++) await provider.post("/api/v1/availability", { data: { serviceId, weekday, startLocal: "09:00", endLocal: "17:00" } });
  await provider.patch(`/api/v1/listings/${listingId}`, { data: { status: "published" } });

  expect((await customer.post("/api/v1/auth/register", { data: { name: "Casey Lee", email: customerEmail, password: PASSWORD } })).status()).toBe(201);
  const from = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const avail = await customer.get(`/api/v1/availability?serviceId=${serviceId}&from=${encodeURIComponent(from)}`);
  const slots = ((await avail.json()).data.slots as { startsAt: string }[]).map((s) => s.startsAt);
  const bookingIds: string[] = [];
  for (const startsAt of slots.slice(0, 3)) {
    const h = await customer.post("/api/v1/bookings/holds", { data: { serviceId, startsAt }, headers: { "Idempotency-Key": crypto.randomUUID() } });
    const id = (await h.json()).data.id as string;
    await customer.post("/api/v1/bookings", { data: { bookingId: id }, headers: { "Idempotency-Key": crypto.randomUUID() } });
    bookingIds.push(id);
  }
  return { orgId, listingId, serviceId, providerEmail, customerEmail, bookingIds, slots };
}

/** Test-only shortcuts that need the database: completing a visit and creating an admin. */
async function sql(text: string, values: unknown[]) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.role', 'system', true)");
    await client.query(text, values);
    await client.query("commit");
  } finally {
    await client.end();
  }
}

async function signIn(page: Page, email: string) {
  const res = await page.request.post("/api/v1/auth/login", { data: { email, password: PASSWORD } });
  expect(res.status()).toBe(200);
}

const WIDTHS = [360, 768, 1280];

/** No sideways page scroll at any width, and no serious/critical accessibility problems. */
async function checkLayout(page: Page, path: string, heading: string | RegExp) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    const wide = await page.evaluate(() => {
      const limit = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth <= limit) return [];
      // Name the elements that stick out and are not inside their own scrolling box.
      const clipped = (e: Element) => {
        // An absolutely positioned element escapes a scroll box that is not its containing block.
        if (getComputedStyle(e).position === "absolute" || getComputedStyle(e).position === "fixed") return false;
        for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") return true;
        return false;
      };
      return [
        `scrollWidth=${document.documentElement.scrollWidth}`,
        ...[...document.querySelectorAll("body *")]
          .filter((e) => e.getBoundingClientRect().right > limit + 1 && !clipped(e))
          .slice(0, 5)
          .map((e) => `${e.tagName.toLowerCase()}.${String(e.getAttribute("class") ?? "").slice(0, 60)} → ${Math.round(e.getBoundingClientRect().right)}`),
      ];
    });
    if (wide.length) await page.screenshot({ path: test.info().outputPath(`overflow-${width}.png`) });
    expect(wide, `${path} scrolls sideways at ${width}px`).toEqual([]);
  }
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
}

test.describe("dashboards", () => {
  // The layout checks set their own viewport sizes; one project is enough.
  test.skip(({ isMobile }) => isMobile, "covered by the explicit 360 px pass");

  test("customer: overview, bookings, saved listings, reviews, profile and settings", async ({ page, playwright, baseURL }) => {
    // A whole role journey: about ten pages, each checked at three widths. 25 s locally, so
    // the default 30 s left no room on a busy CI runner.
    test.slow();
    const word = tag();
    const provider = await playwright.request.newContext({ baseURL });
    const w = await seed(provider, page.request, word);
    await sql("update bookwise.bookings set status = 'COMPLETED', completed_at = now() where id = $1", [w.bookingIds[0]]);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Hello, Casey" })).toBeVisible();
    await expect(page.getByText("Upcoming", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("list", { name: "Next bookings" }).getByRole("listitem")).toHaveCount(2);

    // Save the listing from its page, then find it in Saved.
    await page.goto(`/listings/${w.listingId}`);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("button", { name: "Saved" })).toHaveAttribute("aria-pressed", "true");
    await page.goto("/dashboard/saved");
    await expect(page.getByRole("heading", { name: `Climbing ${word}` })).toBeVisible();

    // Review the completed visit; it appears on the public listing page.
    await page.goto("/dashboard/reviews");
    const form = page.locator(`#review-${w.bookingIds[0]}`);
    await form.locator("label", { hasText: "4 stars" }).click();
    await form.getByLabel("Comment").fill("Friendly staff and a clear introduction.");
    await form.getByRole("button", { name: "Post review" }).click();
    await expect(page.getByRole("img", { name: "4 out of 5 stars" })).toBeVisible();
    await page.goto(`/listings/${w.listingId}`);
    await expect(page.getByText("Friendly staff and a clear introduction.")).toBeVisible();
    await expect(page.getByText("Casey L.")).toBeVisible();

    // Profile edit persists.
    await page.goto("/dashboard/profile");
    await page.getByLabel("Phone").fill("+1 416 555 0100");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Phone")).toHaveValue("+1 416 555 0100");

    for (const [path, heading] of [
      ["/dashboard", /^Hello/],
      ["/dashboard/upcoming", "Upcoming"],
      ["/dashboard/history", "History"],
      ["/dashboard/saved", "Saved"],
      ["/dashboard/reviews", "Reviews"],
      ["/dashboard/profile", "Profile"],
      ["/dashboard/settings", "Settings"],
    ] as const) {
      await checkLayout(page, path, heading);
    }
    await provider.dispose();
  });

  test("provider: overview, reservations, calendar, catalogue, customers, revenue and settings", async ({ page, playwright, baseURL }) => {
    // A whole role journey: about ten pages, each checked at three widths. 25 s locally, so
    // the default 30 s left no room on a busy CI runner.
    test.slow();
    const word = tag();
    const customer = await playwright.request.newContext({ baseURL });
    const w = await seed(page.request, customer, word);
    const base = `/provider/${w.orgId}`;

    await page.goto("/provider");
    await expect(page).toHaveURL(new RegExp(`${base}$`));
    await expect(page.getByRole("heading", { level: 1, name: `Studio ${word}` })).toBeVisible();

    // Cancel one reservation with a reason; the customer sees the reason.
    await page.goto(`${base}/reservations`);
    const list = page.getByRole("list", { name: "Reservations" });
    await expect(list.getByRole("listitem")).toHaveCount(3);
    await list.getByRole("listitem").first().getByRole("button", { name: /^Cancel BW-/ }).click();
    await page.getByLabel("Reason shown to the customer").fill("Instructor unavailable");
    await page.getByRole("button", { name: "Yes, cancel" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await page.goto(`${base}/reservations?timeframe=past`);
    await expect(page.getByText("Reason: Instructor unavailable")).toBeVisible();

    // Calendar shows the week's bookings; customers lists the one customer.
    // The week of the first booked slot, in the provider's time zone.
    const firstSlotWeek = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date(w.slots[0]!));
    await page.goto(`${base}/calendar?week=${firstSlotWeek}`);
    await expect(page.getByRole("link", { name: /Intro session/ }).first()).toBeVisible();
    await page.goto(`${base}/customers`);
    await expect(page.getByRole("cell", { name: /Casey Lee/ })).toBeVisible();

    // Add opening hours from the service page.
    await page.goto(`${base}/services/${w.serviceId}`);
    await expect(page.getByRole("region", { name: "Opening hours" }).getByRole("row")).toHaveCount(8); // header + 7 days

    for (const [path, heading] of [
      [base, `Studio ${word}`],
      [`${base}/reservations`, "Reservations"],
      [`${base}/calendar`, "Calendar"],
      [`${base}/listings`, "Listings"],
      [`${base}/listings/${w.listingId}`, `Climbing ${word}`],
      [`${base}/services`, "Services"],
      [`${base}/services/${w.serviceId}`, "Intro session"],
      [`${base}/customers`, "Customers"],
      [`${base}/revenue`, "Revenue"],
      [`${base}/settings`, "Settings"],
    ] as const) {
      await checkLayout(page, path, heading);
    }
    await customer.dispose();
  });

  test("admin: overview, users, providers, listings, reservations, payments and audit log", async ({ page, playwright, baseURL }) => {
    // A whole role journey: about ten pages, each checked at three widths. 25 s locally, so
    // the default 30 s left no room on a busy CI runner.
    test.slow();
    const word = tag();
    const provider = await playwright.request.newContext({ baseURL });
    const customer = await playwright.request.newContext({ baseURL });
    const w = await seed(provider, customer, word);
    const adminEmail = `a-${word}@example.com`;
    expect((await page.request.post("/api/v1/auth/register", { data: { name: "Ada Admin", email: adminEmail, password: PASSWORD } })).status()).toBe(201);
    await sql("update bookwise.users set email_verified = true, role = 'admin' where email = $1", [adminEmail]);
    await signIn(page, adminEmail); // a fresh session carries the new role

    await page.goto("/admin/providers?q=" + word);
    const row = page.getByRole("row", { name: new RegExp(`Studio ${word}`) });
    await row.getByRole("button", { name: `Suspend Studio ${word}` }).click();
    await page.getByLabel("Reason (kept in the audit log)").fill("Repeated no-shows reported");
    await page.getByRole("button", { name: "Yes, suspend" }).click();
    await expect(row.getByText("Suspended")).toBeVisible();
    // The suspended provider can no longer add listings.
    const blocked = await provider.post("/api/v1/listings", { data: { organizationId: w.orgId, category: "service", title: "After suspension", city: "Toronto" } });
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()).error.code).toBe("ORGANIZATION_SUSPENDED");

    await page.goto(`/admin/audit-logs?action=organization.suspended&organizationId=${w.orgId}`);
    await expect(page.getByText("“Repeated no-shows reported”")).toBeVisible();

    for (const [path, heading] of [
      ["/admin", "Platform overview"],
      ["/admin/users", "Users"],
      ["/admin/providers", "Providers"],
      ["/admin/listings", "Listings and reviews"],
      ["/admin/reservations", "Reservations"],
      ["/admin/payments", "Payments"],
      ["/admin/audit-logs", "Audit log"],
    ] as const) {
      await checkLayout(page, path, heading);
    }
    await provider.dispose();
    await customer.dispose();
  });

  test("dashboards are not shown to the wrong people", async ({ page, playwright, baseURL }) => {
    const word = tag();
    const provider = await playwright.request.newContext({ baseURL });
    const w = await seed(provider, page.request, word);
    // The customer is signed in: the provider and admin areas are not found for them.
    await page.goto(`/provider/${w.orgId}`);
    await expect(page.getByRole("heading", { name: /not found|could not be found/i })).toBeVisible();
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: /not found|could not be found/i })).toBeVisible();
    // Signed out: sent to sign in, coming back afterwards.
    await page.context().clearCookies();
    await page.goto("/dashboard/reviews");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard%2Freviews$/);
    await provider.dispose();
  });
});
