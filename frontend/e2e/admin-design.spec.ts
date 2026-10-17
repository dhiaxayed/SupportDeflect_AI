/**
 * @file Browser verification of every super-admin view across mobile/desktop widths using the
 * seeded operator. Check real route rendering, shared brand/theme tokens, active navigation,
 * dialogs and overflow; record screenshots and fail on browser exceptions rather than
 * replacing the interface with snapshots alone.
 */

import { expect, test } from "@playwright/test";

const views = [
  ["/platform", "Business overview"],
  ["/platform/organizations", "Organizations"],
  ["/platform/subscriptions", "Subscriptions"],
  ["/platform/billing", "Revenue & payments"],
  ["/platform/usage", "Product analytics"],
  ["/platform/communications", "Communications"],
  ["/platform/health", "System health"],
  ["/platform/audit", "Audit trail"],
] as const;

test("administration shares the customer brand across every view and viewport", async ({
  page,
}, testInfo) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  const failedModules: { path: string; detail: string }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/"))
      failedModules.push({ path, detail: request.failure()?.errorText ?? "failed" });
  });
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (!path.startsWith("/api/") && response.status() >= 400)
      failedModules.push({ path, detail: String(response.status()) });
  });
  await page.goto("/login");
  try {
    await page.getByLabel("Email", { exact: true }).fill("operator@example.com");
  } catch (error) {
    // Retain cold-start diagnostics without query strings, headers, bodies or credentials.
    await testInfo.attach("client-startup.json", {
      body: JSON.stringify({ errors, failedModules }),
      contentType: "application/json",
    });
    throw error;
  }
  await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Business overview" })).toBeVisible();

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    for (const [route, heading] of views) {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(page.locator(".admin-shell [role=alert]")).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      const theme = await page.locator(".admin-shell").evaluate((element) => {
        const shared = getComputedStyle(document.documentElement);
        const admin = getComputedStyle(element);
        return {
          font: admin.fontFamily,
          primary: admin.getPropertyValue("--primary"),
          sharedPrimary: shared.getPropertyValue("--primary"),
          radius: admin.getPropertyValue("--radius"),
          sharedRadius: shared.getPropertyValue("--radius"),
          overflow: document.documentElement.scrollWidth > innerWidth,
          overflowWidth: document.documentElement.scrollWidth,
          overflowingElements: [...element.querySelectorAll("*")]
            .filter((child) => {
              if (child.getBoundingClientRect().right <= innerWidth) return false;
              for (
                let parent = child.parentElement;
                parent && parent !== element;
                parent = parent.parentElement
              ) {
                if (
                  ["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(parent).overflowX)
                )
                  return false;
              }
              return true;
            })
            .map((child) => ({
              tag: child.tagName,
              className: child.className,
              width: child.getBoundingClientRect().width,
            })),
        };
      });
      expect(theme.font).toContain("Inter");
      expect(theme.primary).toBe(theme.sharedPrimary);
      expect(theme.radius).toBe(theme.sharedRadius);
      expect(theme.overflow, `${route} at ${width}px: ${JSON.stringify(theme)}`).toBe(false);
      await expect(page.locator(".admin-nav-link.active")).toHaveCount(1);
      await expect(page.locator(".admin-nav-link.active")).toHaveCSS("border-radius", "8px");
      await expect(page.locator(".lucide-sparkles")).toHaveCount(0);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`${route.split("/").pop()}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.goto("/platform/organizations");
    await page.getByRole("button", { name: "New organization", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS("border-radius", "12px");
    expect(
      await dialog.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return (
          box.left >= 0 && box.right <= innerWidth && element.scrollWidth <= element.clientWidth
        );
      }),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`organization-dialog-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await page.getByRole("link", { name: "Atlas Commerce", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Atlas Commerce", exact: true })).toBeVisible();
    for (const tab of ["Account", "Subscription", "Activity"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await expect(page.locator(".admin-nav-link.active")).toHaveCount(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `Organization ${tab} at ${width}px`,
      ).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`organization-${tab.toLowerCase()}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.goto("/change-password");
    await expect(page.getByRole("heading", { name: "Change your password" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  expect(errors).toEqual([]);
});
