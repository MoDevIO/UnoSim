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

async function openTutor(page: Page, columns = { code: true, simulation: false, tutor: true }) {
  await page.addInitScript((visible) => {
    localStorage.setItem("unoExperimentalWorkspaceLayout", "1");
    localStorage.setItem("unoExperimentalWorkspaceColumns", JSON.stringify(visible));
  }, columns);
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
  await expect(page.getByTestId("tutor-transparency")).toContainText("KI:connect.nrw");
  await page.getByTestId("tutor-setup-action").click();
  await page.getByLabel("API-Key", { exact: true }).fill("test-key");
  await page.getByTestId("tutor-apply-key").click();
}

async function askQuestion(page: Page) {
  await page.getByTestId("tutor-start-question").click();
  await expect(page.getByTestId("tutor-question")).toContainText("pinMode");
}

async function openBuiltIn(page: Page) {
  await page.getByRole("button", { name: "Examples", exact: true }).click();
  await page.getByRole("button", { name: "Built-in", exact: true }).click();
}

test.describe("Tutor learning flow", () => {
  test("keeps the learning step free of who asks; the history says it and returns to the draft", async ({ page }) => {
    await openTutor(page);
    await askQuestion(page);
    await expect(page.getByTestId("tutor-focus-status")).toHaveCount(0);
    await answerField(page).fill("Mein Entwurf");

    await page.getByTestId("tutor-history-action").click();
    await expect(page.getByTestId("tutor-focus-status")).toHaveText("Fokus der Lehrkraft: 0 von 2 Bereichen verstanden");
    await page.getByTestId("tutor-back-to-question").click();
    await expect(answerField(page)).toHaveValue("Mein Entwurf");

    // Settings and back keep the draft as well; a new round is a deliberate, labelled reset in the menu.
    await page.getByTestId("tutor-menu").click();
    await page.getByRole("menuitem", { name: /Einstellungen/ }).click();
    await page.getByTestId("tutor-settings-back").click();
    await expect(answerField(page)).toHaveValue("Mein Entwurf");
    await page.getByTestId("tutor-menu").click();
    await expect(page.getByRole("menuitem", { name: /Neue Lernrunde starten/ })).toContainText("setzt Verlauf und Lernstand zurück");
    await page.keyboard.press("Escape");
    await expect(answerField(page)).toHaveValue("Mein Entwurf");
  });

  test("opens the menu again while the menu just closed still fades out", async ({ page }) => {
    await openTutor(page);
    await askQuestion(page);
    // Slowed down, the 150 ms fade-out of the closed menu outlasts the next click for certain.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Animation.enable");
    await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.05 });

    await page.getByTestId("tutor-menu").click();
    await page.getByRole("menuitem", { name: /Einstellungen/ }).click();
    await page.getByTestId("tutor-settings-back").click();
    await expect(page.locator('[role="menu"][data-state="closed"]')).toHaveCount(1);
    await page.getByTestId("tutor-menu").click();
    await expect(page.getByRole("menuitem", { name: /Neue Lernrunde starten/ })).toBeVisible();
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
      await expect(answerField(page)).toHaveCount(0);
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
    await page.getByTestId("tutor-start-question").click();
    const question = page.getByTestId("tutor-question");
    await expect(question).toContainText("werte[2]");
    await expect(answerField(page)).toBeVisible();
    await expect(page.getByTestId("tutor-send-answer")).toBeVisible();
    await page.screenshot({ path: "test-results/tutor-narrow-xxl.png" });
    const fitsIn = (testId: string, scrollerTestId: string) => page.getByTestId(testId).evaluate((element, scrollerId) => {
      const scroller = element.closest(`[data-testid="${scrollerId}"]`) as HTMLElement;
      const box = element.getBoundingClientRect();
      return box.left >= 0 && box.right <= globalThis.innerWidth + 1 && scroller.scrollWidth <= scroller.clientWidth + 1;
    }, scrollerTestId);
    expect(await fitsIn("tutor-question", "tutor-dialog-scroll")).toBe(true);
    expect(await fitsIn("tutor-send-answer", "tutor-dialog-scroll")).toBe(true);

    await page.getByTestId("tutor-history-action").click();
    await expect(page.getByTestId("tutor-focus-status")).toContainText("Offen: Indizierung");
    expect(await fitsIn("tutor-focus-status", "tutor-history-view")).toBe(true);
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

    await page.getByTestId("tutor-start-question").click();
    await expect(page.getByTestId("tutor-question")).toContainText("ersten Durchlauf");
    const help = page.getByTestId("tutor-help-toggle");
    // Keyboard only: the help opens without a request and offers only what is possible now.
    const supportRequests = actionIds.length;
    await help.focus();
    await page.keyboard.press("Enter");
    await expect(help).toHaveAttribute("aria-expanded", "true");
    expect(actionIds).toHaveLength(supportRequests);
    await expect(page.getByTestId("tutor-action-skip")).toHaveCount(0);
    await expect(page.getByTestId("tutor-action-reveal")).toHaveCount(0);
    await page.getByText("Wann gibt es weitere Hilfen?").click();
    await expect(page.getByTestId("tutor-skip-reason")).toHaveText("Überspringen: nach 2 Erklärungen der Frage (noch 2). Hinweise zählen nicht dazu.");

    const explain = page.getByTestId("tutor-action-clarify");
    for (let round = 1; round <= 2; round += 1) {
      await explain.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("tutor-clarification")).toContainText(`Erklärung ${round}`);
    }
    await expect(page.getByTestId("tutor-clarification")).toContainText("unbewertet");
    await expect(page.getByTestId("tutor-unlock-notice")).toContainText("„Frage überspringen“");
    await expect(page.getByTestId("tutor-answer-rating")).toHaveCount(0);
    await expect(page.getByTestId("tutor-action-reveal")).toHaveCount(0);
    await page.getByTestId("tutor-action-skip").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tutor-previous-feedback")).toContainText("Vorige Frage übersprungen, unbewertet");
    await expect(page.getByTestId("tutor-question")).toContainText("von 7 herunter");

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await expect(page.getByTestId("tutor-action-reveal")).toHaveCount(0);
      await answerField(page).fill(`Versuch ${attempt}`);
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("tutor-current-step")).toContainText(`Versuch ${attempt}`);
      await expect(answerField(page)).toHaveValue("");
    }
    await expect(page.getByTestId("tutor-unlock-notice")).toContainText("„Musterantwort ansehen“");
    if (await page.getByTestId("tutor-support-actions").count() === 0) await help.click();
    await page.getByTestId("tutor-action-reveal").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tutor-reference")).toContainText("als Lösungshilfe genutzt");
    await expect(page.getByTestId("tutor-reference")).toContainText("Annahmen: a = 200");
    await page.screenshot({ path: "test-results/tutor-help-reference.png" });

    // The ratings are in the history; back to the question from there.
    await page.getByTestId("tutor-history-action").click();
    await expect(page.getByTestId("tutor-answer-rating")).toHaveCount(3);
    await page.getByTestId("tutor-back-to-question").click();
    await expect(page.getByTestId("tutor-question")).toContainText("von 7 herunter");
    // Every learner action had its own id.
    expect(new Set(actionIds).size).toBe(actionIds.length);
  });

  test("a failed answer keeps the draft and offers a retry that sends it again", async ({ page }) => {
    await openTutor(page);
    let calls = 0;
    await page.route("**/api/tutor/dialog", (route) => {
      calls += 1;
      if (calls === 1) return route.fulfill({ status: 504, json: { error: { code: "PROVIDER_TIMEOUT", message: "late" } } });
      return route.fulfill({ json: { responseStyle: "normal", question: "Welche Aufgabe hat `pinMode`?", feedback: "Fast.", answerRating: 3, learnerInput: "answer", provider: "kiconnect", model: "pilot-model" } });
    });
    await askQuestion(page);
    await answerField(page).fill("Er setzt den Pin");
    await page.getByTestId("tutor-send-answer").click();
    await expect(page.getByTestId("tutor-error").getByRole("alert")).toHaveText("Der Tutor-Dienst hat zu lange nicht geantwortet.");
    await expect(answerField(page)).toHaveValue("Er setzt den Pin");
    await page.getByRole("button", { name: "Erneut versuchen" }).click();
    await expect(page.getByTestId("tutor-current-step")).toContainText("Fast.");
    expect(calls).toBe(2);
  });

  // Every unlocked help, with XXL text: on a phone beside the mobile navigation, and in a narrow third column (review R3).
  for (const layout of [
    { name: "a 320 px phone", width: 320, height: 640, columns: { code: true, simulation: false, tutor: true } },
    { name: "a short desktop with three columns", width: 1100, height: 360, columns: { code: true, simulation: true, tutor: true } },
  ]) {
    test(`learning support: all unlocked actions fit ${layout.name} with XXL text`, async ({ page }) => {
      await page.setViewportSize({ width: layout.width, height: layout.height });
      await page.addInitScript(() => localStorage.setItem("unoFontScale", "1.5"));
      await openTutor(page, layout.columns);
      await page.route("**/api/tutor/question", (route) => route.fulfill({
        json: {
          question: "Was wird im ersten Durchlauf ausgegeben?", responseStyle: "normal", provider: "kiconnect", model: "pilot-model",
          support: {
            session: "11111111-1111-4111-8111-111111111111", questionHandle: "22222222-2222-4222-8222-222222222222", answerAttempts: 3, clarifications: 2,
            canRevealReference: true, canSkip: true, referenceAvailable: true, referenceShown: false, outcome: "open",
          },
        },
      }));
      await page.getByTestId("tutor-start-question").click();
      await page.getByTestId("tutor-help-toggle").click();
      const help = page.getByTestId("tutor-support-actions");
      await expect(help.getByRole("button")).toHaveCount(4);
      await help.getByText("Wann gibt es weitere Hilfen?").click();
      await help.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/tutor-help-xxl-${layout.width}.png` });

      const problems = await help.evaluate((element) => {
        const found: string[] = [];
        const scroller = element.closest('[data-testid="tutor-dialog-scroll"]') as HTMLElement;
        const area = element.getBoundingClientRect();
        const fab = document.querySelector("[data-mobile-fab-toolbar]")?.getBoundingClientRect();
        if (scroller.scrollWidth > scroller.clientWidth + 1) found.push(`scroller overflows by ${scroller.scrollWidth - scroller.clientWidth}px`);
        if (area.left < 0 || area.right > globalThis.innerWidth + 1) found.push("help area leaves the window");
        if (fab && fab.width > 0 && area.right > fab.left + 1) found.push("help area reaches under the mobile navigation");
        for (const button of element.querySelectorAll("button")) {
          const box = button.getBoundingClientRect();
          const name = button.textContent?.trim();
          if (box.left < area.left - 1 || box.right > area.right + 1) found.push(`${name} leaves the help area`);
          if (button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1) found.push(`${name} is clipped`);
        }
        return found;
      });
      expect(problems).toEqual([]);
    });
  }
});
