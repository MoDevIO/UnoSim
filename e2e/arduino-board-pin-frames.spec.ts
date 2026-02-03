import { test, expect, Page } from "@playwright/test";

/**
 * Erweitertes Debugging: Schießt Screenshots und loggt Computed Styles.
 * Hilft zu verstehen, WARUM ein Test fehlschlägt (z.B. z-index oder opacity).
 */
async function performDeepDebug(page: Page, pinId: string, step: string) {
  console.log(`\n🔍 [DEBUG-LOG] Step: ${step} - Pin: ${pinId}`);
  const locator = page.locator(`#${pinId}`);
  const count = await locator.count();

  if (count === 0) {
    console.log(`   ❌ Element #${pinId} nicht im DOM vorhanden.`);
  } else {
    const data = await locator.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return {
        visible: el.getBoundingClientRect().width > 0,
        opacity: s.opacity,
        display: s.display,
        color: s.borderColor || s.outlineColor,
        zIndex: s.zIndex
      };
    });
    console.log(`   📍 Status:`, data);
  }
  await page.screenshot({ path: `failure-${pinId}-${Date.now()}.png` });
}

test.describe.configure({ mode: "serial" });

test.describe("Arduino Board - Pin Frame Rendering (Vollversion)", () => {
  let currentTestRunId: string;

  test.beforeEach(async ({ page }) => {
    currentTestRunId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`\n🚀 STARTE TESTLAUF: ${currentTestRunId}`);
    
    // Backend Reset mit Error-Catch
    try {
      const resetResponse = await page.context().request.post("/api/test-reset");
      if (resetResponse.ok()) console.log("   ✅ Backend Reset durchgeführt");
    } catch (err) {
      console.warn(`   ⚠️ Backend Reset fehlgeschlagen: ${err}`);
    }
    
    await page.addInitScript((testId) => {
      window.sessionStorage.setItem("__TEST_RUN_ID__", testId);
      console.log("   Sitzungs-ID gesetzt:", testId);
    }, currentTestRunId);

    await page.goto("/");
    await page.waitForSelector(".monaco-editor", { state: "visible", timeout: 15000 });
    // WebSocket-Grace-Period
    await page.waitForTimeout(1000); 
  });

  // --- TEST 1: PIN 2 (Digital Read Example) ---
  test("Pin 2 should display yellow frame when configured as INPUT", async ({ page }) => {
    console.log("🏃 Test: Pin 2 INPUT via Examples");
    await page.getByRole("button", { name: /examples/i }).click();
    await page.waitForTimeout(500);

    const arduinoIoFolder = page.locator('[data-role="example-folder"]').filter({ hasText: "arduino-io" });
    await arduinoIoFolder.click();
    await page.waitForTimeout(300);

    const digitalReadExample = page.locator('[data-role="example-item"]').filter({ hasText: "digital-pin-read" });
    await digitalReadExample.click();
    
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    const runButton = page.locator('[data-testid="button-simulate-toggle"]');
    await runButton.click();

    // Warten auf Start der Simulation
    await expect(page.getByRole("button", { name: /stop simulation/i })).toBeVisible({ timeout: 15000 });
    
    // Pin 2 Frame Check
    const frame = page.locator("#pin-2-frame");
    try {
      await expect(frame).toBeVisible({ timeout: 12000 });
      console.log("   ✅ Pin 2 Frame ist sichtbar");
    } catch (e) {
      await performDeepDebug(page, "pin-2-frame", "Digital Read Test");
      throw e;
    }
  });

  // --- TEST 2: MEHRERE INPUT PINS (A0) ---
  test("Multiple INPUT pins should all display yellow frames", async ({ page }) => {
    console.log("🏃 Test: Multiple INPUTs (A0)");
    await page.getByRole("button", { name: /examples/i }).click();
    await page.waitForTimeout(500);

    const basicProgrammingFolder = page.locator('[data-role="example-folder"]').filter({ hasText: "basic-programming" });
    await basicProgrammingFolder.click();
    await page.waitForTimeout(300);

    const testA0Example = page.locator('[data-role="example-item"]').filter({ hasText: "00_testA0" });
    await testA0Example.waitFor({ state: "visible", timeout: 10000 });
    await testA0Example.click();

    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");

    await page.locator('[data-testid="button-simulate-toggle"]').click();

    const frameA0 = page.locator("#pin-A0-frame");
    try {
      await expect(frameA0).toBeVisible({ timeout: 10000 });
      console.log("   ✅ A0 Frame ist sichtbar");
    } catch (e) {
      await performDeepDebug(page, "pin-A0-frame", "A0 Multi-Pin Test");
      throw e;
    }
  });

  // --- TEST 3: OUTPUT (KEIN RAHMEN) ---
  test("OUTPUT pins should NOT display yellow frames", async ({ page }) => {
    console.log("🏃 Test: OUTPUT (Kein Rahmen)");
    await page.getByRole("button", { name: /examples/i }).click();
    await page.locator('[data-role="example-folder"]').filter({ hasText: "arduino-io" }).click();
    await page.locator('[data-role="example-item"]').filter({ hasText: "digital-pin-write" }).click();
    
    await page.keyboard.press("Escape");
    await page.locator('[data-testid="button-simulate-toggle"]').click();
    await page.waitForTimeout(3000);

    const frame13 = page.locator("#pin-13-frame");
    await expect(frame13).toBeHidden();
    console.log("   ✅ Pin 13 (OUTPUT) hat keinen Rahmen");
  });

  // --- TEST 4: INPUT_PULLUP MANUELL ---
  test("INPUT_PULLUP pins should display yellow frames", async ({ page }) => {
    console.log("🏃 Test: INPUT_PULLUP manuell");
    const code = "\nvoid setup() {\n  pinMode(0, INPUT_PULLUP);\n}\n\nvoid loop() {\n  int value = digitalRead(0);\n}";
    
    await page.click(".monaco-editor");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(code);
    
    await page.locator('[data-testid="button-simulate-toggle"]').click();
    
    const frame = page.locator("#pin-0-frame");
    try {
      await expect(frame).toBeVisible({ timeout: 10000 });
      console.log("   ✅ Pin 0 (PULLUP) Frame sichtbar");
    } catch (e) {
      await performDeepDebug(page, "pin-0-frame", "Pullup Test");
      throw e;
    }
  });

  // --- TEST 5: ANALOG READ MANUELL ---
  test("Analog pins (A0-A5) should display frames when configured as INPUT", async ({ page }) => {
    console.log("🏃 Test: Analog A0 manuell");
    const code = "\nvoid setup() {\n  pinMode(A0, INPUT);\n}\n\nvoid loop() {\n  analogRead(A0);\n}";
    
    await page.click(".monaco-editor");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(code);
    
    await page.locator('[data-testid="button-simulate-toggle"]').click();
    
    const frame = page.locator("#pin-A0-frame");
    await expect(frame).toBeVisible({ timeout: 10000 });
    console.log("   ✅ A0 Analog Frame sichtbar");
  });

  // --- TEST 6: DYNAMISCHER WECHSEL ---
  test("Switching pin mode from OUTPUT to INPUT should show frame", async ({ page }) => {
    console.log("🏃 Test: Dynamischer Modus-Wechsel");
    const runButton = page.locator('[data-testid="button-simulate-toggle"]');
    
    // Schritt 1: OUTPUT
    await page.click(".monaco-editor");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("void setup() { pinMode(0, OUTPUT); } \n void loop() {}");
    await runButton.click();
    await expect(page.locator("#pin-0-frame")).toBeHidden();

    // Stoppen
    await runButton.click();
    await page.waitForTimeout(1000);

    // Schritt 2: INPUT
    await page.click(".monaco-editor");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("void setup() { pinMode(0, INPUT); } \n void loop() { digitalRead(0); }");
    await runButton.click();

    await expect(page.locator("#pin-0-frame")).toBeVisible({ timeout: 10000 });
    console.log("   ✅ Wechsel von OUTPUT zu INPUT erfolgreich");
  });

  // --- TEST 7: CLEAR ON RELOAD (REINIGUNGSTEST) ---
  test("Loading a new program should clear previous pin frame markings", async ({ page }) => {
    console.log("🏃 Test: Programmwechsel-Cleanup");
    const runButton = page.locator('[data-testid="button-simulate-toggle"]');

    // Programm 1: A0 aktiv
    await page.click(".monaco-editor");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("void setup() { pinMode(A0, INPUT); } \n void loop() {}");
    await runButton.click();
    await expect(page.locator("#pin-A0-frame")).toBeVisible();

    await runButton.click();
    await page.waitForTimeout(800);

    // Programm 2: Nur Pin 7 aktiv
    await page.click(".monaco-editor");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("void setup() { pinMode(7, OUTPUT); } \n void loop() {}");
    await runButton.click();

    const frameA0 = page.locator("#pin-A0-frame");
    try {
      // Wir prüfen hier explizit auf Hidden, um sicherzugehen, dass das UI resettet wurde
      await expect(frameA0).toBeHidden({ timeout: 10000 });
      console.log("   ✅ Cleanup: A0 Frame wurde nach Programmwechsel entfernt");
    } catch (e) {
      await performDeepDebug(page, "pin-A0-frame", "Cleanup Failure");
      throw e;
    }
  });
});