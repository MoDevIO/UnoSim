import { expect, test } from "@playwright/test";

test.describe("Tutor status indicator", () => {
  test("stops the active question animation when reduced motion is requested", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("unoExperimentalWorkspaceLayout", "1");
      localStorage.setItem(
        "unoExperimentalWorkspaceColumns",
        JSON.stringify({ code: true, simulation: true, tutor: true }),
      );
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const tutorPanel = page.getByTestId("tutor-panel");
    const statusIcon = page.getByTestId("tutor-status-icon");
    await expect(tutorPanel).toBeVisible();
    await expect(statusIcon).toHaveAttribute("aria-label", "Tutor nicht eingerichtet");
    await expect.poll(() => page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);

    await page.route("**/api/tutor/models", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: ["pilot-model"] }),
      });
    });
    await page.getByTestId("tutor-setup-action").click();
    await page.getByLabel("API-Key", { exact: true }).fill("test-key");
    await page.getByTestId("tutor-apply-key").click();
    await expect(statusIcon).toHaveAttribute("aria-label", "Tutor bereit");

    let releaseQuestionRequest!: () => void;
    const questionRequest = new Promise<void>((resolve) => {
      releaseQuestionRequest = resolve;
    });
    await page.route("**/api/tutor/question", async (route) => {
      await questionRequest;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          question: "What do you observe?",
          difficulty: 30,
          provider: "kiconnect",
          model: "pilot-model",
        }),
      });
    });

    await page.getByTestId("tutor-start-question").click();
    await expect(statusIcon).toHaveAttribute("aria-label", "Tutor erstellt eine Frage");
    await expect(page.getByTestId("tutor-pending")).toHaveText("Tutor erstellt eine Frage …");

    const reducedMotionStyle = await statusIcon.locator("svg").evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: style.width,
        height: style.height,
        animationName: style.animationName,
        animationDuration: style.animationDuration,
        animationPlayState: style.animationPlayState,
      };
    });
    expect(reducedMotionStyle).toMatchObject({
      width: "20px",
      height: "20px",
      animationName: "none",
      animationDuration: "0s",
      animationPlayState: "running",
    });

    releaseQuestionRequest();
    await expect(statusIcon).toHaveAttribute("aria-label", "Tutor wartet auf deine Antwort");
    await expect.poll(async () => page.getByTestId("tutor-panel").locator("svg").count()).toBeGreaterThan(0);
  });
});
