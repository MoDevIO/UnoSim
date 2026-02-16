import { test, expect } from "./fixtures/test-base";

test.describe("WebSocket integration — happy path", () => {
  test("connect → Compile&Start sends start_simulation → serial + pin_state flow", async ({
    page,
    monacoEditor,
    startSimulation,
    stopSimulation,
  }) => {
    test.setTimeout(45000);

    // Ensure clean backend state
    await page.context().request.post("/api/test-reset").catch(() => {});

    // Start capturing page console / errors BEFORE navigation to help debug load failures
    page.on('console', (msg) => {
      console.log(`[PAGE ${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      console.log('[PAGE ERROR]', err?.message || err);
    });

    // Wait for the page to open its application WS (ignore vite HMR socket)
    const [ws] = await Promise.all([
      page.waitForEvent("websocket", { predicate: (s) => (s.url() || "").includes("/ws") }),
      page.goto("/"),
    ]);

    // Wait for the Monaco editor to appear (longer timeout to be resilient)
    await page.waitForSelector('.monaco-editor', { state: 'visible', timeout: 30000 });
    await monacoEditor.waitForReady();

    // Wait until the internal manager reports connected
    await expect.poll(
      async () => await page.evaluate(() => (window as any).__wsManager().getState()),
      { timeout: 15000 },
    ).toBe("connected");

    // Load example that emits serial + toggles pin 13 (LED)
    await page.getByRole("button", { name: /examples/i }).click();
    const arduinoIoFolder = page.locator('[data-role="example-folder"]').filter({ hasText: "arduino-io" });
    await expect(arduinoIoFolder).toBeVisible();
    await arduinoIoFolder.click();

    const digitalWriteExample = page.locator('[data-role="example-item"]').filter({ hasText: "digital-pin-write" });
    await expect(digitalWriteExample).toBeVisible();
    await digitalWriteExample.click();
    await page.keyboard.press("Escape");

    // Prepare to capture the outgoing start_simulation WS frame
    const startFramePromise = ws.waitForEvent("framesent", {
      predicate: (frame) => typeof frame.payload === "string" && frame.payload.includes('"type":"start_simulation"'),
    });

    // Start simulation (this triggers compile & start flow which sends start_simulation)
    await startSimulation();

    // Assert that start_simulation was sent over the WebSocket
    const startFrame = await startFramePromise;
    expect(startFrame.payload).toContain('"type":"start_simulation"');

    // Ensure simulation is running in the UI
    await expect(page.getByRole("button", { name: /stop simulation/i })).toBeVisible({ timeout: 15000 });

    // Verify Serial output appears (example prints "LED ON" / "LED OFF")
    const serialViewport = page.locator('[data-testid="serial-output"]');
    await expect.poll(async () => {
      const txt = await serialViewport.textContent();
      return !!txt && txt.includes("LED ON");
    }, { timeout: 15000 }).toBe(true);

    // Verify pin 13 visual LED toggles (check built-in LED element '#led-l')
    const led = page.locator('#led-l');
    await expect.poll(async () => {
      const fill = await led.getAttribute('fill');
      return fill && fill !== 'transparent';
    }, { timeout: 15000 }).toBe(true);

    // Cleanup: stop simulation
    await stopSimulation();
  });
});
