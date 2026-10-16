/**
 * @file End-to-end contract between Studio persistence, the shared preview renderer and an
 * independent customer host. Verify saved identities/dimensions/assets, snippet installation,
 * grounded and greeting chat, bounded follow-up history and capability-scoped human replies
 * without private notes. HTTP API-availability and IME regressions exercise the standalone
 * widget rather than a second renderer.
 */

import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

const api = process.env.E2E_API_URL!;
const password = process.env.E2E_ADMIN_PASSWORD!;

test("studio persistence, shared preview and exact snippet on an independent host", async ({
  page,
  request,
  context,
}, testInfo) => {
  // This journey includes uploads, human-reply polling and all persisted identity variants.
  test.setTimeout(180000);
  // Apply the HTTP lab's API availability to the studio frame and independent client page.
  await context.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, "randomUUID", { value: undefined });
  });
  const login = await request.post(api + "/auth/login", {
    data: { email: "owner0@example.com", password },
  });
  expect(login.ok()).toBe(true);
  const auth = { Authorization: "Bearer " + (await login.json()).access_token };
  const doc = await request.post(api + "/documents/upload", {
    headers: auth,
    multipart: {
      file: {
        name: "shipping.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          "Shipping delivery takes three working days. Track your shipment in the customer account. Shipping delivery takes three working days.",
        ),
      },
    },
  });
  expect(doc.status()).toBe(201);
  expect((await doc.json()).status).toBe("indexed");
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("owner0@example.com");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/dashboard/widget");
  await expect(page.getByRole("heading", { name: "Widget Design Studio" })).toBeVisible();
  const frame = page.frameLocator('iframe[title="Widget live preview"]');
  await page.getByLabel("Window width", { exact: true }).fill("430");
  await page.getByLabel("Window height", { exact: true }).fill("520");
  await page.getByLabel("Launcher size", { exact: true }).fill("64");
  await page.getByLabel("Corner radius", { exact: true }).fill("8");
  await page.getByLabel("Horizontal spacing", { exact: true }).fill("24");
  await page.getByLabel("Bottom spacing", { exact: true }).fill("18");
  await page.getByRole("combobox", { name: "Position", exact: true }).selectOption("bottom-left");
  await page.getByLabel("Accent color", { exact: true }).fill("#006b57");
  await page.getByRole("combobox", { name: "Widget identity", exact: true }).selectOption("robot");
  await expect(frame.locator(".sd-launcher")).toHaveCSS("width", "64px");
  await expect(frame.locator(".sd-launcher .sd-identity svg")).toBeVisible();
  await expect(frame.locator(".sd-launcher .sd-identity")).toHaveText("");
  await page
    .getByLabel("Upload logo", { exact: true })
    .setInputFiles(resolve("src/assets/official-logo.png"));
  await expect(page.getByAltText("Uploaded logo")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Widget identity", exact: true })).toHaveValue(
    "custom",
  );
  await page.getByRole("tab", { name: "Content", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Atlas customer care");
  await page.getByLabel("Welcome message", { exact: true }).fill("Hello from Atlas support.");
  await page.getByLabel("Input placeholder", { exact: true }).fill("Ask Atlas support");
  await page.getByRole("combobox", { name: "Initial state", exact: true }).selectOption("open");
  await expect(frame.locator(".sd-panel")).toBeVisible();
  await expect(frame.locator(".sd-brand")).toHaveText("Atlas customer care");
  await expect(frame.locator(".sd-greeting")).toHaveText("Hello from Atlas support.");
  await page.getByRole("tab", { name: "Install", exact: true }).click();
  await page.getByLabel("Allowed hostnames", { exact: true }).fill("127.0.0.1, localhost");
  await page.getByRole("button", { name: "Save design", exact: true }).click();
  await expect(page.getByText("Widget design saved", { exact: true })).toBeVisible();
  const snippet = await page.locator(".studio-snippet code").innerText();
  expect(snippet).toContain('data-company="company_e2e_0"');
  const stored = await request.get(api + "/settings/widget", { headers: auth });
  const settings = await stored.json();
  expect(settings.design).toMatchObject({
    width: 430,
    height: 520,
    launcher_size: 64,
    position: "bottom-left",
    identity: "custom",
    radius: 8,
    open_behavior: "open",
  });
  await page.reload();
  await expect(frame.locator(".sd-brand")).toHaveText("Atlas customer care");
  await page.getByRole("button", { name: "Desktop preview", exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("studio-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  // The preview's chat is real authenticated API traffic, not scripted sample text.
  await frame.getByLabel("Your question").fill("Shipping delivery takes three working days?");
  await frame.getByRole("button", { name: "Send message" }).click();
  await expect(frame.locator(".sd-message").last()).toContainText("three working days", {
    timeout: 30000,
  });

  const install = await request.post("http://127.0.0.1:8055/snippet", {
    data: snippet,
    headers: { "Content-Type": "text/plain" },
  });
  expect(install.status()).toBe(204);
  const client = await context.newPage();
  await client.goto("http://127.0.0.1:8055");
  await expect(client.getByRole("heading", { name: "Independent client website" })).toBeVisible();
  await expect(client.locator(".sd-panel")).toBeVisible();
  await expect(client.locator(".sd-brand")).toHaveText("Atlas customer care");
  await expect(client.locator(".sd-panel")).toHaveCSS("width", "430px");
  await expect(client.locator(".sd-panel")).toHaveCSS("height", "520px");
  await expect(client.locator(".sd-panel")).toHaveCSS("border-radius", "8px");
  await expect(client.locator(".sd-header")).toHaveCSS("background-color", "rgb(0, 107, 87)");
  const img = client.locator(".sd-avatar img");
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(
    true,
  );
  await expect(client.locator(".sd-launcher .sd-identity")).toHaveCSS("border-radius", "50%");
  await expect(client.locator(".sd-launcher .sd-identity")).toHaveCSS("overflow", "hidden");
  await expect(img).toHaveCSS("object-fit", "contain");
  // The entire rectangular mark must fit inside the circular identity, including its corners.
  expect(
    await img.evaluate((el) => {
      const image = el.getBoundingClientRect();
      const identity = el.parentElement!.getBoundingClientRect();
      return Math.hypot(image.width, image.height) <= identity.width;
    }),
  ).toBe(true);
  await expect(client.locator(".sd-footer")).toHaveText("Powered by SupportDeflectAI");
  await client.getByLabel("Your question").fill("helo");
  // Committing input-method composition must leave the draft intact without calling chat.
  let compositionRequests = 0;
  /**
   * Count public chat requests only around an IME commit event so the test can prove
   * composition did not accidentally submit the current draft.
   */
  const trackComposition = (request: import("@playwright/test").Request) => {
    if (request.url().endsWith("/widget/company_e2e_0/chat")) compositionRequests++;
  };
  client.on("request", trackComposition);
  const compositionAllowed = await client.getByLabel("Your question").evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(compositionAllowed).toBe(true);
  await expect(client.getByLabel("Your question")).toHaveValue("helo");
  expect(compositionRequests).toBe(0);
  client.off("request", trackComposition);
  await client.getByRole("button", { name: "Send message" }).click();
  await expect(client.locator(".sd-message").last()).toContainText("Hello! How can I help you?");
  await expect(client.locator(".sd-status")).toHaveCount(0);
  await client.getByLabel("Your question").fill("Shipping delivery takes three working days?");
  await client.getByRole("button", { name: "Send message" }).click();
  await expect(client.locator(".sd-message").last()).toContainText("three working days", {
    timeout: 30000,
  });
  await expect(client.getByText("Sources (1)", { exact: true })).toBeVisible();
  await client.getByLabel("Your question").fill("What about the customer account?");
  const followUp = client.waitForResponse(
    (r) => r.url().endsWith("/widget/company_e2e_0/chat") && r.request().method() === "POST",
  );
  await client.getByRole("button", { name: "Send message" }).click();
  const followUpResponse = await followUp;
  expect(
    followUpResponse
      .request()
      .postDataJSON()
      .history.some((turn: { content: string }) => turn.content.includes("Shipping delivery")),
  ).toBe(true);
  expect((await followUpResponse.json()).status).toBe("resolved");
  await client.screenshot({
    path: testInfo.outputPath("client-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await client.getByRole("button", { name: "Close support chat" }).click();
  await expect(client.locator(".sd-panel")).toBeHidden();
  await client.getByRole("button", { name: "Open support chat" }).click();
  await client.setViewportSize({ width: 390, height: 844 });
  const box = await client.locator(".sd-panel").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  await client.screenshot({
    path: testInfo.outputPath("client-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await client.reload();
  await expect(client.locator(".sd-brand")).toHaveText("Atlas customer care");
  await client.getByLabel("Your question").fill("What is the unexplained interstellar warranty?");
  await client.getByRole("button", { name: "Send message" }).click();
  await expect(
    client.getByText("Sent to the support team for review", { exact: true }),
  ).toBeVisible();
  const cases = await request.get(api + "/support-cases?status=open", { headers: auth });
  const supportCase = (await cases.json()).find((item: { question: string }) =>
    item.question.includes("interstellar"),
  );
  expect(supportCase).toBeTruthy();
  expect(
    (
      await request.patch(`${api}/support-cases/${supportCase.id}/note`, {
        headers: auth,
        data: { internal_note: "Private staff note never sent to the visitor" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.patch(`${api}/support-cases/${supportCase.id}/resolve`, {
        headers: auth,
        data: { human_answer: "A support agent has reviewed your warranty request." },
      })
    ).status(),
  ).toBe(200);
  // Reload retains only the scoped pending case capability, not an admin session.
  await client.reload();
  await expect(client.getByText("Support team:", { exact: false })).toContainText(
    "reviewed your warranty",
    { timeout: 30000 },
  );
  await expect(client.getByText("Private staff note", { exact: false })).toHaveCount(0);
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  for (const identity of ["default", "robot"] as const) {
    await page
      .getByRole("combobox", { name: "Widget identity", exact: true })
      .selectOption(identity);
    for (const size of [40, 88]) {
      await page.getByLabel("Launcher size", { exact: true }).fill(String(size));
      const launcher = frame.locator(".sd-launcher");
      await expect(launcher).toHaveCSS("width", `${size}px`);
      await expect(launcher).toHaveCSS("height", `${size}px`);
      await expect(launcher.locator(".sd-identity")).toHaveAttribute("data-identity", identity);
      if (identity === "default") {
        await expect(launcher.locator(".sd-identity")).toHaveCSS(
          "background-color",
          "rgb(255, 255, 255)",
        );
        await expect
          .poll(() =>
            launcher
              .locator("img")
              .evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
          )
          .toBe(true);
      }
      await launcher.screenshot({
        path: testInfo.outputPath(`launcher-${identity}-${size}.png`),
        animations: "disabled",
      });
    }
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/settings/widget") && response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Save design", exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await client.reload();
    await expect(client.locator(".sd-launcher .sd-identity")).toHaveAttribute(
      "data-identity",
      identity,
    );
    await expect(client.locator(".sd-launcher")).toHaveCSS("width", "88px");
    await client.screenshot({
      path: testInfo.outputPath(`client-${identity}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  // The saved custom asset stays available after choosing the built-in identities.
  await page.getByRole("combobox", { name: "Widget identity", exact: true }).selectOption("custom");
  await page.getByLabel("Launcher size", { exact: true }).fill("64");
  await page.getByRole("button", { name: "Save design", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("studio-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
});
