/**
 * @file Public landing-page browser checks for local brand/font assets, responsive
 * containment, working registration/navigation links and the explicitly labeled example
 * widget. These checks validate public presentation without claiming the illustrative
 * conversation is a live AI result.
 */

import { expect, test } from "@playwright/test";

const headline = "AI support widget powered by your own documentation.";

test("public home preserves the original identity and working account links", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: headline, level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('400 16px "Inter"'))).toBe(true);
  const logo = page.locator("header img");
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("landing-desktop.png"), fullPage: true });
  await page.getByRole("link", { name: "View demo", exact: true }).click();
  await expect(page.getByText("Example conversation", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close example widget", exact: true }).click();
  await expect(page.getByText("Acme Support", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Open example widget", exact: true }).click();
  await expect(page.getByText("Acme Support", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Log in", exact: true }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("login-desktop.png"), fullPage: true });
  await page.goto("/");
  await page.getByRole("link", { name: "Start building", exact: true }).first().click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole("button", { name: "Create workspace", exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("register-desktop.png"), fullPage: true });
});

test("public pages fit narrow mobile viewports", async ({ page }, testInfo) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of ["/", "/login", "/register"]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (route !== "/") {
        await expect(
          page.getByRole("button", {
            name: route === "/login" ? "Sign in" : "Create workspace",
            exact: true,
          }),
        ).toBeEnabled();
      }
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({
        path: testInfo.outputPath(`${route.slice(1) || "landing"}-${width}.png`),
        fullPage: true,
      });
    }
  }
});
