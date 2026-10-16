/**
 * @file Integrated browser journeys for organization lifecycle, subscription periods, manual
 * payments/refunds, reviewed campaigns and invited-agent password replacement. Requests use
 * the isolated fixture API; the main journey removes HTTPS-only randomUUID to cover the
 * documented HTTP lab path, while assertions retain real UI/backend mutations.
 */

import { test, expect } from "@playwright/test";

const password = process.env.E2E_ADMIN_PASSWORD;
const api = process.env.E2E_API_URL || "http://127.0.0.1:8012/api/v1";
test.skip(!password, "An isolated fixture database and E2E_ADMIN_PASSWORD are required");

test("administration workflow, chart rendering and mobile layout", async ({
  page,
  request,
}, testInfo) => {
  // The documented HTTP VM deployment does not expose the HTTPS-only randomUUID API.
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, "randomUUID", { value: undefined });
  });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("operator@example.com");
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Business overview" })).toBeVisible();
  await expect(page.getByText("Monthly recurring revenue", { exact: true })).toBeVisible();
  await expect(page.locator(".recharts-surface")).toHaveCount(3);
  await expect(page.locator(".recharts-area-curve")).toBeVisible();
  await expect(page.locator(".recharts-area-curve")).toHaveAttribute("d", /[ML]/);
  await expect(page.locator(".admin-brand img")).toBeVisible();
  expect(
    await page.locator(".admin-brand img").evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("overview-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "7 days", exact: true }).click();
  await expect(page.getByRole("button", { name: "7 days", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("link", { name: "Organizations", exact: true }).click();
  await page.getByRole("button", { name: "New organization", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Organization name").fill("Browser QA Account");
  await dialog.getByLabel("Administrator name").fill("Browser Owner");
  await dialog.getByLabel("Administrator email").fill("browser-owner@example.com");
  await dialog.getByRole("button", { name: "Create organization" }).click();
  await expect(
    page.getByRole("heading", { name: "Browser QA Account", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Subscription", exact: true }).click();
  await page.getByRole("combobox", { name: "Plan", exact: true }).selectOption("pro");
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("active");
  await page.getByLabel("Monthly fee").fill("125");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Organization updated", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Subscription", exact: true }).click();
  await page.getByRole("button", { name: "Adjust period" }).click();
  await dialog.getByLabel("Number of days").fill("45");
  await dialog.getByLabel("Reason").fill("E2E period extension");
  await dialog.getByRole("button", { name: "Apply adjustment" }).click();
  await expect(dialog).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("organization-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Archive organization", exact: true }).click();
  await dialog.getByLabel("Type Browser QA Account to confirm").fill("Browser QA Account");
  await dialog.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("button", { name: "Restore organization" }).click();
  await expect(
    page.getByRole("button", { name: "Archive organization", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Revenue & payments", exact: true }).click();
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  await dialog.getByLabel("Find an organization").fill("Browser QA");
  await expect(dialog.getByRole("option", { name: "Browser QA Account" })).toHaveCount(1);
  await dialog
    .getByRole("combobox", { name: "Organization", exact: true })
    .selectOption({ label: "Browser QA Account" });
  await dialog.getByLabel("Amount received").fill("147.50");
  await dialog.getByLabel("Payment reference").fill("E2E-RECEIPT");
  await dialog.getByRole("button", { name: "Record payment", exact: true }).click();
  const paymentRow = page.getByRole("row").filter({ hasText: "E2E-RECEIPT" });
  await expect(paymentRow).toContainText("147.50");
  await paymentRow.getByRole("button").click();
  await dialog.getByLabel("Refund amount (EUR)").fill("47.50");
  await dialog.getByLabel("Reason").fill("E2E refund adjustment");
  await dialog.getByRole("button", { name: "Record refund", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "E2E refund adjustment" })).toContainText(
    "47.50",
  );
  await page.getByRole("link", { name: "Communications", exact: true }).click();
  await page.getByRole("combobox", { name: "Audience", exact: true }).selectOption("all");
  await page.getByLabel("Subject", { exact: true }).fill("E2E service announcement");
  await page
    .getByLabel("Message", { exact: true })
    .fill("This is a synthetic message queued only in the isolated browser test database.");
  await page.getByRole("button", { name: "Review recipients" }).click();
  await expect(dialog.getByText("7", { exact: true })).toHaveCount(2);
  await dialog.getByRole("button", { name: "Queue 7 email(s)" }).click();
  await expect(page.getByRole("tab", { name: "Delivery log" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("cell", { name: "E2E service announcement", exact: false }),
  ).toHaveCount(7);
  await page.getByRole("tab", { name: "Automations" }).click();
  const automation = page.getByRole("switch", { name: "New organization welcome" });
  await automation.uncheck();
  await expect(automation).not.toBeChecked();
  await page.getByRole("tab", { name: "Compose" }).click();
  await page.screenshot({
    path: testInfo.outputPath("communications-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Business overview", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Business overview" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("overview-mobile.png"), fullPage: true });
  await page.getByRole("link", { name: "Organizations", exact: true }).click();
  await page.getByRole("button", { name: "New organization" }).click();
  expect(
    await dialog.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth;
    }),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("create-mobile.png"), fullPage: true });

  const login = await request.post(api + "/auth/login", {
    data: { email: "operator@example.com", password },
  });
  expect(login.ok()).toBe(true);
  const auth = { Authorization: "Bearer " + (await login.json()).access_token };
  const reporting = await request.get(api + "/platform/business", { headers: auth });
  expect(reporting.status()).toBe(200);
  expect((await reporting.json()).metrics.questions.value).toBeGreaterThan(10);
});

test("invited support agent must replace initial password", async ({ page, request }) => {
  const login = await request.post(api + "/auth/login", {
    data: { email: "owner0@example.com", password },
  });
  const tenant = { Authorization: "Bearer " + (await login.json()).access_token };
  const initial = "Temporary-e2e-agent-123";
  const create = await request.post(api + "/team/users", {
    headers: tenant,
    data: {
      email: "browser-agent@example.com",
      full_name: "Browser Agent",
      role: "support_agent",
      password: initial,
    },
  });
  expect(create.status()).toBe(201);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("browser-agent@example.com");
  await page.getByLabel("Password", { exact: true }).fill(initial);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Set your own password" })).toBeVisible();
  await page.goto("/dashboard/inbox");
  await expect(page.getByRole("heading", { name: "Set your own password" })).toBeVisible();
  await page.getByLabel("Current password", { exact: true }).fill(initial);
  await page.getByLabel("New password", { exact: true }).fill("New-e2e-agent-password-123");
  await page.getByLabel("Confirm new password", { exact: true }).fill("New-e2e-agent-password-123");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("heading", { name: "Support Inbox" })).toBeVisible();
  const rejected = await request.post(api + "/auth/login", {
    data: { email: "browser-agent@example.com", password: initial },
  });
  expect(rejected.status()).toBe(401);
});
