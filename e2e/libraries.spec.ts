import { expect, test, type Page } from "@playwright/test";

// End-to-end check of the project libraries (ssot/ssot_function_definition_Libraries.md):
// the dialog from the Sketch menu, "Einbinden" of AUnit, a real compile with the
// provisioned package and the AUnit results in the serial monitor of a browser run.

const ENGINE_KEY = "unoSimulationEngine";
const COMPILE_TIMEOUT = process.env.CI ? 120_000 : 60_000;

const TESTS = `
test(addition) {
  assertEqual(2 + 3, 5);
}

test(wrong) {
  assertEqual(2 + 2, 5);
}

void setup() {
  Serial.begin(115200);
}

void loop() {
  aunit::TestRunner::run();
}
`;

async function open(page: Page, engine: "browser" | "host-mock"): Promise<void> {
  await page.addInitScript(([key, value]) => globalThis.localStorage.setItem(key, value), [ENGINE_KEY, engine]);
  await page.goto("/");
  await page.waitForFunction(() => Boolean((globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__), undefined, { timeout: 15_000 });
}

const editorValue = (page: Page) => page.evaluate(() =>
  ((globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__ as { getValue: () => string }).getValue());

async function setSketch(page: Page, code: string): Promise<void> {
  await page.evaluate((sketch) => {
    ((globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__ as { setValue: (value: string) => void }).setValue(sketch);
  }, code);
}

/** "Libraries (n)" sits in the options menu of the file tabs (SSOT Libraries §5.1). */
async function expectLibrariesCount(page: Page, count: number): Promise<void> {
  await page.getByTitle("Options").click();
  await expect(page.getByRole("menuitem", { name: `Libraries (${count})` })).toBeVisible();
  await page.keyboard.press("Escape");
}

async function includeAUnit(page: Page): Promise<void> {
  await page.getByRole("menuitem", { name: "Sketch" }).click();
  await page.getByRole("menuitem", { name: "Libraries…" }).click();
  const dialog = page.getByRole("dialog", { name: "Libraries" });
  await dialog.getByRole("searchbox", { name: "Bibliotheken durchsuchen" }).fill("aunit");
  await dialog.getByRole("button", { name: /AUnit 1\.7\.1/ }).click();
  await dialog.getByRole("button", { name: "Einbinden" }).click();
  await expect(dialog).toBeHidden();
}

test.describe("project libraries (SSOT Libraries)", () => {
  test("Einbinden adds AUnit and its include; the browser run prints the AUnit results", async ({ page }) => {
    await open(page, "browser");
    await expectLibrariesCount(page, 0);
    await setSketch(page, TESTS);

    await includeAUnit(page);

    await expectLibrariesCount(page, 1);
    expect(await editorValue(page)).toBe(`\n#include <AUnit.h>\n${TESTS}`);
    await page.getByRole("button", { name: /start simulation/i }).click();
    const serial = page.locator('[data-testid="serial-output"]');
    await expect(serial).toContainText("TestRunner summary: 1 passed, 1 failed, 0 skipped, 0 timed out, out of 2 test(s).", { timeout: COMPILE_TIMEOUT });
    await expect(serial).toContainText("Assertion failed: (4) == (5).");
    await expect(serial).not.toContainText("/tmp/");
  });

  test("a written include gets a hint, and adding the package keeps the source", async ({ page }) => {
    await open(page, "browser");
    const code = `#include <AUnit.h>\n${TESTS}`;
    await setSketch(page, code);

    await expect(page.getByText("AUnit.h erkannt. AUnit fehlt noch in den Projektbibliotheken.")).toBeVisible();
    await page.getByRole("button", { name: "AUnit 1.7.1 hinzufügen" }).click();

    await expectLibrariesCount(page, 1);
    await expect(page.getByText("AUnit.h erkannt.")).toBeHidden();
    expect(await editorValue(page)).toBe(code);
  });

  test("list entries and the target file are not clipped, also with a long file path", async ({ page }) => {
    await open(page, "browser");
    await page.getByRole("menuitem", { name: "Sketch" }).click();
    await page.getByRole("menuitem", { name: "Libraries…" }).click();
    const dialog = page.getByRole("dialog", { name: "Libraries" });
    const entry = dialog.getByRole("button", { name: /AUnit 1\.7\.1/ });

    const clipped = (element: HTMLElement) => element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth;
    expect(await entry.evaluate(clipped)).toBe(false);

    await entry.click();
    const details = dialog.getByRole("region", { name: "AUnit 1.7.1" });
    const target = details.getByText(/^in \S+$/);
    await expect(target).toBeVisible();
    // A file deep in folders, as in the reported screenshot; the details must wrap it, not overflow.
    await target.evaluate((element) => { element.textContent = `in ${"libraries/AUnit/AUnitMinimal/".repeat(4)}AUnitMinimal.ino`; });
    expect(await details.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });

  test("the Legacy engine names why AUnit does not run there and does not start it", async ({ page }) => {
    let compileRequests = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/compile")) compileRequests++;
    });
    await open(page, "host-mock");
    await setSketch(page, TESTS);
    await includeAUnit(page);

    await page.getByRole("menuitem", { name: "Sketch" }).click();
    await page.getByRole("menuitem", { name: "Libraries…" }).click();
    const dialog = page.getByRole("dialog", { name: "Libraries" });
    await dialog.getByRole("button", { name: /AUnit 1\.7\.1/ }).click();
    await expect(dialog.getByText(/^Simulation \(Legacy\): nicht unterstützt – /)).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /start simulation/i }).click();
    await page.waitForTimeout(1_000);
    expect(compileRequests).toBe(0);
    await expect(page.getByRole("button", { name: /stop simulation/i })).toBeHidden();
  });
});
