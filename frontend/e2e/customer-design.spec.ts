/**
 * @file Browser layout/integration verification across every tenant workspace route and
 * viewport. Use synthetic fixture data and a real escalated case, assert shared
 * typography/theme and horizontal containment, and capture readable screens without
 * substituting mock page implementations.
 */

import { expect, test, type Page } from "@playwright/test";

const views = [
  ["/dashboard", "Overview"],
  ["/dashboard/documents", "Documents"],
  ["/dashboard/upload", "Upload documents"],
  ["/dashboard/sources", "URL Sources"],
  ["/dashboard/playground", "Playground"],
  ["/dashboard/widget", "Widget Design Studio"],
  ["/dashboard/analytics", "Analytics"],
  ["/dashboard/settings", "Account settings"],
  ["/dashboard/billing", "Subscription & usage"],
  ["/dashboard/team", "Team"],
  ["/dashboard/inbox", "Support Inbox"],
] as const;

/**
 * Assert that the rendered document width stays within the selected viewport; callers run it
 * after real route/content rendering.
 */
async function assertFits(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );
}

test("customer workspace keeps its original theme across every view", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("owner2@example.com");
  await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  const escalation = await request.post(process.env.E2E_API_URL + "/widget/company_e2e_2/chat", {
    headers: { Origin: "https://customer.example" },
    data: {
      visitor_id: "design-review-visitor-with-a-long-identifier-to-check-wrapping",
      question: "Can your team help me configure a custom support workflow?",
    },
  });
  expect(escalation.status()).toBe(200);
  expect((await escalation.json()).needs_human).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.locator(".tenant-shell").evaluate((element) => getComputedStyle(element).fontFamily),
  ).toContain("Inter");

  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    for (const [route, heading] of views) {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(
        page.locator(".tenant-shell [role=alert]").filter({ hasText: /unable|failed|error/i }),
      ).toHaveCount(0);
      if (route === "/dashboard/widget") {
        await page.getByRole("button", { name: "Open preview chat", exact: true }).click();
        await expect(
          page.frameLocator('iframe[title="Widget live preview"]').getByLabel("Your question"),
        ).toBeVisible();
      }
      if (route === "/dashboard/inbox") {
        await expect(page.getByLabel("Human answer", { exact: true })).toBeVisible();
      }
      if (route === "/dashboard/analytics") {
        await expect
          .poll(async () =>
            page
              .locator(".recharts-bar-rectangle path")
              .evaluateAll((paths) =>
                paths.some((path) => path.getBoundingClientRect().height > 4),
              ),
          )
          .toBe(true);
      }
      if (route === "/dashboard/team") {
        await expect(page.getByRole("table")).toBeVisible();
        expect(
          await page
            .getByRole("table")
            .evaluate((element) => element.getBoundingClientRect().width),
        ).toBeGreaterThanOrEqual(680);
      }
      await assertFits(page, width);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`${route.split("/").pop()}-${width}.png`),
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Search workspace documents").fill("Customer guide");
  await page.getByLabel("Search workspace documents").press("Enter");
  await expect(page).toHaveURL(/\/dashboard\/documents\?q=Customer/);
  await expect(page.getByRole("cell", { name: "Customer guide", exact: true })).toBeVisible();
  await page.getByLabel("Search workspace documents").fill("no-matching-document");
  await page.getByLabel("Search workspace documents").press("Enter");
  await expect(page.getByRole("cell", { name: "Customer guide", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Support inbox", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Support Inbox", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Assign to me", exact: true }).click();
  await expect(page.getByText("No open cases.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "In review", exact: true }).click();
  await expect(page.getByLabel("Assignee", { exact: true })).not.toHaveValue("");
  await page
    .getByLabel("Human answer", { exact: true })
    .fill("Our team will help you configure your support workflow.");
  await page.getByRole("button", { name: "Resolve case", exact: true }).click();
  await expect(page.getByText("No in review cases.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Resolved", exact: true }).click();
  await expect(page.getByLabel("Human answer", { exact: true })).toHaveValue(
    "Our team will help you configure your support workflow.",
  );
  expect(errors).toEqual([]);
});
