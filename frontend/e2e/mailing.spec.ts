/**
 * @file Optional real local SMTP integration journey using Mailpit and the Nodemailer worker
 * against the disposable browser-test API. Verify invitation creation, delivered temporary
 * credentials, required password replacement and confirmation mail. All child processes are
 * hidden/cleaned up, and the test skips explicitly when the Mailpit binary is unavailable.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const api = process.env.E2E_API_URL!;
const mailbox = "http://127.0.0.1:8090";
test.skip(!process.env.MAILPIT_BINARY, "Set MAILPIT_BINARY for the real, local SMTP integration");

/**
 * Authenticate a named synthetic fixture account through the real API and return only its
 * authorization header for test requests.
 */
async function login(request: APIRequestContext, email: string, password: string) {
  const response = await request.post(`${api}/auth/login`, { data: { email, password } });
  expect(response.status()).toBe(200);
  return { Authorization: `Bearer ${(await response.json()).access_token}` };
}

/**
 * Terminate a spawned SMTP/worker child only if still running and await exit so later tests
 * cannot inherit a bound port or delivery process.
 */
async function stop(child?: ChildProcess) {
  if (child && child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
}

test("durable invitation reaches SMTP, forces password change and sends a confirmation", async ({
  request,
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180000);
  const directory = mkdtempSync(join(tmpdir(), "supportdeflect-mail-test-"));
  let smtp: ChildProcess | undefined;
  let worker: ChildProcess | undefined;
  try {
    smtp = spawn(process.env.MAILPIT_BINARY!, [], {
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        MP_SMTP_BIND_ADDR: "127.0.0.1:1030",
        MP_UI_BIND_ADDR: "127.0.0.1:8090",
        MP_DATABASE: join(directory, "mail.db"),
        MP_DISABLE_VERSION_CHECK: "true",
        MP_SMTP_DISABLE_RDNS: "true",
      },
    });
    await expect
      .poll(async () => {
        try {
          return (await request.get(`${mailbox}/api/v1/messages`)).status();
        } catch {
          return 0;
        }
      })
      .toBe(200);
    const owner = await login(request, "owner0@example.com", process.env.E2E_ADMIN_PASSWORD!);
    const admin = await login(request, "operator@example.com", process.env.E2E_ADMIN_PASSWORD!);
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("owner0@example.com");
    await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/dashboard/team");
    await page.getByLabel("Full name", { exact: true }).fill("SMTP Agent");
    await page.getByLabel("Email", { exact: true }).fill("smtp-agent@example.com");
    const creation = page.waitForResponse(
      (response) =>
        response.url().endsWith("/team/users") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Invite member", exact: true }).click();
    const created = await creation;
    expect(created.status()).toBe(201);
    expect(await created.json()).not.toHaveProperty("password");
    const row = page.getByRole("row").filter({ hasText: "smtp-agent@example.com" });
    await expect(row).toContainText("Queued");
    worker = spawn(process.execPath, ["worker.mjs"], {
      cwd: resolve("../mailer"),
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        MAILER_API_URL: api,
        MAILER_SERVICE_TOKEN: "fixture-only-mailer-token-at-least-32-characters",
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: "1030",
        SMTP_ALLOW_INSECURE_LOCAL: "true",
        SMTP_FROM: "dhiaayed03@gmail.com",
      },
    });
    let messageId = "";
    await expect
      .poll(
        async () => {
          const list = await (await request.get(`${mailbox}/api/v1/messages`)).json();
          messageId =
            list.messages.find((message: { To: { Address: string }[] }) =>
              message.To.some((recipient) => recipient.Address === "smtp-agent@example.com"),
            )?.ID || "";
          return !!messageId;
        },
        { timeout: 120000, intervals: [1000, 2000] },
      )
      .toBe(true);
    const message = await (await request.get(`${mailbox}/api/v1/message/${messageId}`)).json();
    expect(message.From.Address).toBe("dhiaayed03@gmail.com");
    expect(message.HTML).toContain("cid:supportdeflect-logo");
    expect(message.Text).toContain("premiere connexion");
    // Never attach the invitation or credentials to test reports.
    let initial = /Mot de passe initial : ([^\r\n]+)/.exec(message.Text)?.[1];
    expect(!!initial).toBe(true);
    const agent = await login(request, "smtp-agent@example.com", initial!);
    const blocked = await request.get(`${api}/support-cases`, { headers: agent });
    expect(blocked.status()).toBe(403);
    await expect(row).toContainText("Captured locally", { timeout: 20000 });
    await expect(
      page.getByRole("status").filter({ hasText: "Local email capture only" }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("team-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath("team-mobile.png"), fullPage: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    // Renew through the actual UI and read only the replacement mail's password in memory.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await row.getByRole("button", { name: "Resend invitation to smtp-agent@example.com" }).click();
    await expect(
      page.getByText("Invitation renewed. Previous credentials are no longer valid."),
    ).toBeVisible();
    expect(
      (
        await request.post(`${api}/auth/login`, {
          data: { email: "smtp-agent@example.com", password: initial },
        })
      ).status(),
    ).toBe(401);
    await expect
      .poll(
        async () => {
          const list = await (await request.get(`${mailbox}/api/v1/messages`)).json();
          const replacement = list.messages.find(
            (mail: { ID: string; To: { Address: string }[] }) =>
              mail.ID !== messageId &&
              mail.To.some((to) => to.Address === "smtp-agent@example.com"),
          );
          if (!replacement) return false;
          const replacementMail = await (
            await request.get(`${mailbox}/api/v1/message/${replacement.ID}`)
          ).json();
          initial = /Mot de passe initial : ([^\r\n]+)/.exec(replacementMail.Text)?.[1];
          return !!initial;
        },
        { timeout: 45000 },
      )
      .toBe(true);
    const agentContext = await browser.newContext();
    try {
      const agentPage = await agentContext.newPage();
      await agentPage.goto(new URL("/login", page.url()).href);
      await agentPage.getByLabel("Email", { exact: true }).fill("smtp-agent@example.com");
      await agentPage.getByLabel("Password", { exact: true }).fill(initial!);
      await agentPage.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(agentPage).toHaveURL(/\/change-password$/);
      await agentPage.getByLabel("Current password", { exact: true }).fill(initial!);
      await agentPage
        .getByLabel("New password", { exact: true })
        .fill("Changed-fixture-password-2026!");
      await agentPage
        .getByLabel("Confirm new password", { exact: true })
        .fill("Changed-fixture-password-2026!");
      await agentPage.getByRole("button", { name: "Save new password", exact: true }).click();
      await expect(agentPage).toHaveURL(/\/dashboard\/inbox$/);
      await expect(
        agentPage.getByRole("heading", { name: "Support Inbox", exact: true }),
      ).toBeVisible();
    } finally {
      await agentContext.close();
    }
    await expect(row).toContainText("Active", { timeout: 20000 });
    expect((await request.get(`${api}/support-cases`, { headers: agent })).status()).toBe(401);
    const activated = await login(
      request,
      "smtp-agent@example.com",
      "Changed-fixture-password-2026!",
    );
    expect((await request.get(`${api}/support-cases`, { headers: activated })).status()).toBe(200);
    expect((await request.get(`${api}/team/mail-status`, { headers: activated })).status()).toBe(
      403,
    );
    expect((await request.get(`${api}/team/users`, { headers: owner })).status()).toBe(200);
    expect(
      (
        await request.post(`${api}/auth/login`, {
          data: { email: "smtp-agent@example.com", password: initial },
        })
      ).status(),
    ).toBe(401);
    await expect
      .poll(async () => {
        const status = await (
          await request.get(`${api}/platform/mail/status`, { headers: admin })
        ).json();
        return status.detail;
      })
      .toBe("local_capture");
    await expect
      .poll(
        async () => {
          const list = await (await request.get(`${mailbox}/api/v1/messages`)).json();
          return list.messages.filter((item: { To: { Address: string }[] }) =>
            item.To.some((recipient) => recipient.Address === "smtp-agent@example.com"),
          ).length;
        },
        { timeout: 45000 },
      )
      .toBe(3);
  } finally {
    await stop(worker);
    await stop(smtp);
  }
});
