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
    const questionAction = page.getByTestId("tutor-new-question-action");
    await expect(tutorPanel).toBeVisible();
    await expect(questionAction).toHaveAttribute("aria-label", "Tutor not ready");
    await expect.poll(() => page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);

    await page.route("**/api/tutor/models", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: ["pilot-model"] }),
      });
    });
    await page.getByTestId("tutor-api-key-action").click();
    await page.getByLabel("API key", { exact: true }).fill("test-key");
    await page.getByTestId("tutor-apply-key").click();
    await expect(questionAction).toHaveAttribute("aria-label", "Tutor ready");

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

    await questionAction.click();
    await expect(questionAction).toHaveAttribute("aria-label", "Tutor is generating a question");

    const reducedMotionStyle = await questionAction.locator("svg").evaluate((element) => {
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
    await expect(questionAction).toHaveAttribute("aria-label", "Tutor is waiting for your answer");
    await expect.poll(async () => page.getByTestId("tutor-panel").locator("svg").count()).toBeGreaterThan(0);
  });
});
