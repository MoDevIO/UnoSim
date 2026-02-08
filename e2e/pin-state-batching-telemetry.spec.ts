import { test, expect } from "./fixtures/test-base";
import { WebSocketServer } from "ws";
import { promisify } from "util";

/**
 * PIN STATE BATCHING - TELEMETRY E2E TESTS
 * 
 * Tests für die neuen Telemetrie-Metriken (Phase A):
 * - intendedPinChangesPerSecond
 * - actualPinChangesPerSecond  
 * - droppedPinChangesPerSecond
 * - batchesPerSecond
 * - avgStatesPerBatch
 * - serialOutputPerSecond
 *
 * Diese Tests werden FAILEN, bis Phase A.5 (UI-Update) abgeschlossen ist.
 */

test.describe("Pin State Batching - Telemetry Metrics", () => {
  
  test.beforeEach(async ({ page }) => {
    // Reset Backend falls vorhanden
    await page.context().request.post("/api/test-reset").catch(() => {});

    // Lade App
    await page.goto("/");
    await page.waitForSelector(".monaco-editor", { timeout: 15000 });
  });

  test("E2E-1: PIN CHANGES und BATCHING Metriken werden in der UI angezeigt", async ({
    page,
    monacoEditor,
    startSimulation,
    stopSimulation,
  }) => {
    test.setTimeout(60000);

    // 1. Master-Beispiel laden (pin toggling mit delay(10))
    await page.getByRole("button", { name: /examples/i }).click();
    await page.locator('[data-role="example-folder"]').filter({ hasText: "tests" }).click();
    await page.locator('[data-role="example-item"]').filter({ hasText: "master-test.ino" }).click();
    await page.keyboard.press("Escape");

    // 2. Code-Validierung
    await monacoEditor.waitForReady();
    await expect.poll(() => monacoEditor.getValue()).toMatch(/\bpinMode\s*\(/i);

    // 3. Debug-Mode aktivieren BEVOR Simulation gestartet wird
    await page.evaluate(() => {
      window.localStorage.setItem("unoDebugMode", "1");
      // Dispatch event to notify ArduinoBoard component
      const event = new CustomEvent("debugModeChange", { detail: { value: true } });
      document.dispatchEvent(event);
    });

    // 4. Simulation starten
    await startSimulation();
    await expect(page.getByRole("button", { name: /stop simulation/i })).toBeVisible({ timeout: 15000 });

    // 5. 3 Sekunden warten bis stabile Metriken vorhanden sind
    await page.waitForTimeout(3000);

    // 6. PIN CHANGES Section überprüfen (via test-id)
    const pinChangesSection = page.locator('[data-testid="telemetry-pin-changes"]');
    await expect(pinChangesSection).toBeVisible({ timeout: 10000 });

    // Überprüfe die Werte
    const pinChangesValue = page.locator('[data-testid="telemetry-pin-changes-value"]');
    const pinChangesText = await pinChangesValue.textContent();
    expect(pinChangesText).toMatch(/\d+\s*\/s/);

    // 7. BATCHING Section überprüfen
    const batchingSection = page.locator('[data-testid="telemetry-batching"]');
    await expect(batchingSection).toBeVisible({ timeout: 10000 });

    const batchingValue = page.locator('[data-testid="telemetry-batching-value"]');
    const batchingText = await batchingValue.textContent();
    expect(batchingText).toMatch(/\d+\s*bat\/s\s*·\s*\d+\s*st\/bat/);

    // 8. Werte sollten im erwarteten Bereich sein
    const pinChangesMatch = pinChangesText?.match(/(\d+)/);
    const intended = pinChangesMatch ? parseInt(pinChangesMatch[1], 10) : 0;
    expect(intended).toBeGreaterThan(0);
    expect(intended).toBeLessThan(3000);

    const batchingMatch = batchingText?.match(/(\d+)\s*bat\/s/);
    const batches = batchingMatch ? parseInt(batchingMatch[1], 10) : 0;
    expect(batches).toBeGreaterThan(15);
    expect(batches).toBeLessThan(25);

    // 9. Simulation stoppen
    await stopSimulation();
  });

  test("E2E-2: Telemetrie-Metriken sind 0 wenn Simulation gestoppt ist", async ({
    page,
    monacoEditor,
    startSimulation,
    stopSimulation,
  }) => {
    test.setTimeout(60000);

    // 1. Sketch laden
    await page.getByRole("button", { name: /examples/i }).click();
    await page.locator('[data-role="example-folder"]').filter({ hasText: "tests" }).click();
    await page.locator('[data-role="example-item"]').filter({ hasText: "master-test.ino" }).click();
    await page.keyboard.press("Escape");

    // 2. Debug-Mode aktivieren BEVOR Simulation gestartet wird
    await page.evaluate(() => {
      window.localStorage.setItem("unoDebugMode", "1");
      // Dispatch event to notify ArduinoBoard component
      const event = new CustomEvent("debugModeChange", { detail: { value: true } });
      document.dispatchEvent(event);
    });

    // 3. Simulation starten
    await monacoEditor.waitForReady();
    await startSimulation();
    await expect(page.getByRole("button", { name: /stop simulation/i })).toBeVisible({ timeout: 15000 });

    // 4. Warten auf stabile Metriken
    await page.waitForTimeout(2000);

    // 5. Simulation stoppen
    await stopSimulation();
    await expect(page.getByRole("button", { name: /start simulation|resume simulation/i })).toBeVisible({ timeout: 10000 });

    // 6. Nach Stop sollten die Metriken 0 sein (oder Element sollte verschwinden)
    const pinChangesSection = page.locator('[data-testid="telemetry-pin-changes"]');
    const batchingSection = page.locator('[data-testid="telemetry-batching"]');
    
    // Warten bis die Metriken auf 0 fallen oder das Element verschwindet
    await expect.poll(
      async () => {
        const count = await pinChangesSection.count();
        return count === 0 ? "hidden" : "visible";
      },
      { timeout: 5000 }
    ).toBe("hidden");
  });

  test("E2E-3: pin_state_batch Messages führen zu UI-Updates", async ({
    page,
    monacoEditor,
    startSimulation,
    stopSimulation,
  }) => {
    test.setTimeout(60000);

    // 1. Debug-Mode aktivieren vor Sketch-Load
    await page.evaluate(() => {
      window.localStorage.setItem("unoDebugMode", "1");
      const event = new CustomEvent("debugModeChange", { detail: { value: true } });
      document.dispatchEvent(event);
    });

    // 2. Sketch laden
    await page.getByRole("button", { name: /examples/i }).click();
    await page.locator('[data-role="example-folder"]').filter({ hasText: "tests" }).click();
    await page.locator('[data-role="example-item"]').filter({ hasText: "master-test.ino" }).click();
    await page.keyboard.press("Escape");

    await monacoEditor.waitForReady();

    // 3. Simulation starten
    await startSimulation();
    await expect(page.getByRole("button", { name: /stop simulation/i })).toBeVisible({ timeout: 15000 });

    // 4. Warte auf Telemetrie
    await page.waitForTimeout(2000);

    // 5. Sammle Telemetrie-Metriken über 6 Sekunden (sollte ~120 WebSocket Messages entsprechen)
    const measurements: number[] = [];
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(2000);
      
      const batchingValue = page.locator('[data-testid="telemetry-batching-value"]');
      if (await batchingValue.isVisible()) {
        const text = await batchingValue.textContent();
        const match = text?.match(/(\d+)\s*bat\/s/);
        if (match) {
          measurements.push(parseInt(match[1], 10));
        }
      }
    }

    // 6. Verify batching metrics are consistently present and non-zero
    expect(measurements.length).toBeGreaterThanOrEqual(2);
    measurements.forEach(batchesPerSec => {
      expect(batchesPerSec).toBeGreaterThan(15); // ~20 batches/sec expected
      expect(batchesPerSec).toBeLessThan(25);
    });

    await stopSimulation();
  });

  test("E2E-4: Telemetrie-Metriken bleiben relativ stabil über Zeit", async ({
    page,
    monacoEditor,
    startSimulation,
    stopSimulation,
  }) => {
    test.setTimeout(60000);

    // 1. Sketch laden
    await page.getByRole("button", { name: /examples/i }).click();
    await page.locator('[data-role="example-folder"]').filter({ hasText: "tests" }).click();
    await page.locator('[data-role="example-item"]').filter({ hasText: "master-test.ino" }).click();
    await page.keyboard.press("Escape");

    // 2. Debug-Mode aktivieren BEVOR Simulation gestartet wird
    await page.evaluate(() => {
      window.localStorage.setItem("unoDebugMode", "1");
      // Dispatch event to notify ArduinoBoard component
      const event = new CustomEvent("debugModeChange", { detail: { value: true } });
      document.dispatchEvent(event);
    });

    // 3. Simulation starten
    await monacoEditor.waitForReady();
    await startSimulation();
    await expect(page.getByRole("button", { name: /stop simulation/i })).toBeVisible({ timeout: 15000 });

    // 4. Metriken alle 2 Sekunden über 10 Sekunden sammeln
    const measurements: { batchesPerSecond: number; time: number }[] = [];

    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(2000);

      const batchingValue = page.locator('[data-testid="telemetry-batching-value"]');
      if (await batchingValue.isVisible().catch(() => false)) {
        const batchingText = await batchingValue.textContent();
        const match = batchingText?.match(/(\d+)\s*bat\/s/);
        if (match) {
          measurements.push({
            batchesPerSecond: parseInt(match[1], 10),
            time: i * 2000,
          });
        }
      }
    }

    // 5. Stabilität überprüfen: ±20% Abweichung von Durchschnitt
    if (measurements.length >= 3) {
      const avg = measurements.reduce((sum, m) => sum + m.batchesPerSecond, 0) / measurements.length;
      const tolerance = avg * 0.2;

      measurements.forEach((measurement) => {
        const deviation = Math.abs(measurement.batchesPerSecond - avg);
        expect(deviation).toBeLessThan(tolerance);
      });
    }

    await stopSimulation();
  });
});
