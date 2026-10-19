import { expect, test, type Page } from "@playwright/test";

// Smoke test of the Arduino Nano (plan P4.8, status `preview`): choosing it in Tools → Board, the Nano board
// view with A6 and A7, a real compile for the Nano (A6/A7 exist only in its pin variant, so the sketch does not
// compile for the Uno) and a run in the browser emulation with an analog value set on the board.

const ENGINE_KEY = "unoSimulationEngine";
const BOARD_KEY = "unoSelectedBoard";
const COMPILE_TIMEOUT = process.env.CI ? 120_000 : 60_000;

const ANALOG_SKETCH = `void setup() {
  Serial.begin(115200);
}
void loop() {
  Serial.print("A6=");
  Serial.print(analogRead(A6));
  Serial.print(" A7=");
  Serial.println(analogRead(A7));
  delay(100);
}`;

async function open(page: Page, board?: "nano"): Promise<void> {
  await page.addInitScript(([engine, key, value]) => {
    globalThis.localStorage.setItem(engine, "browser");
    if (value) globalThis.localStorage.setItem(key, value);
  }, [ENGINE_KEY, BOARD_KEY, board ?? ""]);
  await page.goto("/");
  await page.waitForFunction(() => Boolean((globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__), undefined, { timeout: 15_000 });
}

async function startSketch(page: Page, code: string): Promise<void> {
  await page.evaluate((sketch) => {
    const editor = (globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__ as { setValue: (value: string) => void };
    editor.setValue(sketch);
  }, code);
  await page.getByRole("button", { name: /start simulation/i }).click();
  await expect(page.getByRole("button", { name: /stop simulation/i })).toBeVisible({ timeout: COMPILE_TIMEOUT });
}

const serial = (page: Page) => page.locator('[data-testid="serial-output"]');

test.describe("Arduino Nano (preview)", () => {
  test("Tools → Board offers the Nano with the preview notice and switches the board view", async ({ page }) => {
    await open(page);
    await expect(page.locator("#pin-A7-click")).toHaveCount(0); // the Uno has no A7

    await page.getByRole("menuitem", { name: "Tools" }).click();
    await page.getByTestId("menu-board").click();
    const nano = page.getByRole("menuitemradio", { name: /Arduino Nano.*\(preview\)/ });
    await expect(nano).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: /Arduino UNO/ })).toHaveAttribute("aria-checked", "true");
    await nano.click();

    await expect(page.locator("#pin-A7-click")).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator("#pin-A6-click")).toHaveCount(1);
    await expect(page.getByText("Arduino Nano Board")).toBeAttached();
    expect(await page.evaluate(() => globalThis.localStorage.getItem("unoSelectedBoard"))).toBe("nano");
  });

  test("compiles for the Nano, runs in the browser and reads A6 and A7, set on the board", async ({ page }) => {
    await open(page, "nano");
    await startSketch(page, ANALOG_SKETCH);
    await expect(serial(page)).toContainText(/A6=\d+ A7=\d+/, { timeout: 15_000 });

    // Set A7 on the board: the pin opens a dialog with a slider and a number field.
    await page.locator("#pin-A7-click").click();
    const value = page.locator('input[type="number"]');
    await value.fill("512");
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(serial(page)).toContainText("A7=512", { timeout: 10_000 });
    await expect(serial(page)).toContainText(/A6=0 /);
  });

  test("a board change stops the run and the next start builds for the new board", async ({ page }) => {
    await open(page, "nano");
    await startSketch(page, ANALOG_SKETCH);
    await expect(serial(page)).toContainText("A6=", { timeout: 15_000 });

    await page.getByRole("menuitem", { name: "Tools" }).click();
    await page.getByTestId("menu-board").click();
    await page.getByRole("menuitemradio", { name: /Arduino UNO/ }).click();

    await expect(page.getByRole("button", { name: /start simulation/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#pin-A7-click")).toHaveCount(0, { timeout: 10_000 });
  });
});
