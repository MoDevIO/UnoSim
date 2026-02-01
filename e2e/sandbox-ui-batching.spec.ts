import { test, expect } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.describe("Sandbox UI Batching Integration", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("unoPinMonitorVisible", "1");
      } catch {}
    });
    await page.goto("/");
    await page.waitForSelector(".monaco-editor", { timeout: 10000 });
    await page.evaluate(() => {
      try {
        window.localStorage.setItem("unoPinMonitorVisible", "1");
        window.dispatchEvent(
          new CustomEvent("pinMonitorVisibleChange", {
            detail: { value: true },
          }),
        );
      } catch {}
    });
  });

  const loadMasterTestSketch = async (page: any) => {
    const examplesButton = page.getByRole("button", { name: /examples/i });
    await examplesButton.click();

    await page.waitForTimeout(400);

    const testsFolder = page
      .locator('[data-role="example-folder"]')
      .filter({ hasText: "tests" });
    await testsFolder.click();

    await page.waitForTimeout(300);

    const masterTest = page
      .locator('[data-role="example-item"]')
      .filter({ hasText: "master-test.ino" });
    await masterTest.click();

    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  };

  const startSimulation = async (page: any) => {
    const runButton = page.locator('[data-testid="button-simulate-toggle"]');
    await runButton.click();
    await expect(
      page.getByRole("button", { name: /stop simulation/i }),
    ).toBeVisible({ timeout: 15000 });
  };

  const stopSimulation = async (page: any) => {
    const runButton = page.locator('[data-testid="button-simulate-toggle"]');
    await runButton.click();
    await expect(
      page.getByRole("button", { name: /start simulation/i }),
    ).toBeVisible({ timeout: 15000 });
  };

  const getPinMonitor = (page: any) => page.locator('[data-testid="pin-monitor"]');

  const getPinRow = (pinMonitor: any, pin: number) =>
    pinMonitor.locator(`[data-pin="${pin}"]`);

  const getPinValue = async (pinMonitor: any, pin: number) => {
    const row = getPinRow(pinMonitor, pin);
    return row.locator("[data-value]").textContent();
  };

  test("master-test integration flow", async ({ page }) => {
    await loadMasterTestSketch(page);
    await startSimulation(page);

    const pinMonitor = getPinMonitor(page);
    await expect(pinMonitor).toBeVisible({ timeout: 10000 });

    // Enable FPS counter
    const fpsToggle = pinMonitor.getByRole("button", { name: /show fps/i });
    await fpsToggle.click();

    // Wait for pin 13 to appear (registry + first updates)
    await expect(getPinRow(pinMonitor, 13)).toBeVisible({ timeout: 10000 });

    // Serial Interaction: send command "1" and verify pin 13 toggles quickly
    const serialInput = page.locator('[data-testid="input-serial"]');
    const serialSend = page.locator('[data-testid="button-send-serial"]');

    const initialValue = await getPinValue(pinMonitor, 13);

    await serialInput.fill("1");
    await serialSend.click();

    await expect(
      page.getByText(/LED State changed to:/i),
    ).toBeVisible({ timeout: 2000 });

    await expect.poll(
      async () => getPinValue(pinMonitor, 13),
      { timeout: 1000 },
    ).not.toBe(initialValue);

    // PWM smoothing: send command "2" and verify PWM value changes smoothly
    await serialInput.fill("2");
    await serialSend.click();

    await expect(getPinRow(pinMonitor, 9)).toBeVisible({ timeout: 5000 });

    await expect.poll(
      async () => Number(await getPinValue(pinMonitor, 9)),
      { timeout: 2000 },
    ).not.toBeNaN();

    const pwmValue1 = Number(await getPinValue(pinMonitor, 9));
    await page.waitForTimeout(200);
    const pwmValue2 = Number(await getPinValue(pinMonitor, 9));
    await page.waitForTimeout(200);
    const pwmValue3 = Number(await getPinValue(pinMonitor, 9));

    expect(pwmValue1).not.toBeNaN();
    expect(pwmValue2).not.toBeNaN();
    expect(pwmValue3).not.toBeNaN();
    expect(pwmValue2).not.toBe(pwmValue3);

    // FPS counter: ensure batch time <= 18ms (approx 55+ FPS)
    const batchLine = pinMonitor.getByText(/Batch ms:/i);
    await expect.poll(
      async () => {
        const batchText = await batchLine.textContent();
        return Number(batchText?.replace(/[^0-9.]/g, ""));
      },
      { timeout: 2000 },
    ).not.toBeNaN();

    const batchText = await batchLine.textContent();
    const batchMs = Number(batchText?.replace(/[^0-9.]/g, ""));
    expect(batchMs).toBeGreaterThanOrEqual(0);
    expect(batchMs).toBeLessThan(18.2);

    // Stress resilience: UI remains responsive (scroll + click)
    await page.mouse.wheel(0, 400);
    await serialInput.click();
    await serialInput.type("ping");
    await serialInput.fill("");

    // Final check: stop and restart should clear stale data
    await stopSimulation(page);
    await expect(getPinRow(pinMonitor, 13)).toHaveCount(0);

    await startSimulation(page);
    await expect(getPinRow(pinMonitor, 13)).toBeVisible({ timeout: 10000 });
  });
});
