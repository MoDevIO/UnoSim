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

    // 3. Simulation starten
    await startSimulation();
    await expect(page.getByRole("button", { name: /stop simulation/i })).toBeVisible({ timeout: 15000 });

    // 4. Debug-Mode aktivieren (damit Telemetrie angezeigt wird)
    // In arduino-board.tsx wird debugMode verwendet, daher aktivieren wir es
    await page.evaluate(() => {
      // Trigger debug mode via localStorage oder directly
      localStorage.setItem("debugMode", "true");
      window.dispatchEvent(new StorageEvent("storage", {
        key: "debugMode",
        newValue: "true",
      }));
    });

    // 5. 3 Sekunden warten bis stabile Metriken vorhanden sind
    await page.waitForTimeout(3000);

    // 6. PIN CHANGES Section überprüfen
    // Nach Phase A.5 sieht die Struktur so aus:
    // <div> "PIN CHANGES" (Label)
    //   <span> "{intendedPinChangesPerSecond} /s" (z.B. "1520 /s")
    //   <span> "({droppedPinChangesPerSecond} dropped)" (z.B. "(380 dropped)")

    const pinChangesSection = page.locator('text="PIN CHANGES"').first().locator("..");
    await expect(pinChangesSection).toBeVisible({ timeout: 10000 });

    // Das Text Pattern sollte sein: "<number> /s (<number> dropped)" oder nur "<number> /s"
    const pinChangesText = await pinChangesSection.locator("span").nth(1).textContent();
    expect(pinChangesText).toMatch(/\d+\s*\/s/);
    
    // Wenn droppedPinChangesPerSecond > 0, sollten wir "(xxx dropped)" sehen
    const droppedText = await pinChangesSection.textContent();
    if (droppedText && droppedText.includes("dropped")) {
      expect(droppedText).toMatch(/\(\d+\s*dropped\)/);
    }

    // 7. BATCHING Section überprüfen  
    // Nach Phase A.5 sieht die Struktur so aus:
    // <div> "BATCHING" (Label)
    //   <span> "{batchesPerSecond} bat/s · {avgStatesPerBatch} st/bat"

    const batchingSection = page.locator('text="BATCHING"').first().locator("..");
    await expect(batchingSection).toBeVisible({ timeout: 10000 });

    const batchingText = await batchingSection.locator("span").nth(1).textContent();
    expect(batchingText).toMatch(/\d+\s*bat\/s\s*·\s*\d+\s*st\/bat/);

    // 8. Werte sollten im erwarteten Bereich sein
    // intendedPinChangesPerSecond: ~1500-2000
    // batchesPerSecond: ~18-22
    // avgStatesPerBatch: 20-80

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

    // 2. Simulation starten
    await monacoEditor.waitForReady();
    await startSimulation();
    await expect(page.getByRole("button", { name: /stop simulation/i })).toBeVisible({ timeout: 15000 });

    // 3. Debug-Mode aktivieren
    await page.evaluate(() => {
      localStorage.setItem("debugMode", "true");
      window.dispatchEvent(new StorageEvent("storage", { key: "debugMode", newValue: "true" }));
    });

    // 4. Warten auf stabile Metriken
    await page.waitForTimeout(2000);

    // 5. Simulation stoppen
    await stopSimulation();
    await expect(page.getByRole("button", { name: /start simulation|resume simulation/i })).toBeVisible({ timeout: 10000 });

    // 6. Nach Stop sollten die Metriken 0 sein
    // Schnell nach Stop überprüfen (innerhalb von 1 Sekunde)
    const pinChangesSection = page.locator('text="PIN CHANGES"');
    
    // Warten, bis die Werte auf 0 gefallen sind oder der Telemetrie-Block verschwindet
    // Nach dem Stop sollten intendedPinChangesPerSecond schnell auf 0 fallen (in der nächsten heartbeat)
    await expect.poll(
      async () => {
        const text = await pinChangesSection?.first().textContent().catch(() => "");
        // Text sollte "0 /s" sein oder Metriken sollten unsichtbar sein
        return text && text.includes("0 /s") ? "zero" : "non-zero";
      },
      { timeout: 5000 }
    ).toBe("zero");
  });

  test("E2E-3: WebSocket pin_state_batch Messages werden gesendet", async ({
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

    await monacoEditor.waitForReady();

    // 2. WebSocket Message Capture via Playwright
    const wsMessages: any[] = [];
    let wsConnection: WebSocket | undefined;

    await page.evaluate(() => {
      const originalWebSocket = window.WebSocket;
      (window as any).WebSocket = class extends originalWebSocket {
        constructor(url: string | URL, ...args: any[]) {
          super(url, ...args);
          
          this.addEventListener("message", (event) => {
            try {
              const data = JSON.parse(event.data);
              // Speichere pin_state_batch Messages global
              if (data.type === "pin_state_batch") {
                if (!(window as any).__pin_state_batches) {
                  (window as any).__pin_state_batches = [];
                }
                (window as any).__pin_state_batches.push(data);
              }
            } catch (e) {
              // Ignore parse errors
            }
          });
        }
      };
    });

    // 3. Simulation starten
    await startSimulation();
    await expect(page.getByRole("button", { name: /stop simulation/i })).toBeVisible({ timeout: 15000 });

    // 4. 5 Sekunden warten und pin_state_batch Messages sammeln
    await page.waitForTimeout(5000);

    // 5. Messages auslesen
    const capturedMessages = await page.evaluate(() => {
      return (window as any).__pin_state_batches || [];
    });

    // 6. Assertions
    expect(capturedMessages.length).toBeGreaterThan(50); // ~20 messages/sec × 5 sec, aber mit margin
    expect(capturedMessages.length).toBeLessThan(150);

    // Jede Message sollte ein states Array haben
    capturedMessages.forEach((msg) => {
      expect(msg.type).toBe("pin_state_batch");
      expect(Array.isArray(msg.states)).toBe(true);
      expect(msg.states.length).toBeGreaterThan(0);
      expect(msg.timestamp).toBeGreaterThan(0);
    });

    // 7. Durchschnitt berechnen
    const avgBatchSize = capturedMessages.reduce((sum, msg) => sum + msg.states.length, 0) / capturedMessages.length;
    expect(avgBatchSize).toBeGreaterThan(1); // Sollte mindestens 1 State pro Batch sein
    expect(avgBatchSize).toBeLessThan(200); // Vernünftiger upper bound

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

    // 2. Simulation starten
    await monacoEditor.waitForReady();
    await startSimulation();
    await expect(page.getByRole("button", { name: /stop simulation/i })).toBeVisible({ timeout: 15000 });

    // 3. Debug-Mode aktivieren
    await page.evaluate(() => {
      localStorage.setItem("debugMode", "true");
      window.dispatchEvent(new StorageEvent("storage", { key: "debugMode", newValue: "true" }));
    });

    // 4. Metriken alle 2 Sekunden über 10 Sekunden sammeln
    const measurements: { batchesPerSecond: number; time: number }[] = [];

    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(2000);

      const batchingSection = page.locator('text="BATCHING"').first();
      if (await batchingSection.isVisible().catch(() => false)) {
        const batchingText = await batchingSection.locator("..").locator("span").nth(1).textContent();
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
