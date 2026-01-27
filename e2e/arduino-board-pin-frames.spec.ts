import { test, expect } from "@playwright/test";

// Run tests serially to avoid interference between simulations
test.describe.configure({ mode: "serial" });

test.describe("Arduino Board - Pin Frame Rendering", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for the app to be fully loaded
    await page.waitForSelector(".monaco-editor", { timeout: 10000 });
  });

  test("Pin 0 should display yellow frame when configured as INPUT", async ({
    page,
  }) => {
    // Load digital-pin-read.ino which has button on pin 2 as INPUT
    const examplesButton = page.getByRole("button", { name: /examples/i });
    await examplesButton.click();

    // Wait for menu
    await page.waitForTimeout(500);

    // First expand the arduino-io folder
    const arduinoIoFolder = page
      .locator('[data-role="example-folder"]')
      .filter({ hasText: "arduino-io" });
    await arduinoIoFolder.click();

    // Wait for folder to expand
    await page.waitForTimeout(300);

    // Click digital pin read example
    const digitalReadExample = page
      .locator('[data-role="example-item"]')
      .filter({ hasText: "digital-pin-read" });
    await digitalReadExample.click();

    // Wait for the menu to close and code to load
    await page.waitForTimeout(500);

    // Close the menu by pressing Escape (in case it's still open)
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Run using data-testid for reliability
    const runButton = page.locator('[data-testid="button-simulate-toggle"]');
    await runButton.click();

    // Wait for simulation to actually start (button changes to "Stop Simulation")
    await expect(
      page.getByRole("button", { name: /stop simulation/i }),
    ).toBeVisible({ timeout: 15000 });

    // Wait a bit more for the I/O registry to be processed and frames to render
    await page.waitForTimeout(2000);

    // Check pin 2 frame (buttonPin in example is pin 2)
    const frame = page.locator("#pin-2-frame");
    await expect(frame).toBeVisible({ timeout: 10000 });
  });

  test("Multiple INPUT pins should all display yellow frames", async ({
    page,
  }) => {
    // Load testA0.ino which has A0 as INPUT
    const examplesButton = page.getByRole("button", { name: /examples/i });
    await examplesButton.click();

    // Wait for examples menu to open
    await page.waitForTimeout(500);

    // First expand the basic-programming folder (note: UI strips "01-" prefix)
    const basicProgrammingFolder = page
      .locator('[data-role="example-folder"]')
      .filter({ hasText: "basic-programming" });
    await basicProgrammingFolder.click();

    // Wait for folder to expand
    await page.waitForTimeout(300);

    // Find and click testA0
    const testA0Example = page
      .locator('[data-role="example-item"]')
      .filter({ hasText: "00_testA0" });
    await testA0Example.waitFor({ timeout: 60000 });
    await testA0Example.click();

    // Wait for example to load and close menu
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    const runButton = page.locator('[data-testid="button-simulate-toggle"]');
    await runButton.click();

    // Wait for compilation and simulation
    await page.waitForTimeout(3000);

    // Check frame for A0 (analog pin)
    const frameA0 = page.locator("#pin-A0-frame");
    await expect(frameA0).toBeVisible({ timeout: 5000 });
  });

  test("OUTPUT pins should NOT display yellow frames", async ({ page }) => {
    // Load digital-pin-write.ino which sets pin 13 as OUTPUT
    const examplesButton = page.getByRole("button", { name: /examples/i });
    await examplesButton.click();

    // Wait for examples menu
    await page.waitForTimeout(500);

    // First expand the arduino-io folder
    const arduinoIoFolder = page
      .locator('[data-role="example-folder"]')
      .filter({ hasText: "arduino-io" });
    await arduinoIoFolder.click();

    // Wait for folder to expand
    await page.waitForTimeout(300);

    // Find and click digital pin write example
    const digitalWriteExample = page
      .locator('[data-role="example-item"]')
      .filter({ hasText: "digital-pin-write" });
    await digitalWriteExample.click();

    // Wait for example to load and close menu
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    const runButton = page.locator('[data-testid="button-simulate-toggle"]');
    await runButton.click();

    // Wait for compilation and simulation
    await page.waitForTimeout(3000);

    // Pin 13 (OUTPUT in example) should NOT have visible frame
    const frame13 = page.locator("#pin-13-frame");
    await expect(frame13).toBeHidden();

    // Pins 0 (not configured) should also not have frames
    const frame0 = page.locator("#pin-0-frame");
    await expect(frame0).toBeHidden();
  });

  test("INPUT_PULLUP pins should display yellow frames", async ({ page }) => {
    const exampleCode = `
void setup() {
  pinMode(0, INPUT_PULLUP);
}

void loop() {
  int value = digitalRead(0);
}
`;

    await page.click(".monaco-editor");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(exampleCode);
    await page.waitForTimeout(500);

    const runButton = page.locator('[data-testid="button-simulate-toggle"]');
    await runButton.click();
    await page.waitForTimeout(2000);

    // Check if pin 0 frame is visible for INPUT_PULLUP
    const frame = page.locator("#pin-0-frame");
    await expect(frame).toBeVisible({ timeout: 5000 });
  });

  test("Analog pins (A0-A5) should display frames when configured as INPUT", async ({
    page,
  }) => {
    const exampleCode = `
void setup() {
  pinMode(A0, INPUT);
}

void loop() {
  int value = analogRead(A0);
}
`;

    await page.click(".monaco-editor");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(exampleCode);
    await page.waitForTimeout(500);

    const runButton = page.locator('[data-testid="button-simulate-toggle"]');
    await runButton.click();
    await page.waitForTimeout(2000);

    // Check if analog pin A0 frame is visible
    const frame = page.locator("#pin-A0-frame");
    await expect(frame).toBeVisible({ timeout: 5000 });
  });

  test("Switching pin mode from OUTPUT to INPUT should show frame", async ({
    page,
  }) => {
    // First set pin 0 as OUTPUT
    let exampleCode = `
void setup() {
  pinMode(0, OUTPUT);
}

void loop() {
  digitalWrite(0, HIGH);
}
`;

    await page.click(".monaco-editor");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(exampleCode);
    await page.waitForTimeout(500);

    let runButton = page.locator('[data-testid="button-simulate-toggle"]');
    await runButton.click();
    await page.waitForTimeout(2000);

    // Frame should be hidden
    let frame = page.locator("#pin-0-frame");
    await expect(frame).toBeHidden();

    // Stop simulation (click the same button again)
    await runButton.click();
    await page.waitForTimeout(500);

    // Now change to INPUT
    exampleCode = `
void setup() {
  pinMode(0, INPUT);
}

void loop() {
  int value = digitalRead(0);
}
`;

    await page.click(".monaco-editor");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(exampleCode);
    await page.waitForTimeout(500);

    runButton = page.locator('[data-testid="button-simulate-toggle"]');
    await runButton.click();
    await page.waitForTimeout(2000);

    // Frame should now be visible
    frame = page.locator("#pin-0-frame");
    await expect(frame).toBeVisible({ timeout: 5000 });
  });

  test("Loading a new program should clear previous pin frame markings", async ({
    page,
  }) => {
    // First program: testA0 - uses A0 as INPUT
    const program1 = `
void setup() {
  Serial.begin(115200);
  pinMode(A0, INPUT);
  Serial.println("A0 gestartet");
}

void loop() {
  digitalRead(A0);  
  delay(80);
}
`;

    // Load first program
    await page.click(".monaco-editor");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(program1);
    await page.waitForTimeout(500);

    // Run first program
    let runButton = page.locator('[data-testid="button-simulate-toggle"]');
    await runButton.click();
    await page.waitForTimeout(2000);

    // Verify A0 frame is visible
    let frameA0 = page.locator("#pin-A0-frame");
    await expect(frameA0).toBeVisible({ timeout: 5000 });

    // Stop simulation
    let stopButton = page.locator('[data-testid="button-simulate-toggle"]');
    await stopButton.click();
    await page.waitForTimeout(500);

    // Second program: testD7 - does NOT use A0
    const program2 = `
void setup()
{
    Serial.begin(115200);
    Serial.println("D7 gestartet");
}

void loop()
{
    static bool state = false;
    state = !state;
    digitalWrite(7, state);
    delay(20);
}
`;

    // Load second program
    await page.click(".monaco-editor");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(program2);
    await page.waitForTimeout(500);

    // Run second program
    runButton = page.locator('[data-testid="button-simulate-toggle"]');
    await runButton.click();
    await page.waitForTimeout(2000);

    // CRITICAL TEST: A0 frame should NOT be visible anymore
    // because the new program doesn't use A0
    frameA0 = page.locator("#pin-A0-frame");
    const isA0Hidden = await frameA0.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.display === "none" || style.visibility === "hidden";
    });

    expect(isA0Hidden).toBe(true);
  });
});
