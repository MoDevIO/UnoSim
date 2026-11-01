import { expect, test, type Page } from "@playwright/test";

const revision = "a".repeat(40);
const source = { selection: "default", mode: "repository-ref", repository: "owner/course", ref: "main", revision, status: "remote", stale: false };
const remoteExample = {
  id: "kurs-beispiel", title: "Kursbeispiel", category: "Kurs", main: "kurs.ino", source: "external",
  repository: source.repository, ref: source.ref, revision,
  files: [{ name: "kurs.ino", path: "examples/kurs.ino" }],
};
const answerField = (page: Page) => page.locator("#tutor-answer");

const editorValue = (page: Page) => page.evaluate(() => (
  (globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__ as { getValue(): string }
).getValue());

async function openTutor(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("unoExperimentalWorkspaceLayout", "1");
    localStorage.setItem("unoExperimentalWorkspaceColumns", JSON.stringify({ code: true, simulation: false, tutor: true }));
  });
  await page.route(/\/api\/examples(?:\?.*)?$/, (route) => route.fulfill({ json: { schemaVersion: 1, source, examples: [remoteExample] } }));
  await page.route("**/api/tutor/models", (route) => route.fulfill({ json: { models: ["pilot-model"] } }));
  await page.route("**/api/tutor/question", (route) => route.fulfill({
    json: {
      question: "Welche Aufgabe hat `pinMode`?", topic: "Der Pin", responseStyle: "normal", questionId: "pin-q1", topicId: "inline-kurs-beispiel",
      provider: "kiconnect", model: "pilot-model",
      focusProgress: { state: "active", understoodAreas: 0, totalAreas: 2, openAreas: ["Der Pin", "Die Werte"] },
    },
  }));
  await page.goto("/");
  await page.waitForFunction(() => Boolean((globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__));
  const mobileTab = page.getByRole("button", { name: "Tutor", exact: true });
  if (await mobileTab.isVisible()) await mobileTab.click();
  await expect(page.getByTestId("tutor-panel")).toBeVisible();
  await page.getByTestId("tutor-api-key-action").click();
  await page.getByLabel("API key", { exact: true }).fill("test-key");
  await page.getByTestId("tutor-apply-key").click();
}

async function askQuestion(page: Page) {
  await page.getByTestId("tutor-new-question-action").click();
  await expect(page.getByTestId("tutor-question")).toContainText("pinMode");
}

async function openBuiltIn(page: Page) {
  await page.getByRole("button", { name: "Examples", exact: true }).click();
  await page.getByRole("button", { name: "Built-in", exact: true }).click();
}

test.describe("Tutor learning flow", () => {
  test("names the action and shows who asks, and how far the learner got", async ({ page }) => {
    await openTutor(page);
    const action = page.getByTestId("tutor-new-question-action");
    await expect(action).toHaveAttribute("aria-label", /^New question\. /);
    await askQuestion(page);

    await expect(action).toHaveAttribute("aria-label", /^New question, ends dialog\. /);
    await expect(page.getByTestId("tutor-focus-status")).toHaveText("Teacher's focus: 0 of 2 areas understood");
  });

  test("keeps a typed answer when the catalog of the Examples menu arrives or is refreshed", async ({ page }) => {
    await openTutor(page);
    await askQuestion(page);
    await answerField(page).fill("Mein Entwurf");

    await page.getByRole("button", { name: "Examples", exact: true }).click();
    await expect(page.getByRole("button", { name: "Built-in", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(answerField(page)).toHaveValue("Mein Entwurf");
    await expect(page.getByTestId("tutor-question")).toContainText("pinMode");
  });

  test("starts over when an example is taken over, also the one that is already loaded", async ({ page }) => {
    await openTutor(page);
    for (let round = 0; round < 2; round += 1) {
      await askQuestion(page);
      await answerField(page).fill("Alter Entwurf");
      await openBuiltIn(page);
      await page.getByRole("button", { name: /01-blink\.ino/ }).click();
      await expect.poll(() => editorValue(page)).toContain("PIN_LED");

      await expect(page.getByTestId("tutor-question")).toHaveCount(0);
      await expect(answerField(page)).toHaveValue("");
    }
  });

  test("keeps an edit made while an example loads", async ({ page }) => {
    await openTutor(page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route(/\/api\/examples\/builtin-01-blink-ino$/, async (route) => {
      await held;
      await route.continue();
    });
    await openBuiltIn(page);
    await page.getByRole("button", { name: /01-blink\.ino/ }).click();
    await page.keyboard.press("Escape");
    await page.evaluate(() => ((globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__ as { setValue(value: string): void }).setValue("// meine Aenderung\nvoid setup() {}\nvoid loop() {}\n"));
    await expect.poll(() => editorValue(page)).toContain("meine Aenderung");

    release();
    await page.waitForResponse(/\/api\/examples\/builtin-01-blink-ino$/);
    await expect.poll(() => editorValue(page)).toContain("meine Aenderung");
    expect(await editorValue(page)).not.toContain("PIN_LED");
  });

  test("stays readable in a narrow window with XXL text", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.addInitScript(() => localStorage.setItem("unoFontScale", "1.5"));
    await openTutor(page);
    await page.route("**/api/tutor/question", (route) => route.fulfill({
      json: {
        question: "Warum liefert `werte[2]` nicht das zweite Element?", responseStyle: "normal", provider: "kiconnect", model: "pilot-model",
        focusProgress: { state: "open", understoodAreas: 1, totalAreas: 3, openAreas: ["Indizierung mit einem langen Bereichstitel", "Zeitpunkte mit einem zweiten langen Titel"] },
      },
    }));
    await page.getByTestId("tutor-new-question-action").click();
    const status = page.getByTestId("tutor-focus-status");
    await expect(status).toContainText("Open: Indizierung");
    await page.screenshot({ path: "test-results/tutor-narrow-xxl.png" });

    const fits = await status.evaluate((element) => {
      const scroller = element.closest('[data-testid="tutor-dialog-scroll"]') as HTMLElement;
      const box = element.getBoundingClientRect();
      return box.left >= 0 && box.right <= globalThis.innerWidth + 1 && scroller.scrollWidth <= scroller.clientWidth + 1;
    });
    expect(fits).toBe(true);
  });
});
