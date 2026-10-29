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

async function openDialog(page: Page) {
  await page.getByRole("menuitem", { name: "Sketch" }).click();
  await page.getByRole("menuitem", { name: "Libraries…" }).click();
  const dialog = page.getByRole("dialog", { name: "Libraries" });
  // Ready once the dialog moved the focus into its search.
  await expect(dialog.getByRole("searchbox", { name: "Bibliotheken durchsuchen" })).toBeFocused();
  return dialog;
}

const editorHasFocus = (page: Page) => page.evaluate(() =>
  ((globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__ as { hasTextFocus: () => boolean }).hasTextFocus());

const clipped = (element: HTMLElement) => element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1;

async function includeAUnit(page: Page): Promise<void> {
  const dialog = await openDialog(page);
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
    const dialog = await openDialog(page);
    const entry = dialog.getByRole("button", { name: /AUnit 1\.7\.1/ });

    expect(await entry.evaluate(clipped)).toBe(false);

    await entry.click();
    const details = dialog.getByRole("region", { name: "AUnit 1.7.1" });
    const target = details.getByText(/^Zieldatei: /);
    await expect(target).toBeVisible();
    // A file deep in folders, as in the reported screenshot; the details must wrap it, not overflow.
    await target.evaluate((element) => { element.textContent = `Zieldatei: ${"AUnitMinimalExampleWithAVeryLongName".repeat(4)}.ino`; });
    expect(await details.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });

  test("the dialog keeps its height while searching and selecting", async ({ page }) => {
    await open(page, "browser");
    const dialog = await openDialog(page);
    // Measured after the open animation, which scales the dialog.
    const box = async () => {
      await dialog.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
      return (await dialog.boundingBox())?.height;
    };

    const initial = await box();
    await dialog.getByRole("searchbox", { name: "Bibliotheken durchsuchen" }).fill("no such library");
    expect(await box()).toBe(initial);
    await dialog.getByRole("searchbox", { name: "Bibliotheken durchsuchen" }).fill("");
    await dialog.getByRole("button", { name: /AUnit 1\.7\.1/ }).click();
    expect(await box()).toBe(initial);
  });

  test("with XXL text on a narrow view, name, status and example title wrap instead of overflowing", async ({ page }) => {
    await page.addInitScript(() => globalThis.localStorage.setItem("unoFontScale", "1.5"));
    await page.setViewportSize({ width: 640, height: 800 });
    await open(page, "browser");
    await page.getByTitle("Options").click();
    await page.getByRole("menuitem", { name: /^Libraries \(/ }).click();
    const dialog = page.getByRole("dialog", { name: "Libraries" });
    const entry = dialog.getByRole("button", { name: /AUnit 1\.7\.1/ });
    // Another version in the project gives the longest status.
    await entry.evaluate((element) => {
      const status = document.createElement("span");
      status.textContent = "Andere Version im Projekt";
      element.insertBefore(status, element.children[1]);
    });

    const nameLine = entry.getByText("AUnit 1.7.1");
    expect((await nameLine.boundingBox())?.width ?? 0).toBeGreaterThan(60);
    expect(await entry.evaluate(clipped)).toBe(false);
    await entry.click();
    const details = dialog.getByRole("region", { name: "AUnit 1.7.1" });
    expect(await details.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });

  test("on a low window with XXL text the dialog scrolls as a whole, so a focused Einbinden is fully visible", async ({ page }) => {
    await page.addInitScript(() => globalThis.localStorage.setItem("unoFontScale", "1.5"));
    await page.setViewportSize({ width: 640, height: 360 });
    await open(page, "browser");
    await page.getByTitle("Options").click();
    await page.getByRole("menuitem", { name: /^Libraries \(/ }).click();
    const dialog = page.getByRole("dialog", { name: "Libraries" });
    await dialog.getByRole("button", { name: /AUnit 1\.7\.1/ }).click();

    const include = dialog.getByRole("button", { name: "Einbinden" });
    await include.focus();
    // Every corner of the button is the topmost element there: nothing clips or covers it.
    const visible = await include.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const corners = [[box.left + 2, box.top + 2], [box.right - 2, box.top + 2], [box.left + 2, box.bottom - 2], [box.right - 2, box.bottom - 2]];
      return corners.every(([x, y]) => element.contains(document.elementFromPoint(x, y)));
    });
    expect(visible).toBe(true);
  });

  test("closing returns the focus: Escape to the menu that opened it, Einbinden to the editor", async ({ page }) => {
    await open(page, "browser");
    await setSketch(page, TESTS);

    await openDialog(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: "Sketch" })).toBeFocused();

    await includeAUnit(page);
    await expect.poll(() => editorHasFocus(page)).toBe(true);
  });

  test("the Legacy engine names why AUnit does not run there and does not start it", async ({ page }) => {
    let compileRequests = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/compile")) compileRequests++;
    });
    await open(page, "host-mock");
    await setSketch(page, TESTS);
    await includeAUnit(page);

    const dialog = await openDialog(page);
    await dialog.getByRole("button", { name: /AUnit 1\.7\.1/ }).click();
    await expect(dialog.getByText(/^Simulation \(Legacy\): nicht unterstützt – /)).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /start simulation/i }).click();
    await page.waitForTimeout(1_000);
    expect(compileRequests).toBe(0);
    await expect(page.getByRole("button", { name: /stop simulation/i })).toBeHidden();
  });
});
