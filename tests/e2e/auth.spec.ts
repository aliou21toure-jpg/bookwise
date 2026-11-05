import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/*
 * Browser journeys. The E2E server runs with REQUIRE_EMAIL_VERIFICATION=false, so sign-up
 * signs in straight away; the verification flow itself is covered by integration tests.
 */

const PASSWORD = "correct horse battery";
/** Next keeps recently visited pages mounted but hidden; only use visible fields. */
const field = (page: Page, label: string) => page.getByLabel(label).filter({ visible: true });

const uniqueEmail = (tag: string) => `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

async function signUp(page: Page, { email, name, provider }: { email: string; name: string; provider?: string }) {
  await page.goto(provider ? "/sign-up?type=provider" : "/sign-up");
  await field(page, "Your name").fill(name);
  await field(page, "Email").fill(email);
  await field(page, "Password").fill(PASSWORD);
  if (provider) {
    await expect(page.getByRole("radio", { name: "Offer services" })).toBeChecked();
    await field(page, "Business name").fill(provider);
    await field(page, "Time zone").selectOption("America/Toronto");
  }
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/account$/);
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => [v.id, v.nodes.length]);
}

test("a customer signs up, signs out and signs back in", async ({ page }) => {
  const email = uniqueEmail("customer");
  await signUp(page, { email, name: "Ana Customer" });
  await expect(page.getByRole("heading", { name: "Ana Customer" })).toBeVisible();
  await expect(page.getByText("Customer", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  await field(page, "Email").fill(email);
  await field(page, "Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Ana Customer" })).toBeVisible();
});

test("a provider registers their business and becomes its owner", async ({ page }) => {
  await signUp(page, { email: uniqueEmail("provider"), name: "Pat Provider", provider: "Maple Physio E2E" });
  await expect(page.getByText("Provider", { exact: true })).toBeVisible();
  const org = page.getByRole("listitem").filter({ hasText: "Maple Physio E2E" });
  await expect(org).toContainText("Owner");
});

test("a customer can become a provider from their account page", async ({ page }) => {
  await signUp(page, { email: uniqueEmail("upgrade"), name: "Cam Customer" });
  await field(page, "Business name").fill("Cam's Climbing Gym");
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Cam's Climbing Gym" })).toContainText("Owner");
  await expect(page.getByText("Provider", { exact: true })).toBeVisible();
});

test("the account page sends signed-out visitors to sign in", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount$/);
});

test("a wrong password shows an error and keeps the visitor signed out", async ({ page }) => {
  await page.goto("/sign-in");
  await field(page, "Email").fill(uniqueEmail("nobody"));
  await field(page, "Password").fill("wrong password!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Invalid email or password.");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("sign-in ignores an off-site next parameter (no open redirect)", async ({ page, context }) => {
  const email = uniqueEmail("redirect");
  await signUp(page, { email, name: "Rae Redirect" });
  await context.clearCookies();
  await page.goto("/sign-in?next=//evil.example/steal");
  await field(page, "Email").fill(email);
  await field(page, "Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/localhost:\d+\/account$/);
});

test("credentials never reach the URL, even on a native form submission", async ({ page }) => {
  for (const path of ["/sign-in", "/sign-up", "/reset-password?token=x"]) {
    await page.goto(path);
    for (const method of await page.locator("form").evaluateAll((forms) => forms.map((f) => f.getAttribute("method")))) {
      expect(method, path).toBe("post");
    }
  }
});

test("auth pages have no serious accessibility violations and fit a phone", async ({ page }) => {
  for (const path of ["/sign-in", "/sign-up?type=provider", "/forgot-password"]) {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(path);
    expect(await axe(page), path).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
