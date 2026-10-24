import { expect, test, type Page } from "@playwright/test";

// Smoke test of the ATtiny85 (plan P6.5, status `preview`): choosing it in Tools → Board, the DIP-8 board view
// (pins 0–4 interactive, RESET on PB5 not), a real compile with ATTinyCore and a run in the browser emulation:
// Serial through the software UART on PB0, an analog value set on PB2 (A1), and Serial input over the comparator.

const ENGINE_KEY = "unoSimulationEngine";
const BOARD_KEY = "unoSelectedBoard";
const COMPILE_TIMEOUT = process.env.CI ? 120_000 : 60_000;

const SKETCH = `void setup() {
  Serial.begin(9600);
  pinMode(LED_BUILTIN, OUTPUT);
}
void loop() {
  Serial.print("A1=");
  Serial.println(analogRead(A1));
  digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
  delay(200);
}`;

async function open(page: Page, board?: "attiny85"): Promise<void> {
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

// Serial of the ATtiny85 is half duplex: the core blocks interrupts while it sends, so input that arrives
// during output is lost, as on the chip. This sketch only answers.
const ECHO_SKETCH = `void setup() {
  Serial.begin(9600);
  Serial.println("ready");
}
void loop() {
  if (Serial.available()) {
    int n = Serial.parseInt(); // read first: printing blocks the receiver
    Serial.print("got ");
    Serial.println(n);
  }
}`;

const serial = (page: Page) => page.locator('[data-testid="serial-output"]');

test.describe("ATtiny85 (preview)", () => {
  test("Tools → Board offers the ATtiny85 with the preview notice and shows the DIP-8 board", async ({ page }) => {
    await open(page);
    await page.getByRole("menuitem", { name: "Tools" }).click();
    await page.getByTestId("menu-board").click();
    const tiny = page.getByRole("menuitemradio", { name: /ATtiny85.*\(preview\)/ });
    await expect(tiny).toBeVisible();
    await tiny.click();

    await expect(page.getByText("ATtiny85 Board")).toBeAttached({ timeout: 10_000 });
    for (const pin of [0, 1, 2, 3, 4]) await expect(page.locator(`#pin-${pin}-click`)).toHaveCount(1);
    await expect(page.locator("#pin-5-click")).toHaveCount(0); // PB5 is RESET
    await expect(page.locator("#pin-13-click")).toHaveCount(0);
    expect(await page.evaluate(() => globalThis.localStorage.getItem("unoSelectedBoard"))).toBe("attiny85");
  });

  test("compiles with ATTinyCore, prints through the software UART and reads A1 set on the board", async ({ page }) => {
    await open(page, "attiny85");
    await startSketch(page, SKETCH);
    await expect(serial(page)).toContainText(/A1=\d+/, { timeout: 15_000 });

    // A1 is PB2, pin 2 on the board: the pin opens a dialog with a slider and a number field.
    await page.locator("#pin-2-click").click();
    await expect(page.getByText("2 (A1)")).toBeVisible();
    await page.locator('input[type="number"]').fill("512");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(serial(page)).toContainText("A1=512", { timeout: 10_000 });
  });

  test("sends Serial input to the sketch through the analog comparator", async ({ page }) => {
    await open(page, "attiny85");
    await startSketch(page, ECHO_SKETCH);
    await expect(serial(page)).toContainText("ready", { timeout: 15_000 });

    const input = page.getByPlaceholder("Send to Arduino...");
    await input.fill("42");
    await input.press("Enter");
    await expect(serial(page)).toContainText("got 42", { timeout: 10_000 });
  });
});
