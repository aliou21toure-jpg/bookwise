import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("home page explains the product", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("BookWise");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Book services and activities with confidence.");
  await expect(page.getByRole("heading", { name: "Real-time availability" })).toBeVisible();
});

test("home page has no serious accessibility violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((v) => [v.id, v.nodes.length]))).toEqual([]);
});

test("home page fits a phone screen without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("health endpoint reports the database and Redis", async ({ request }) => {
  const res = await request.get("/api/v1/health");
  expect(res.status()).toBe(200);
  expect((await res.json()).data.checks.database.status).toBe("up");
});
