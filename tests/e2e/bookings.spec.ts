import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";

const tag = () => `bk${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A provider with one published service open every day, seeded through the API. */
async function seedProvider(request: APIRequestContext, word: string, service: Record<string, unknown>) {
  const reg = await request.post("/api/v1/auth/register", {
    data: { accountType: "provider", name: "Pat", email: `p-${word}@example.com`, password: "correct horse battery", organization: { name: `Studio ${word}`, timezone: "America/Toronto" } },
  });
  const orgId = (await reg.json()).data.organization.id as string;
  const listing = await request.post("/api/v1/listings", { data: { organizationId: orgId, category: "activity", title: `Climbing ${word}`, city: "Toronto" } });
  const listingId = (await listing.json()).data.id as string;
  const svc = await request.post(`/api/v1/listings/${listingId}/services`, { data: { name: "Intro session", durationMinutes: 60, cancellationWindowHours: 0, ...service } });
  const serviceId = (await svc.json()).data.id as string;
  for (let weekday = 0; weekday < 7; weekday++) await request.post("/api/v1/availability", { data: { serviceId, weekday, startLocal: "09:00", endLocal: "17:00" } });
  await request.patch(`/api/v1/listings/${listingId}`, { data: { status: "published" } });
  return { listingId };
}

async function signUpCustomer(request: APIRequestContext, word: string) {
  const res = await request.post("/api/v1/auth/register", { data: { name: "Casey", email: `c-${word}@example.com`, password: "correct horse battery" } });
  expect(res.status()).toBe(201);
}

test("a customer reserves a free time, confirms it, and cancels it", async ({ page, playwright, baseURL }) => {
  const word = tag();
  const provider = await playwright.request.newContext({ baseURL });
  const { listingId } = await seedProvider(provider, word, { priceMinor: 0 });
  await signUpCustomer(page.request, word); // page.request shares the browser's cookies

  await page.goto(`/listings/${listingId}`);
  const times = page.getByRole("list", { name: "Next open times for Intro session" });
  await times.getByRole("button").first().click();

  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Held, not confirmed")).toBeVisible();
  await expect(page.getByRole("timer")).toContainText(/holding this time for you for \d+:\d\d/);
  await expect(await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze().then((r) => r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id))).toEqual([]);

  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(page.getByText(/^BW-[0-9A-Z]{8}$/)).toBeVisible();

  await page.getByRole("link", { name: "← Your bookings" }).click();
  await expect(page.getByRole("region", { name: "Upcoming" }).getByRole("listitem")).toHaveCount(1);
  await page.getByRole("region", { name: "Upcoming" }).getByRole("link").click();

  await page.getByRole("button", { name: "Cancel booking" }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await provider.dispose();
});

test("a paid time is held but waits for card payment", async ({ page, playwright, baseURL }) => {
  const word = tag();
  const provider = await playwright.request.newContext({ baseURL });
  const { listingId } = await seedProvider(provider, word, { priceMinor: 4500 });
  await signUpCustomer(page.request, word);

  await page.goto(`/listings/${listingId}`);
  await page.getByRole("list", { name: "Next open times for Intro session" }).getByRole("button").first().click();
  await expect(page.getByText("$45.00")).toBeVisible();
  await expect(page.getByText(/Card payment opens in the next release/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm booking" })).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel hold" }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await provider.dispose();
});

test("visitors are asked to sign in before reserving", async ({ page, playwright, baseURL }) => {
  const word = tag();
  const provider = await playwright.request.newContext({ baseURL });
  const { listingId } = await seedProvider(provider, word, { priceMinor: 0 });
  await page.goto(`/listings/${listingId}`);
  await page.getByRole("list", { name: "Next open times for Intro session" }).getByRole("button").first().click();
  await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=%2Flistings%2F${listingId}`));
  await provider.dispose();
});
