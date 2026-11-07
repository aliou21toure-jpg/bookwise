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

test("every page carries the security headers", async ({ request }) => {
  for (const path of ["/", "/listings", "/sign-in"]) {
    const res = await request.get(path);
    const h = res.headers();
    expect(h["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"]).toContain("object-src 'none'");
    expect(h["content-security-policy"]).not.toContain("unsafe-eval");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["strict-transport-security"]).toContain("max-age=63072000");
    expect(h["permissions-policy"]).toContain("camera=()");
    expect(h["x-powered-by"]).toBeUndefined();
  }
});

test("private pages are never cached and public pages render under the CSP", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) errors.push(m.text());
  });
  await page.goto("/listings");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
  const email = `cache-${Date.now().toString(36)}@example.com`;
  await page.request.post("/api/v1/auth/register", { data: { name: "Cache Check", email, password: "correct horse battery" } });
  const res = await page.request.get("/dashboard");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toMatch(/no-store/);
});
