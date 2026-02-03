import { test, expect } from "./fixtures/test-base";

/**
 * SANDBOX UI BATCHING INTEGRATION TEST - FULL VERSION
 * Abgedeckte Features:
 * - Backend Reset & Sketch Loading
 * - Pin-Monitor Auto-Detection (Pin 13)
 * - Serial-to-GPIO Interaction (Toggle)
 * - PWM Smoothing (Pin 9)
 * - Performance Metrics (Batch ms)
 * - UI Stress & Cleanup
 */

test.describe.configure({ mode: "serial" });

test.describe("Sandbox UI Batching Integration", () => {
  let currentTestRunId: string;
  
  // Erhöhtes Globales Timeout gegen "Target Closed" Errors
  test.setTimeout(60000);

  test.beforeEach(async ({ page, testRunId, compilerDir }) => {
    currentTestRunId = testRunId;
    console.log(`\n🚀 STARTE VOLLSTÄNDIGEN TEST-DURCHLAUF: ${currentTestRunId}`);

    // 1. Backend Reset
    await page.context().request.post("/api/test-reset").catch(() => {});

    // 2. Test-Konfiguration injizieren
    await page.addInitScript((testId: string) => {
      window.sessionStorage.setItem("__TEST_RUN_ID__", testId);
      window.localStorage.setItem("unoPinMonitorVisible", "1");
    }, currentTestRunId);

    console.log(`   🧪 Compiler temp dir: ${compilerDir}`);

    // 3. App laden
    await page.goto("/");
    await page.waitForSelector(".monaco-editor", { timeout: 15000 });
    
    // 4. Pin Monitor UI erzwingen
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("pinMonitorVisibleChange", { detail: { value: true } }));
    });
    await page.waitForTimeout(1000);
  });

  // --- HILFSFUNKTIONEN ---

  const getPinMonitor = (page: any) => page.locator('[data-testid="pin-monitor"]');
  const getPinRow = (monitor: any, pin: number) => monitor.locator(`[data-pin="${pin}"]`);
  const getPinValue = async (monitor: any, pin: number) => {
    return (await getPinRow(monitor, pin).locator("[data-value]").textContent())?.trim() || "";
  };

  // --- HAUPTTEST ---

  test("Kompletter Integrations-Workflow", async ({ page, monacoEditor, compilerDir }) => {
    // I. SKETCH LADEN
    console.log("   📂 Lade 'master-test.ino'...");
    await page.getByRole("button", { name: /examples/i }).click();
    await page.locator('[data-role="example-folder"]').filter({ hasText: "tests" }).click();
    await page.locator('[data-role="example-item"]').filter({ hasText: "master-test.ino" }).click();
    await page.waitForTimeout(1000);
    await page.keyboard.press("Escape");

    // Verifikation: Ist der Code im Editor? (Regex für Variablen + Zeilennummern)
    await monacoEditor.waitForReady();
    await monacoEditor.verifyCodeContains("pinMode", { pin: 13, mode: "OUTPUT" });
    const code = await monacoEditor.getValue();
    expect(code).toHaveArduinoCode(/\bpinMode\s*\(/i);

    // II. SIMULATION STARTEN
    const runButton = page.locator('[data-testid="button-simulate-toggle"]');
    await runButton.click();
    await expect(runButton).toHaveAttribute("aria-label", "Stop Simulation", { timeout: 20000 });
    console.log("   ⚡ Simulation aktiv.");

    // III. PIN 13 INITIALISIERUNG (Mit Diagnose-Schleife)
    const pinMonitor = getPinMonitor(page);
    await expect(pinMonitor).toBeVisible({ timeout: 10000 });

    console.log("   🔍 Warte auf Pin 13...");
    const pin13 = getPinRow(pinMonitor, 13);
    let pin13Visible = false;

    for (let i = 0; i < 15; i++) {
      if (await pin13.isVisible()) {
        pin13Visible = true;
        break;
      }
      const currentPins = await pinMonitor.locator('[data-pin]').evaluateAll(nodes => 
        nodes.map(n => n.getAttribute('data-pin'))
      );
      console.log(`      [Check ${i+1}] Gefundene Pins: [${currentPins.join(", ")}]`);
      await page.waitForTimeout(2000);
    }

    if (!pin13Visible) {
      await page.screenshot({ path: "FINAL_ERROR_DISPLAY.png" });
      throw new Error("Pin 13 erschien nicht im Monitor. Siehe Screenshot.");
    }

    // IV. INTERAKTION: SERIAL TOGGLE (PIN 13)
    console.log("   📝 Teste Serial Toggle...");
    const initial13 = await getPinValue(pinMonitor, 13);
    const serialInput = page.locator('[data-testid="input-serial"]');
    
    await serialInput.fill("1");
    const sendSerialButton = page.locator('[data-testid="button-send-serial"]');
    await expect(sendSerialButton).toBeEnabled({ timeout: 20000 });
    await sendSerialButton.click();

    await expect.poll(() => getPinValue(pinMonitor, 13), {
      timeout: 10000,
      message: "Pin 13 Toggle reagiert nicht auf Serial '1'"
    }).not.toBe(initial13);
    console.log("   ✅ Toggle erfolgreich.");

    // V. PWM SMOOTHING (PIN 9)
    console.log("   📝 Teste PWM Smoothing...");
    await serialInput.fill("2");
    await expect(sendSerialButton).toBeEnabled({ timeout: 20000 });
    await sendSerialButton.click();
    
    const pin9 = getPinRow(pinMonitor, 9);
    await expect(pin9).toBeVisible({ timeout: 5000 });

    const pwm1 = await getPinValue(pinMonitor, 9);
    await page.waitForTimeout(1000);
    const pwm2 = await getPinValue(pinMonitor, 9);
    
    console.log(`   📊 PWM Werte: ${pwm1} -> ${pwm2}`);
    expect(Number(pwm1)).not.toBe(Number(pwm2));
    console.log("   ✅ PWM Smoothing aktiv.");

    // VI. PERFORMANCE & BATCHING
    console.log("   📈 Prüfe Batch-Performance...");
    await pinMonitor.getByRole("button", { name: /show fps/i }).click();
    
    const batchLine = pinMonitor.getByText(/Batch ms:/i);
    await expect.poll(async () => {
      const text = await batchLine.textContent();
      return Number(text?.replace(/[^0-9.]/g, ""));
    }, { timeout: 5000 }).toBeLessThan(20);
    console.log("   ✅ Performance OK.");

    // VII. CLEANUP
    console.log("   🛑 Stoppe Simulation...");
    await runButton.click();
    await expect(pin13).toHaveCount(0, { timeout: 10000 });
    
    console.log("✅ TEST VOLLSTÄNDIG UND ERFOLGREICH.");
  });
});