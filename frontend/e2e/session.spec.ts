/**
 * @file Browser regressions for expired sessions, cross-tab logout and recoverable /auth/me
 * outages. Protected content must disappear on token invalidation, while transient
 * account-service failure keeps the session and offers retry. Only the targeted failure
 * responses are intercepted.
 */

import { expect, test } from "@playwright/test";

/**
 * Authenticate the seeded tenant administrator through the real login form and wait for the
 * protected overview before simulating a session failure.
 */
async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("owner1@example.com");
  await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
}

test("an expired API session redirects immediately and hides private workspace content", async ({
  page,
}) => {
  await signIn(page);
  await page.route("**/api/v1/documents", (route) =>
    route.fulfill({ status: 401, json: { detail: "Session expired" } }),
  );
  await page.goto("/dashboard/documents");
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => localStorage.getItem("supportdeflect_admin_token"))).toBeNull();
  await expect(page.locator(".tenant-shell")).toHaveCount(0);
});

test("cross-tab logout invalidates the open workspace without a manual reload", async ({
  page,
  context,
}) => {
  await signIn(page);
  const other = await context.newPage();
  await other.goto("/");
  await other.evaluate(() => localStorage.removeItem("supportdeflect_admin_token"));
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator(".tenant-shell")).toHaveCount(0);
  await other.close();
});

test("a temporary account API failure is recoverable without discarding the session", async ({
  page,
}) => {
  await signIn(page);
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({ status: 503, json: { detail: "Account service temporarily unavailable" } }),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
  expect(
    await page.evaluate(() => Boolean(localStorage.getItem("supportdeflect_admin_token"))),
  ).toBe(true);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.unroute("**/api/v1/auth/me");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
});
