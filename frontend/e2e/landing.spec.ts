/** Public identity, real-widget simulation, responsive, accessibility and motion regressions. */
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import axe from "axe-core";

test("public identity, local fonts, anchors and account links", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Your knowledge.Their next answer.",
  );
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() => document.fonts.check('400 16px "Instrument Sans Variable"')),
  ).toBe(true);
  expect(
    await page.getByRole("heading", { level: 1 }).evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain("Instrument Sans Variable");
  expect(
    await page.evaluate(() =>
      Array.from(document.fonts).some(
        (font) => font.family === "Instrument Sans Variable" && font.status === "loaded",
      ),
    ),
  ).toBe(true);
  const logo = page.locator("header img");
  expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("landing-desktop.png") });
  await page.getByRole("link", { name: "Explore the demo", exact: true }).click();
  await expect(page.getByTestId("marketing-demo")).toBeInViewport();
  await page.getByRole("link", { name: "Log in", exact: false }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("login-desktop.png"), fullPage: true });
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole("button", { name: "Create workspace", exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("register-desktop.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("production widget scenarios, native composer and sources work without API or storage", async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
  });
  await page.route("**/api/**", (route) => route.abort());
  await page.goto("/");
  const demo = page.getByTestId("marketing-demo");
  const widget = page.frameLocator('iframe[title="Interactive support widget"]');
  await expect(demo.getByText("SIMULATION", { exact: true })).toBeVisible();
  await demo.getByRole("button", { name: /Customize the widget/ }).click();
  await expect(widget.locator(".sd-assistant").last()).toContainText("Open Widget Design Studio");
  await widget.getByText("Sources (1)").click();
  await expect(widget.locator(".sd-sources p")).toContainText("[1] Widget customization guide");
  await demo.getByRole("button", { name: /Find an answer/ }).click();
  await expect(widget.locator(".sd-assistant").last()).toContainText(
    "PDF, Markdown and plain-text",
  );
  await demo.getByRole("button", { name: /Bring in a human/ }).click();
  await expect(widget.getByText("Human support recommended", { exact: true })).toBeVisible();
  await expect(widget.getByText("Sent to the support team for review")).toHaveCount(0);
  const input = widget.getByRole("textbox", { name: "Your question" });
  await input.fill("A question outside the samples");
  await input.press("Enter");
  await expect(widget.locator(".sd-assistant").last()).toContainText("This is a scripted demo.");
  await expect(input).toBeFocused();
  await input.press("Escape");
  await expect(widget.getByRole("region", { name: "Support chat" })).toBeHidden();
  await widget.getByRole("button", { name: "Open support chat" }).click();
  await expect(input).toBeFocused();
  await demo.getByRole("button", { name: "Restart demo" }).click();
  await expect(widget.locator(".sd-message")).toHaveCount(1);
  await expect(widget.getByText("Hi! How can I help you today?")).toBeVisible();
  const noStorage = await widget.locator("body").evaluate(() => {
    try {
      void window.localStorage;
      return false;
    } catch {
      return true;
    }
  });
  expect(noStorage).toBe(true);
  expect(apiRequests).toEqual([]);
});

test("busy state prevents duplicate submissions and reset cancels pending replies", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const demo = page.getByTestId("marketing-demo");
  const widget = page.frameLocator('iframe[title="Interactive support widget"]');
  await demo.getByRole("button", { name: /Customize the widget/ }).click();
  await expect(widget.getByRole("textbox")).toBeDisabled();
  await expect(demo.getByRole("button", { name: /Find an answer/ })).toBeDisabled();
  await demo.getByRole("button", { name: "Restart demo" }).click();
  await expect(demo.getByRole("button", { name: /Find an answer/ })).toBeEnabled();
  await demo.getByRole("button", { name: /Find an answer/ }).click();
  await expect(widget.locator(".sd-assistant").last()).toContainText(
    "PDF, Markdown and plain-text",
  );
  await expect(widget.locator(".sd-user")).toHaveCount(1);
  await expect(widget.locator(".sd-assistant")).toHaveCount(2);
  await expect(widget.locator(".sd-assistant").last()).not.toContainText(
    "Open Widget Design Studio",
  );
});

test("mobile navigation supports keyboard, dismissal and working anchors", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Open navigation" });
  await toggle.click();
  const menu = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(menu.getByRole("link", { name: /Product/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(menu).toHaveCount(0);
  await toggle.click();
  await menu.getByRole("link", { name: /Pricing/ }).click();
  await expect(page.locator("#pricing")).toBeInViewport();
  await expect(menu).toHaveCount(0);
  await toggle.click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(menu).toHaveCount(0);
});

test("all three public pages fit every required viewport", async ({ page }, testInfo) => {
  test.setTimeout(150000);
  for (const width of [320, 375, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: width >= 1024 ? 1000 : 844 });
    for (const route of ["/", "/login", "/register"]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (route !== "/")
        await expect(
          page.getByRole("button", {
            name: route === "/login" ? "Sign in" : "Create workspace",
            exact: true,
          }),
        ).toBeEnabled();
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        `${route} at ${width}px`,
      ).toBeLessThanOrEqual(width);
      const clipped = await page.getByRole("heading", { level: 1 }).evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < 0 || rect.right > innerWidth;
      });
      expect(clipped).toBe(false);
      if (route === "/") {
        const navBounds = await page.locator(".sd-nav-inner").evaluate((element) => {
          const logo = element.querySelector(".sd-logo")!.getBoundingClientRect();
          const actions = element.querySelector(".sd-nav-actions")!.getBoundingClientRect();
          return { overlap: logo.right > actions.left, right: actions.right };
        });
        expect(navBounds.overlap, `navigation at ${width}px`).toBe(false);
        expect(navBounds.right).toBeLessThanOrEqual(width);
      }
      if ([320, 390, 768, 1440].includes(width))
        await page.screenshot({
          path: testInfo.outputPath(`${route.slice(1) || "landing"}-${width}.png`),
          fullPage: true,
        });
    }
  }
});

