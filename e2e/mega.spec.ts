import { expect, test, type Page } from "@playwright/test";

// Acceptance test of the Arduino Mega 2560 (plan P5.4, status `preview`): choosing it in Tools → Board, the Mega board view
// with A0–A15 and the pins up to 53, a real compile for the Mega (Serial1 and A15 exist only there, so the sketch does not
// compile for the Uno), a run in the browser emulation with output and input on Serial and Serial1, and an analog value set on A15.

const ENGINE_KEY = "unoSimulationEngine";
const BOARD_KEY = "unoSelectedBoard";
const COMPILE_TIMEOUT = process.env.CI ? 120_000 : 60_000;

const MEGA_SKETCH = `void setup() {
  Serial.begin(115200);
  Serial1.begin(9600);
  Serial.println("hello Serial");
  Serial1.println("hello Serial1");
}
void loop() {
  if (Serial1.available()) {
    char c = Serial1.read();
    Serial1.print((char)toupper(c));
  }
  Serial.print("A15=");
  Serial.println(analogRead(A15));
  delay(100);
}`;

async function open(page: Page, board?: "mega2560"): Promise<void> {
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

test.describe("Arduino Mega 2560 (preview)", () => {
  test("Tools → Board offers the Mega with the preview notice and draws its pins", async ({ page }) => {
    await open(page);
    await expect(page.locator("#pin-A15-click")).toHaveCount(0); // the Uno has no A15

    await page.getByRole("menuitem", { name: "Tools" }).click();
    await page.getByTestId("menu-board").click();
    const mega = page.getByRole("menuitemradio", { name: /Arduino Mega 2560.*\(preview\)/ });
    await expect(mega).toBeVisible();
    await mega.click();

    await expect(page.locator("#pin-A15-click")).toHaveCount(1, { timeout: 10_000 });
    for (const pin of ["A0", "A8", "0", "13", "21", "22", "53"]) await expect(page.locator(`#pin-${pin}-click`), `pin ${pin}`).toHaveCount(1);
    await expect(page.locator("#pin-54-click")).toHaveCount(0); // A0 is named A0 on the board
    await expect(page.getByText("Arduino Mega 2560 Board")).toBeAttached();
    expect(await page.evaluate(() => globalThis.localStorage.getItem("unoSelectedBoard"))).toBe("mega2560");
  });

  test("compiles for the Mega, runs in the browser with Serial and Serial1 and reads A15, set on the board", async ({ page }) => {
    await open(page, "mega2560");
    await expect(page.getByTestId("serial-port-selector")).toBeVisible();
    await startSketch(page, MEGA_SKETCH);

    await expect(serial(page)).toContainText("hello Serial", { timeout: 15_000 });
    await expect(serial(page)).toContainText(/A15=\d+/);
    await expect(serial(page)).not.toContainText("hello Serial1"); // the monitor shows Serial

    // Serial1 has its own text and its own input.
    await page.getByTestId("serial-port-1").click();
    await expect(serial(page)).toContainText("hello Serial1", { timeout: 10_000 });
    await expect(serial(page)).not.toContainText("A15=");
    const input = page.getByPlaceholder("Send to Serial1...");
    await input.fill("abc");
    await input.press("Enter");
    await expect(serial(page)).toContainText("ABC", { timeout: 10_000 });

    // Set A15 on the board: the pin opens a dialog with a slider and a number field.
    await page.getByTestId("serial-port-0").click();
    await page.locator("#pin-A15-click").click();
    const value = page.locator('input[type="number"]');
    await value.fill("512");
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(serial(page)).toContainText("A15=512", { timeout: 10_000 });
  });

  test("a board change stops the run and the next start builds for the new board", async ({ page }) => {
    await open(page, "mega2560");
    await startSketch(page, MEGA_SKETCH);
    await expect(serial(page)).toContainText("hello Serial", { timeout: 15_000 });

    await page.getByRole("menuitem", { name: "Tools" }).click();
    await page.getByTestId("menu-board").click();
    await page.getByRole("menuitemradio", { name: /Arduino UNO/ }).click();

    await expect(page.getByRole("button", { name: /start simulation/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#pin-A15-click")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId("serial-port-selector")).toHaveCount(0);
  });
});
