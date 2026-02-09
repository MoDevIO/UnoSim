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
    await expect.poll(async () => {
      return await frameA0.isHidden();
    }, { timeout: 10000 }).toBe(true);
  });

  // --- TEST 8: analogRead WITHOUT pinMode SHOULD SHOW DASHED FRAME ---
  test("analogRead(A1) without pinMode should display dashed yellow frame", async ({ page, monacoEditor, startSimulation }) => {
    // Capture console logs
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'log' || msg.type() === 'debug') {
        consoleLogs.push(msg.text());
      }
    });
    
    const code = `void setup()
{
  pinMode(1, INPUT);
}

void loop()
{
  Serial.print(analogRead(A1));
  Serial.println(digitalRead(1));
}`;
    
    await monacoEditor.setValue(code);
    await startSimulation();
    
    // Wait a bit for logs to appear
    await page.waitForTimeout(2000);
    
    // Print captured logs
    console.log("=== Captured console logs ===");
    consoleLogs.forEach(log => console.log(log));
    console.log("=== End logs ===");
    
    // Check that digital pin 1 frame is visible (solid frame for INPUT)
    const frameD1 = page.locator("#pin-1-frame");
    await expect.poll(async () => {
      return await frameD1.isVisible();
    }, { timeout: 10000 }).toBe(true);
    
    // Check that analog pin A1 (pin 15) frame is visible
    const frameA1 = page.locator("#pin-A1-frame");
    
    // Debug: Check frame styles
    const frameStyles = await frameA1.evaluate((el: SVGRectElement) => {
      return {
        display: el.style.display,
        computedDisplay: window.getComputedStyle(el).display,
        visibility: el.style.visibility,
        opacity: el.style.opacity,
        exists: !!el,
      };
    });
    console.log("Frame A1 styles:", frameStyles);
    
    await expect.poll(async () => {
      return await frameA1.isVisible();
    }, { timeout: 10000, message: "Pin A1 frame should be visible when analogRead(A1) is used" }).toBe(true);
    
    // Verify the frame is dashed (strokeDasharray should be "3,2" or "3, 2")
    const strokeDasharray = await frameA1.evaluate((el: SVGRectElement) => {
      return el.style.strokeDasharray || el.getAttribute("stroke-dasharray") || "";
    });
    
    expect(strokeDasharray.replace(/\s/g, "")).toMatch(/3,?2/);
  });
});