test("server content is readable without JavaScript and auth stays hydration-gated", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  for (const route of ["/", "/login", "/register"]) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(/SupportDeflect AI/);
    await expect(page.locator("canvas")).toHaveCount(0);
    if (route !== "/")
      await expect(
        page.getByRole("button", {
          name: route === "/login" ? "Sign in" : "Create workspace",
          exact: true,
        }),
      ).toBeDisabled();
  }
  await context.close();
});

test("reduced motion and missing WebGL retain the complete usable experience", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type.includes("webgl")) return null;
      return original.apply(this, [type, ...args] as Parameters<typeof original>);
    } as typeof original;
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.locator(".sd-answer-composition")).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /Customize the widget/ }).click();
  await expect(
    page.frameLocator('iframe[title="Interactive support widget"]').locator(".sd-assistant").last(),
  ).toContainText("Widget Design Studio");
  await page.goto("/login");
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("brand preview and use-case controls are actionable", async ({ page }) => {
  await page.goto("/");
  const blue = page.getByRole("button", { name: "Blue brand preview", exact: true });
  await blue.click();
  await expect(blue).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.frameLocator('iframe[title="Interactive support widget"]').locator(".sd-header"),
  ).toHaveCSS("background-color", "rgb(34, 109, 216)");
  const developer = page.getByRole("tab", { name: /Developer tools/ });
  await developer.click();
  await expect(developer).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("“Where is the configuration guide?”")).toBeVisible();
});

test("public routes and expanded demo meet automated WCAG AA checks", async ({ page }) => {
  for (const route of ["/", "/login", "/register"]) {
    await page.goto(route);
    if (route !== "/")
      await expect(
        page.getByRole("button", {
          name: route === "/login" ? "Sign in" : "Create workspace",
          exact: true,
        }),
      ).toBeEnabled();
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(audit.violations, route).toEqual([]);
  }
  await page.goto("/");
  const demo = page.getByTestId("marketing-demo");
  await demo.getByRole("button", { name: /Customize the widget/ }).click();
  await page
    .frameLocator('iframe[title="Interactive support widget"]')
    .getByText("Sources (1)")
    .click();
  // The opaque sandbox cannot join a parent-frame audit. Audit its real Shadow DOM
  // separately so chat contrast and semantics are checked rather than skipped.
  const widgetAudit = await page
    .frameLocator('iframe[title="Interactive support widget"]')
    .locator("body")
    .evaluate(async (_, source) => {
      const script = document.createElement("script");
      script.textContent = source;
      document.head.append(script);
      return (window as Window & { axe: typeof axe }).axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      });
    }, axe.source);
  expect(widgetAudit.violations).toEqual([]);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
});

test("section five, conversation transitions and mobile menu keep the layout stable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await expect(page.getByRole("tab", { name: /Developer tools/ })).toBeEnabled();
    const usecases = page.locator("#usecases");
    await page.evaluate(() =>
      window.scrollTo(0, document.getElementById("usecases")!.offsetTop - 100),
    );
    const height = (await usecases.boundingBox())!.height;
    for (const name of [/Developer tools/, /Commerce & help centers/, /SaaS & product teams/]) {
      const tab = page.getByRole("tab", { name });
      await tab.scrollIntoViewIfNeeded();
      const scroll = await page.evaluate(() => window.scrollY);
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      expect((await usecases.boundingBox())!.height).toBeCloseTo(height, 0);
      expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(scroll, 0);
    }
    const first = page.getByRole("tab", { name: /SaaS & product teams/ });
    await first.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("tab", { name: /Developer tools/ })).toBeFocused();
    const demo = page.getByTestId("marketing-demo");
    const demoHeight = (await demo.boundingBox())!.height;
    await demo.getByRole("button", { name: /Customize the widget/ }).click();
    await page
      .frameLocator('iframe[title="Interactive support widget"]')
      .getByText("Sources (1)")
      .click();
    expect((await demo.boundingBox())!.height).toBeCloseTo(demoHeight, 0);
    await demo.getByRole("button", { name: "Restart demo" }).click();
    expect((await demo.boundingBox())!.height).toBeCloseTo(demoHeight, 0);
    if (width < 900) {
      const heroTop = await page
        .locator(".sd-hero")
        .evaluate((el) => (el as HTMLElement).offsetTop);
      await page.getByRole("button", { name: "Open navigation" }).click();
      expect(await page.locator(".sd-hero").evaluate((el) => (el as HTMLElement).offsetTop)).toBe(
        heroTop,
      );
      await page.keyboard.press("Escape");
    }
  }
});
