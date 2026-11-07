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

  test("learning support: two explanations allow skipping, three own answers the reference answer, all by keyboard", async ({ page }) => {
    // A minimal stand-in for the server's support state (the server side is covered by HTTP tests).
    const ids = { session: "11111111-1111-4111-8111-111111111111", first: "22222222-2222-4222-8222-222222222222", second: "33333333-3333-4333-8333-333333333333" };
    const state = { handle: ids.first, question: "Was wird im ersten Durchlauf ausgegeben, wenn `a` den Wert 200 hat?", attempts: 0, clarifications: 0, shown: false };
    const view = () => ({
      session: ids.session, questionHandle: state.handle, answerAttempts: state.attempts, clarifications: state.clarifications,
      canRevealReference: state.attempts >= 3, canSkip: state.clarifications >= 2, referenceAvailable: true, referenceShown: state.shown, outcome: "open",
    });
    const actionIds: string[] = [];
    await openTutor(page);
    await page.route("**/api/tutor/question", (route) => route.fulfill({
      json: { question: state.question, responseStyle: "normal", provider: "kiconnect", model: "pilot-model", support: view() },
    }));
    await page.route("**/api/tutor/support", async (route) => {
      const body = route.request().postDataJSON() as { action: string; actionId: string; questionHandle: string };
      actionIds.push(body.actionId);
      if (body.questionHandle !== state.handle) return route.fulfill({ status: 409, json: { error: { code: "SUPPORT_CONFLICT", message: "x" } } });
      if (body.action === "clarify") {
        state.clarifications += 1;
        return route.fulfill({ json: { action: "clarify", explanation: `Erklärung ${state.clarifications}: gemeint ist der Durchlauf mit i = 7.`, provider: "kiconnect", model: "pilot-model", support: view() } });
      }
      if (body.action === "reveal") {
        state.shown = true;
        return route.fulfill({ json: { action: "reveal", reference: { status: "available", answer: "1", explanation: "1 << 7 = 128 und 200 & 128 = 128, also gibt Serial.print 1 aus.", assumptions: ["a = 200"] }, provider: "kiconnect", model: "pilot-model", support: view() } });
      }
      state.handle = ids.second;
      state.question = "Warum zählt die Schleife mit `i--` von 7 herunter?";
      state.attempts = 0;
      state.clarifications = 0;
      return route.fulfill({ json: { action: "skip", next: { question: state.question, responseStyle: "normal" }, provider: "kiconnect", model: "pilot-model", support: view() } });
    });
    await page.route("**/api/tutor/dialog", (route) => {
      state.attempts += 1;
      return route.fulfill({ json: { responseStyle: "normal", question: state.question, feedback: "Noch nicht ganz.", answerRating: 2, learnerInput: "answer", provider: "kiconnect", model: "pilot-model", support: view() } });
    });

    await page.getByTestId("tutor-new-question-action").click();
    await expect(page.getByTestId("tutor-question")).toContainText("ersten Durchlauf");
    await expect(page.getByTestId("tutor-action-skip")).toBeDisabled();
    await expect(page.getByTestId("tutor-skip-reason")).toHaveText("Skipping after 2 explanations of the question (2 more).");

    // Keyboard only: focus the explain action and press Enter twice.
    const explain = page.getByTestId("tutor-action-clarify");
    for (let round = 1; round <= 2; round += 1) {
      await explain.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("tutor-clarification")).toHaveCount(round);
    }
    await expect(page.getByTestId("tutor-clarification").last()).toContainText("not rated");
    await expect(page.getByTestId("tutor-answer-rating")).toHaveCount(0);
    await expect(page.getByTestId("tutor-action-reveal")).toBeDisabled();
    await expect(page.getByTestId("tutor-action-skip")).toBeEnabled();
    await page.getByTestId("tutor-action-skip").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tutor-skip-note")).toContainText("Question skipped, not rated");
    await expect(page.getByTestId("tutor-question")).toContainText("von 7 herunter");

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await expect(page.getByTestId("tutor-action-reveal")).toBeDisabled();
      await answerField(page).fill(`Versuch ${attempt}`);
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("tutor-support-status")).toContainText(`Own answers: ${attempt}`);
    }
    await expect(page.getByTestId("tutor-reveal-reason")).toHaveText("Reference answer with explanation available on request.");
    await page.getByTestId("tutor-action-reveal").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tutor-reference")).toContainText("used as solution help");
    await expect(page.getByTestId("tutor-reference")).toContainText("Assumes: a = 200");
    // Every learner action had its own id.
    expect(new Set(actionIds).size).toBe(actionIds.length);
  });

  test("learning support: the actions fit a narrow window with XXL text", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.addInitScript(() => localStorage.setItem("unoFontScale", "1.5"));
    await openTutor(page);
    await page.route("**/api/tutor/question", (route) => route.fulfill({
      json: {
        question: "Was wird im ersten Durchlauf ausgegeben?", responseStyle: "normal", provider: "kiconnect", model: "pilot-model",
        support: {
          session: "11111111-1111-4111-8111-111111111111", questionHandle: "22222222-2222-4222-8222-222222222222", answerAttempts: 1, clarifications: 1,
          canRevealReference: false, canSkip: false, referenceAvailable: true, referenceShown: false, outcome: "open",
        },
      },
    }));
    await page.getByTestId("tutor-new-question-action").click();
    const actions = page.getByTestId("tutor-support-actions");
    await expect(actions).toBeVisible();
    const fits = await actions.evaluate((element) => {
      const scroller = element.closest('[data-testid="tutor-dialog-scroll"]') as HTMLElement;
      const box = element.getBoundingClientRect();
      return box.left >= 0 && box.right <= globalThis.innerWidth + 1 && scroller.scrollWidth <= scroller.clientWidth + 1;
    });
    expect(fits).toBe(true);
  });
});
