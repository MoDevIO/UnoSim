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
  test.beforeEach(async ({ page }) => {
    // 1. Backend Reset
    await page.context().request.post("/api/test-reset").catch(() => {});

    // 2. Test-Konfiguration injizieren
    await page.addInitScript(() => {
      window.localStorage.setItem("unoPinMonitorVisible", "1");
    });

    // 3. App laden
    await page.goto("/");
    await page.waitForSelector(".monaco-editor", { timeout: 15000 });
    
    // 4. Pin Monitor UI erzwingen
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("pinMonitorVisibleChange", { detail: { value: true } }));
    });
    await expect(page.locator('[data-testid="pin-monitor"]')).toBeVisible({ timeout: 10000 });
  });

  // --- HILFSFUNKTIONEN ---

  const getPinMonitor = (page: any) => page.locator('[data-testid="pin-monitor"]');
  const getPinRow = (monitor: any, pin: number) => monitor.locator(`[data-pin="${pin}"]`);
  const getPinValue = async (monitor: any, pin: number) => {
    return (await getPinRow(monitor, pin).locator("[data-value]").textContent())?.trim() || "";
  };

  // --- HAUPTTEST ---

  test("Kompletter Integrations-Workflow", async ({ page, monacoEditor, startSimulation, stopSimulation }) => {
    // I. SKETCH LADEN
    await page.getByRole("button", { name: /examples/i }).click();
    await page.locator('[data-role="example-folder"]').filter({ hasText: "tests" }).click();
    await page.locator('[data-role="example-item"]').filter({ hasText: "master-test.ino" }).click();
    await page.keyboard.press("Escape");

    // Verifikation: Ist der Code im Editor? (Regex für Variablen + Zeilennummern)
    await monacoEditor.waitForReady();
    await expect.poll(() => monacoEditor.getValue()).toMatch(/\bpinMode\s*\(/i);
    await monacoEditor.verifyCodeContains("pinMode", { pin: 13, mode: "OUTPUT" });

    // II. SIMULATION STARTEN
    await startSimulation();

    // III. PIN 13 INITIALISIERUNG (Mit Diagnose-Schleife)
    const pinMonitor = getPinMonitor(page);
    await expect(pinMonitor).toBeVisible({ timeout: 10000 });
    const pin13 = getPinRow(pinMonitor, 13);
    await expect(pin13).toBeVisible({ timeout: 20000 });

    // IV. INTERAKTION: SERIAL TOGGLE (PIN 13)
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
    // V. PWM SMOOTHING (PIN 9)
    await serialInput.fill("2");
    await expect(sendSerialButton).toBeEnabled({ timeout: 20000 });
    await sendSerialButton.click();
    
    const pin9 = getPinRow(pinMonitor, 9);
    await expect(pin9).toBeVisible({ timeout: 5000 });

    const pwm1 = await getPinValue(pinMonitor, 9);
    await expect.poll(async () => {
      const value = await getPinValue(pinMonitor, 9);
      return Number(value);
    }, { timeout: 10000 }).not.toBe(Number(pwm1));
    const pwm2 = await getPinValue(pinMonitor, 9);
    expect(Number(pwm1)).not.toBe(Number(pwm2));

    // VI. PERFORMANCE & BATCHING
    await pinMonitor.getByRole("button", { name: /show fps/i }).click();
    
    const batchLine = pinMonitor.getByText(/Batch ms:/i);
    await expect.poll(async () => {
      const text = await batchLine.textContent();
      return Number(text?.replace(/[^0-9.]/g, ""));
    }, { timeout: 5000 }).toBeLessThan(20);
    // VII. CLEANUP
    await stopSimulation();
    await expect(pin13).toHaveCount(0, { timeout: 10000 });
  });
});