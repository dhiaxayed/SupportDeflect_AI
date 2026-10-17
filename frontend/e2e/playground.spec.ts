/**
 * @file Tenant Playground browser/API journey for greetings, unsupported knowledge, uploaded
 * evidence, follow-up history and clarification. Use real authentication/ingestion/chat HTTP
 * requests with fixture AI so UI/API contracts are exercised; this is not verification of a
 * live Groq account.
 */

import { expect, test } from "@playwright/test";

test("Playground routes greetings to AI and unsupported questions to knowledge fallback", async ({
  page,
  request,
}, testInfo) => {
  const account = await request.post(process.env.E2E_API_URL + "/auth/register", {
    data: {
      organization_name: "Playground verification",
      admin_email: "playground@example.com",
      password: process.env.E2E_ADMIN_PASSWORD!,
    },
  });
  expect(account.status()).toBe(201);
  const auth = { Authorization: "Bearer " + (await account.json()).access_token };
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("playground@example.com");
  await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/dashboard/playground");
  const question = page.getByPlaceholder("Ask anything about your product", { exact: false });
  await question.fill("helo");
  const greeting = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/chat") && r.request().method() === "POST",
  );
  await question.press("Enter");
  expect((await (await greeting).json()).reason).toBe("greeting");
  await expect(page.getByText("Hello! How can I help you?", { exact: true })).toBeVisible();
  await expect(page.getByText("Conversation", { exact: true })).toBeVisible();
  await expect(page.getByText(/Confidence/)).toHaveCount(0);
  await expect(page.getByText("Sources", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("greeting-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await question.fill("Hello, what is your refund policy?");
  await question.press("Enter");
  await expect(page.getByText("Insufficient documentation", { exact: true })).toBeVisible();
  await expect(page.getByText("Sources", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath("knowledge-fallback-mobile.png"),
    fullPage: true,
  });
  const upload = await request.post(process.env.E2E_API_URL + "/documents/upload", {
    headers: auth,
    multipart: {
      file: {
        name: "profile.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          "Alex Martin est ingenieur logiciel.\nSes competences techniques sont Python et Docker.\nIl travaille chez Northstar Industries.",
        ),
      },
    },
  });
  expect(upload.status()).toBe(201);
  expect((await upload.json()).status).toBe("indexed");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await question.fill("c est qui alex martin");
  await question.press("Enter");
  await expect(page.getByText("Answered", { exact: true })).toBeVisible();
  await expect(page.getByText("Sources", { exact: true })).toBeVisible();
  await question.fill("quelles sont ses competences techniques ?");
  const followUp = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/chat") && r.request().method() === "POST",
  );
  await question.press("Enter");
  const followUpResponse = await followUp;
  expect(followUpResponse.request().postDataJSON().history[0].content).toBe(
    "c est qui alex martin",
  );
  expect((await followUpResponse.json()).status).toBe("resolved");
  await expect(page.getByText("Answered", { exact: true })).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath("profile-follow-up-mobile.png"),
    fullPage: true,
  });
  await question.fill("parle moi de cette entreprise");
  const clarification = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/chat") && r.request().method() === "POST",
  );
  await question.press("Enter");
  const clarificationResult = await (await clarification).json();
  expect(clarificationResult.status).toBe("clarification_needed");
  expect(clarificationResult.needs_human).toBe(false);
  await expect(page.getByText("Clarification needed", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("clarification-mobile.png"), fullPage: true });
});
