import { test, expect } from '@playwright/test';

// small smoke and basic flow to verify core UI functionality

// Test 1: smoke page load
test('smoke - home loads and start button visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /start simulation/i })).toBeVisible();
});

// Test 2: golden path Blink example
// Uses __MONACO_EDITOR__ (exposed globally by code-editor.tsx) for reliable
// content injection — avoids flaky keyboard simulation in headless CI.

test('golden path - load blink, start, see running & serial output', async ({ page }) => {
  await page.goto('/');

  const code = `void setup() {
  Serial.begin(115200);
  pinMode(13, OUTPUT);
}
void loop() {
  digitalWrite(13, HIGH);
  Serial.println("LED ON");
  delay(100);
  digitalWrite(13, LOW);
  Serial.println("LED OFF");
  delay(100);
}`;

  // Wait until Monaco is fully initialised (the editor hook exposes __MONACO_EDITOR__)
  await page.waitForFunction(() => Boolean((globalThis as unknown as Record<string, unknown>)['__MONACO_EDITOR__']), { timeout: 15000 });

  // Inject code directly via the editor instance — reliable in any environment
  await page.evaluate((sketch: string) => {
    const editor = (globalThis as unknown as Record<string, unknown>)['__MONACO_EDITOR__'] as { setValue: (v: string) => void };
    editor.setValue(sketch);
  }, code);

  // start simulation - use accessible role lookup
  const startButton = page.getByRole('button', { name: /start simulation/i });
  await expect(startButton).toBeVisible({ timeout: 10000 });
  await startButton.click();

  // wait for the main status text (not the notification) to mention running
  const status = page.locator('div.text-ui-sm.opacity-90', { hasText: /running/i });
  await expect(status).toBeVisible({ timeout: 10000 });

  // serial monitor shows LED ON or similar output
  const serial = page.locator('[data-testid="serial-output"]');
  // CI runners are slower; give them up to 30 seconds to start emitting
  const serialTimeout = process.env.CI ? 30000 : 10000;
  await expect(serial).toContainText(/LED/i, { timeout: serialTimeout });
});

// Test 3: dialog interactions

test('dialogs - open and close settings menu', async ({ page }) => {
  await page.goto('/');
  // use app event to open settings dialog instead of clicking header
  await page.evaluate(() => {
    globalThis.dispatchEvent(new CustomEvent('open-settings'));
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.click('button:has-text("Close")');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
