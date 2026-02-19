import { test, expect } from "./fixtures/test-base";

test.describe("Stop reliability — long-running sketch (lauflicht)", () => {
  test("stopping a running lauflicht sketch reliably terminates simulation and output", async ({
    page,
    monacoEditor,
    startSimulation,
    stopSimulation,
  }) => {
    test.setTimeout(45000);

    // Ensure clean backend state
    await page.context().request.post("/api/test-reset").catch(() => {});

    // Capture page console / errors to help debug in CI
    page.on('console', (msg) => console.log(`[PAGE ${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => console.log('[PAGE ERROR]', err?.message || err));

    // Log compile HTTP responses for diagnostics
    page.on('requestfinished', async (req) => {
      try {
        if (req.url().includes('/api/compile')) {
          const res = await req.response();
          console.log(`[HTTP ${res?.status()}] ${req.method()} ${req.url()}`);
        }
      } catch (e) {
        /* ignore */
      }
    });

    await page.goto("/");
    await page.waitForSelector('.monaco-editor', { state: 'visible', timeout: 15000 });
    await monacoEditor.waitForReady();

    const lauflicht = `
void setup() {
  pinMode(8, OUTPUT);
  pinMode(9, OUTPUT);
  pinMode(10, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  for (int i = 8; i <= 10; i++) {
    digitalWrite(i, HIGH);
    Serial.print("LED ");
    Serial.print(i);
    Serial.println(" ON");
    delay(100);
    digitalWrite(i, LOW);
    Serial.print("LED ");
    Serial.print(i);
    Serial.println(" OFF");
    delay(100);
  }
}
`;

    // Load the lauflicht code into the editor
    await monacoEditor.setValue(lauflicht);
    await monacoEditor.waitForReady();

    // Start simulation and ensure it's running
    await startSimulation();
    await expect(page.getByRole("button", { name: /stop simulation/i })).toBeVisible({ timeout: 15000 });

    // Wait for serial output to appear (indicates the sketch is running)
    const serialViewport = page.locator('[data-testid="serial-output"]');
    await expect.poll(async () => {
      const txt = await serialViewport.textContent();
      return !!txt && txt.includes("LED 8 ON");
    }, { timeout: 15000 }).toBe(true);

    // Record serial content and stop the simulation
    const before = (await serialViewport.textContent()) || "";
    await stopSimulation();

    // After stopping, UI should show start/resume button and the stop marker should appear
    await expect(page.getByRole("button", { name: /start simulation|resume simulation/i })).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => {
      const txt = await serialViewport.textContent();
      return !!txt && txt.includes('--- Simulation stopped ---');
    }, { timeout: 5000 }).toBe(true);

    // Snapshot the serial content after the stop marker — no further output should appear afterwards
    const stoppedContent = (await serialViewport.textContent()) || "";
    await page.waitForTimeout(1200);
    const after = (await serialViewport.textContent()) || "";
    expect(after).toBe(stoppedContent);

    // Finally, ensure we can start again (no stuck state)
    await startSimulation();
    await expect(page.getByRole("button", { name: /stop simulation/i })).toBeVisible({ timeout: 15000 });
    await stopSimulation();
  });
});
