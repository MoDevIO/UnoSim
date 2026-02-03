import { test, expect } from "./fixtures/test-base";

test.describe.configure({ mode: "serial" });

test.describe("Arduino Board - Pin Frame Rendering (Vollversion)", () => {
  test.beforeEach(async ({ page, monacoEditor }) => {
    await page.context().request.post("/api/test-reset").catch(() => {});
    await page.goto("/");
    await monacoEditor.waitForReady();
  });

  // --- TEST 1: PIN 2 (Digital Read Example) ---
  test("Pin 2 should display yellow frame when configured as INPUT", async ({ page, startSimulation }) => {
    await page.getByRole("button", { name: /examples/i }).click();

    const arduinoIoFolder = page.locator('[data-role="example-folder"]').filter({ hasText: "arduino-io" });
    await expect(arduinoIoFolder).toBeVisible();
    await arduinoIoFolder.click();

    const digitalReadExample = page.locator('[data-role="example-item"]').filter({ hasText: "digital-pin-read" });
    await expect(digitalReadExample).toBeVisible();
    await digitalReadExample.click();
    
    await page.keyboard.press("Escape");
    await startSimulation();
    
    // Verify simulation is running
    await expect(page.getByRole("button", { name: /stop simulation/i })).toBeVisible({ timeout: 15000 });
    
    // Wait for registry to be processed - look for the pin-2-frame element first
    const frame = page.locator("#pin-2-frame");
    await expect(frame).toBeAttached({ timeout: 10000 });
    
    // Now wait for it to become visible (display:block)
    await expect.poll(async () => {
      // Check the computed style - the frame should have display: block when INPUT
      const display = await frame.evaluate((el) => window.getComputedStyle(el).display);
      return display !== "none";
    }, { timeout: 25000, message: "Pin 2 frame should become visible when configured as INPUT" }).toBe(true);
  });

  // --- TEST 2: MEHRERE INPUT PINS (A0) ---
  test("Multiple INPUT pins should all display yellow frames", async ({ page, startSimulation }) => {
    await page.getByRole("button", { name: /examples/i }).click();

    const basicProgrammingFolder = page.locator('[data-role="example-folder"]').filter({ hasText: "basic-programming" });
    await expect(basicProgrammingFolder).toBeVisible();
    await basicProgrammingFolder.click();

    const testA0Example = page.locator('[data-role="example-item"]').filter({ hasText: "00_testA0" });
    await testA0Example.waitFor({ state: "visible", timeout: 10000 });
    await testA0Example.click();

    await page.keyboard.press("Escape");

    await startSimulation();

    const frameA0 = page.locator("#pin-A0-frame");
    await expect.poll(async () => {
      return await frameA0.isVisible();
    }, { timeout: 10000 }).toBe(true);
  });

  // --- TEST 3: OUTPUT (KEIN RAHMEN) ---
  test("OUTPUT pins should NOT display yellow frames", async ({ page, startSimulation }) => {
    await page.getByRole("button", { name: /examples/i }).click();
    await page.locator('[data-role="example-folder"]').filter({ hasText: "arduino-io" }).click();
    await page.locator('[data-role="example-item"]').filter({ hasText: "digital-pin-write" }).click();
    
    await page.keyboard.press("Escape");
    await startSimulation();

    const frame13 = page.locator("#pin-13-frame");
    await expect(frame13).toBeHidden();
  });

  // --- TEST 4: INPUT_PULLUP MANUELL ---
  test("INPUT_PULLUP pins should display yellow frames", async ({ page, monacoEditor, startSimulation }) => {
    const code = "\nvoid setup() {\n  pinMode(0, INPUT_PULLUP);\n}\n\nvoid loop() {\n  int value = digitalRead(0);\n}";
    
    await monacoEditor.setValue(code);
    
    await startSimulation();
    
    const frame = page.locator("#pin-0-frame");
    await expect.poll(async () => {
      return await frame.isVisible();
    }, { timeout: 10000 }).toBe(true);
  });

  // --- TEST 5: ANALOG READ MANUELL ---
  test("Analog pins (A0-A5) should display frames when configured as INPUT", async ({ page, monacoEditor, startSimulation }) => {
    const code = "\nvoid setup() {\n  pinMode(A0, INPUT);\n}\n\nvoid loop() {\n  analogRead(A0);\n}";
    
    await monacoEditor.setValue(code);
    await startSimulation();
    
    const frame = page.locator("#pin-A0-frame");
    await expect.poll(async () => {
      return await frame.isVisible();
    }, { timeout: 10000 }).toBe(true);
  });

  // --- TEST 6: DYNAMISCHER WECHSEL ---
  test("Switching pin mode from OUTPUT to INPUT should show frame", async ({ page, monacoEditor, startSimulation, stopSimulation }) => {
    await monacoEditor.setValue("void setup() { pinMode(0, OUTPUT); } \n void loop() {}");
    await startSimulation();
    await expect(page.locator("#pin-0-frame")).toBeHidden();

    await stopSimulation();

    await monacoEditor.setValue("void setup() { pinMode(0, INPUT); } \n void loop() { digitalRead(0); }");
    await startSimulation();

    await expect.poll(async () => {
      return await page.locator("#pin-0-frame").isVisible();
    }, { timeout: 10000 }).toBe(true);
  });

  // --- TEST 7: CLEAR ON RELOAD (REINIGUNGSTEST) ---
  test("Loading a new program should clear previous pin frame markings", async ({ page, monacoEditor, startSimulation, stopSimulation }) => {
    await monacoEditor.setValue("void setup() { pinMode(A0, INPUT); } \n void loop() {}");
    await startSimulation();
    await expect(page.locator("#pin-A0-frame")).toBeVisible();

    await stopSimulation();

    await monacoEditor.setValue("void setup() { pinMode(7, OUTPUT); } \n void loop() {}");
    await startSimulation();

    const frameA0 = page.locator("#pin-A0-frame");
    await expect(frameA0).toBeHidden({ timeout: 10000 });
  });
});