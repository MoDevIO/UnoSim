import { test, expect, type WebSocketRoute } from '@playwright/test';

// A dropped simulation socket must not leave the UI on "running": the server
// ends that connection's run, so the client returns to idle and can start again.

const code = `void setup() {
  Serial.begin(115200);
}
void loop() {
  Serial.println("TICK");
  delay(100);
}`;

test('connection loss during a run returns the UI to idle and a new run works after reconnect', async ({ page }) => {
  const sockets: Array<{ page: WebSocketRoute; server: WebSocketRoute }> = [];
  // While the "network" is down, reconnect attempts fail like an unreachable server.
  let networkDown = false;
  await page.routeWebSocket(/\/ws(\?|$)/, async (ws) => {
    if (networkDown) {
      await ws.close({ code: 1006 });
      return;
    }
    sockets.push({ page: ws, server: ws.connectToServer() });
  });

  await page.goto('/');
  await page.waitForFunction(() => Boolean((globalThis as unknown as Record<string, unknown>)['__MONACO_EDITOR__']), { timeout: 15000 });
  await page.evaluate((sketch: string) => {
    const editor = (globalThis as unknown as Record<string, unknown>)['__MONACO_EDITOR__'] as { setValue: (v: string) => void };
    editor.setValue(sketch);
  }, code);

  const compileRes = await page.request.post('/api/compile', { data: { code }, timeout: 120000 });
  expect((await compileRes.json())?.success).toBe(true);
  await page.evaluate((c: string) => {
    const setter = (globalThis as Record<string, unknown>).__SET_LAST_COMPILED_CODE__ as ((code: string) => void) | undefined;
    if (setter) setter(c);
  }, code);

  const startButton = page.getByRole('button', { name: /start simulation/i });
  const stopButton = page.getByRole('button', { name: /stop simulation/i });
  const serial = page.locator('[data-testid="serial-output"]');
  const serialTimeout = process.env.CI ? 60000 : 15000;

  await startButton.click();
  await expect(stopButton).toBeVisible({ timeout: 10000 });
  await expect(serial).toContainText(/TICK/, { timeout: serialTimeout });

  // Drop the live connection on both ends, as a network interruption would, and
  // keep the server unreachable so no reconnect can resynchronise the status.
  networkDown = true;
  const live = sockets.splice(0);
  for (const { page: pageSide, server } of live) {
    await server.close();
    await pageSide.close({ code: 1006 });
  }

  await expect(startButton).toBeVisible({ timeout: 10000 });
  await expect(stopButton).toHaveCount(0);
  await expect(serial).toContainText(/connection to the server was lost/i);
  expect(sockets).toHaveLength(0);

  // Once the server is reachable again the client reconnects; a fresh run starts normally.
  networkDown = false;
  await expect.poll(() => sockets.length, { timeout: 30000 }).toBeGreaterThan(0);
  await expect(startButton).toBeEnabled({ timeout: 30000 });
  await startButton.click();
  await expect(stopButton).toBeVisible({ timeout: 10000 });
});
