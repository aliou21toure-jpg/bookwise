import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import sharp from "sharp";

/*
 * Seeds a provider through the public API (the E2E server signs up without email
 * verification), then browses as an anonymous visitor.
 */

const tag = () => `e2e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function seed(request: APIRequestContext, word: string, opts: { publish?: boolean } = {}) {
  const email = `provider-${word}@example.com`;
  const reg = await request.post("/api/v1/auth/register", {
    data: { accountType: "provider", name: "Pat", email, password: "correct horse battery", organization: { name: `Clinic ${word}`, timezone: "America/Toronto" } },
  });
  expect(reg.status()).toBe(201);
  const orgId = (await reg.json()).data.organization.id as string;

  const listing = await request.post("/api/v1/listings", {
    data: { organizationId: orgId, category: "service", title: `Sports massage ${word}`, description: "Recovery sessions for runners.", city: "Toronto" },
  });
  const listingId = (await listing.json()).data.id as string;
  const service = await request.post(`/api/v1/listings/${listingId}/services`, { data: { name: "Massage, 60 minutes", durationMinutes: 60, priceMinor: 9500 } });
  const serviceId = (await service.json()).data.id as string;
  for (let weekday = 0; weekday < 7; weekday++) {
    await request.post("/api/v1/availability", { data: { serviceId, weekday, startLocal: "09:00", endLocal: "17:00" } });
  }
  const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#2b7a78" } }).jpeg().toBuffer();
  const img = await request.post(`/api/v1/listings/${listingId}/images`, {
    multipart: { file: { name: "room.jpg", mimeType: "image/jpeg", buffer: jpeg }, altText: "Treatment room" },
  });
  expect(img.status()).toBe(201);
  if (opts.publish !== false) expect((await request.patch(`/api/v1/listings/${listingId}`, { data: { status: "published" } })).status()).toBe(200);
  await request.post("/api/v1/auth/logout", { data: {} });
  return { listingId };
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => [v.id, v.nodes.length]);
}

test("a visitor finds a listing, sees prices and the next open times", async ({ page, playwright, baseURL }) => {
  const word = tag();
  const api = await playwright.request.newContext({ baseURL });
  await seed(api, word);

  await page.goto("/");
  await page.getByRole("link", { name: "Browse services" }).click();
  await page.getByRole("searchbox", { name: "What are you looking for?" }).fill(word);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(new RegExp(`q=${word}`));
  await expect(page.getByRole("status")).toHaveText("1 result");

  const card = page.getByRole("article").filter({ hasText: `Sports massage ${word}` });
  await expect(card).toContainText("From $95.00");
  await card.getByRole("link").click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Sports massage ${word}`);
  await expect(page.getByRole("img", { name: "Treatment room" })).toBeVisible();
  await expect(page.getByText("$95.00", { exact: true }).filter({ visible: true })).toBeVisible();
  const times = page.getByRole("list", { name: "Next open times for Massage, 60 minutes" }).getByRole("listitem");
  await expect(times).toHaveCount(6);
  await api.dispose();
});

test("drafts are not reachable by visitors", async ({ page, playwright, baseURL, request }) => {
  const api = await playwright.request.newContext({ baseURL });
  const { listingId } = await seed(api, tag(), { publish: false });
  await page.goto(`/listings/${listingId}`);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await expect(page.getByText(/Sports massage/)).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect((await request.get(`/api/v1/listings/${listingId}`)).status()).toBe(404);
  await api.dispose();
});

test("search and listing pages are accessible and fit a phone", async ({ page, playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });
  const { listingId } = await seed(api, tag());
  await page.setViewportSize({ width: 360, height: 740 });
  for (const path of ["/listings", `/listings/${listingId}`]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await axe(page), path).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  await api.dispose();
});
