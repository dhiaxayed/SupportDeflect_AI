/** Real public forms against the disposable fixture API from playwright.config.ts. */
import { expect, test } from "@playwright/test";

test("registration and login retain real sessions and the original workspace styling", async ({
  page,
  browser,
  baseURL,
}) => {
  const email = `public-redesign-${Date.now()}@example.com`;
  const password = "Public-fixture-password-123!";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/register");
  await page.getByLabel("Company name").fill("Public design fixture");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.locator(".sd-public,.sd-auth")).toHaveCount(0);
  expect(await page.locator("body").evaluate((el) => getComputedStyle(el).fontFamily)).toContain(
    "Inter",
  );
  expect(
    await page
      .locator("body")
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--sd-accent")),
  ).toBe("");
  await expect(page.locator("canvas")).toHaveCount(0);

  const context = await browser.newContext({ baseURL, reducedMotion: "reduce" });
  try {
    const login = await context.newPage();
    await login.goto("/login");
    await login.getByLabel("Email", { exact: true }).fill(email);
    await login.getByLabel("Password", { exact: true }).fill("Incorrect-fixture-password!");
    await login.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(login.locator("[data-sonner-toast]")).toBeVisible();
    await expect(login).toHaveURL(/\/login$/);
    await expect(login.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
    await expect(login.getByLabel("Email", { exact: true })).toHaveValue(email);
    await login.getByLabel("Password", { exact: true }).fill(password);
    await login.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(login).toHaveURL(/\/dashboard$/);
    await expect(login.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
  expect(errors).toEqual([]);
});
