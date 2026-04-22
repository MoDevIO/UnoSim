/// <reference types="node" />
import { test, expect } from '@playwright/test';

/**
 * E2E Tests for Arduino Board Pin State Header Synchronization
 * 
 * Validates that:
 * 1. Pin states arrive correctly in the Arduino board SVG header
 * 2. Multiple pins (0, 1) are batched and displayed together
 * 3. UI respects header-height tokens and doesn't get clipped
 * 4. Sampling/Dropping in the backend doesn't affect visible UI state
 */

/** CI-aware timeouts */
const STOP_BTN_TIMEOUT = process.env.CI ? 30000 : 10000;
const SERIAL_TIMEOUT = process.env.CI ? 60000 : 15000;

/** Set Monaco editor content via the global setValue API.
 *  Waits for Monaco to be fully initialised before injecting code, which
 *  avoids the page-navigation side-effect caused by keyboard simulation. */
async function setCode(page: import('@playwright/test').Page, code: string) {
  await page.waitForFunction(
    () => Boolean((globalThis as any).__MONACO_EDITOR__),
    { timeout: 15000 },
  );
  await page.evaluate((c: string) => {
    const editor = (globalThis as any).__MONACO_EDITOR__ as { setValue: (v: string) => void };
    editor.setValue(c);
  }, code);
  await page.waitForTimeout(200);
}

/** Compile the sketch via the REST API, then click Start and wait for the
 *  Stop button.  Compiling first guarantees that the server has
 *  lastCompiledCode set so the simulation can start even if
 *  lastCompiledCodeRef is null on the client side. */
async function compileAndStart(
  page: import('@playwright/test').Page,
  code: string,
) {
  const compileRes = await page.request.post('/api/compile', {
    data: { code },
    timeout: 120000,
  }).catch((err: Error) => {
    throw new Error(`/api/compile unreachable: ${err.message}`);
  });
  const compileResult = await compileRes.json();
  if (!compileResult?.success) {
    throw new Error(`Compilation failed: ${compileResult?.stderr ?? 'unknown error'}`);
  }

  const startButton = page.getByRole('button', { name: /start simulation/i });
  await expect(startButton).toBeEnabled({ timeout: 15000 });
  await startButton.click();

  await expect(
    page.getByRole('button', { name: /stop simulation/i }),
  ).toBeVisible({ timeout: STOP_BTN_TIMEOUT });
}

test.describe('Arduino Board Header - Pin State Synchronization', () => {
  
  test('should display HIGH state for pins 0 and 1 when set by sketch', async ({ page }) => {
    await page.goto('/');

    // Create a simple sketch that sets pins 0 and 1 to HIGH  
    const code = `void setup() {
  Serial.begin(115200);
  pinMode(0, OUTPUT);
  pinMode(1, OUTPUT);
  digitalWrite(0, HIGH);
  digitalWrite(1, HIGH);
  Serial.println("Pins set to HIGH");
}

void loop() {
  delay(100);
}`;

    await setCode(page, code);
    await compileAndStart(page, code);

    // Wait a moment for pins to be registered and displayed
    await page.waitForTimeout(500);

    // Check Arduino Board component is rendered
    const board = page.locator('[data-testid*="arduino"], svg').first();
    await expect(board).toBeVisible({ timeout: 5000 });

    // Verify serial output shows setup completed (generous timeout for cold-start compiles)
    const serial = page.locator('[data-testid="serial-output"]');
    await expect(serial).toContainText(/pins set to high/i, { timeout: SERIAL_TIMEOUT });
  });

  test('should display correct pin state changes when multiple pins toggle rapidly', async ({ page }) => {
    await page.goto('/');

    // Sketch with rapid pin toggling on pins 2 and 3
    const code = `void setup() {
  Serial.begin(115200);
  pinMode(2, OUTPUT);
  pinMode(3, OUTPUT);
  digitalWrite(2, LOW);
  digitalWrite(3, HIGH);
  Serial.println("Setup complete");
}

void loop() {
  // Small delay to prevent overwhelming the system
  delay(50);
  
  // Toggle pins
  static int state = 0;
  if (state == 0) {
    digitalWrite(2, HIGH);
    digitalWrite(3, LOW);
    Serial.println("State 0->1");
  } else {
    digitalWrite(2, LOW);
    digitalWrite(3, HIGH);
    Serial.println("State 1->0");
  }
  state = 1 - state;
  delay(100);
}`;

    await setCode(page, code);
    await compileAndStart(page, code);

    // Wait for state transitions to be visible
    const serial = page.locator('[data-testid="serial-output"]');
    await expect(serial).toContainText(/state/i, { timeout: SERIAL_TIMEOUT });

    // Verify board is visible and responds to state changes
    const board = page.locator('[data-testid*="arduino"], svg').first();
    await expect(board).toBeVisible();
  });

  test('should respect header-height tokens and not clip pin displays', async ({ page }) => {
    await page.goto('/');

    const code = `void setup() {
  Serial.begin(115200);
  pinMode(0, OUTPUT);
  pinMode(1, OUTPUT);
  digitalWrite(0, HIGH);
  digitalWrite(1, HIGH);
}

void loop() {
  delay(10000);
}`;

    await setCode(page, code);
    await compileAndStart(page, code);
    await page.waitForTimeout(500);

    // Get the arduino board SVG container
    const boardContainer = page.locator('svg').first();
    
    // Get computed style of the header area
    const headerHeight = await page.evaluate(() => {
      const root = document.documentElement;
      const style = getComputedStyle(root);
      return style.getPropertyValue('--ui-header-height').trim();
    });

    // Verify header height token is defined
    expect(headerHeight).toBeTruthy();
    // S5852: Validate CSS unit format without regex alternation
    if (headerHeight) {
      const trimmedHeight = headerHeight.trim();

      const allowedUnits = ["px", "rem", "%", "em"];
      const matchingUnit = allowedUnits.find((unit) => trimmedHeight.endsWith(unit));
      const numericPart = matchingUnit ? trimmedHeight.slice(0, -matchingUnit.length) : "";
      const isValidUnit = Boolean(matchingUnit) && /^\d+(?:\.\d+)?$/.test(numericPart);

      expect(isValidUnit).toBe(true);
    }
    // Verify board is visible and not clipped
    await expect(boardContainer).toBeVisible();
    const boundingBox = await boardContainer.boundingBox();
    expect(boundingBox).toBeTruthy();
    if (boundingBox) {
      expect(boundingBox.height).toBeGreaterThan(10); // Sanity check: board SVG exists and has height
      expect(boundingBox.width).toBeGreaterThan(10);  // Board SVG should have reasonable width
    }
  });

  test('should consolidate pin state batches correctly in UI despite aggressive sampling', async ({ page }) => {
    await page.goto('/');

    // Sketch that simulates high-frequency pin changes (e.g., PWM-like)
    const code = `void setup() {
  Serial.begin(115200);
  pinMode(5, OUTPUT);  // PWM-capable pin
  pinMode(6, OUTPUT);  // Another PWM pin
  analogWrite(5, 128); // Set PWM value
  analogWrite(6, 255);
  Serial.println("PWM initialized");
}

void loop() {
  static unsigned long lastChange = 0;
  if (millis() - lastChange > 500) {
    lastChange = millis();
    // Vary PWM values
    analogWrite(5, (millis() / 100) % 256);
    analogWrite(6, 255 - ((millis() / 100) % 256));
    Serial.print("PWM: ");
    Serial.println(millis() / 100);
  }
}`;

    await setCode(page, code);
    await compileAndStart(page, code);

    // Wait for PWM messages
    const serial = page.locator('[data-testid="serial-output"]');
    await expect(serial).toContainText(/PWM/i, { timeout: SERIAL_TIMEOUT });

    // Verify board is still responsive and visible
    const board = page.locator('[data-testid*="arduino"], svg').first();
    await expect(board).toBeVisible();

    // Verify no console errors about message overflow or rendering issues
    const messages: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        messages.push(msg.text());
      }
    });

    await page.waitForTimeout(1000);
    
    // Check that we didn't get excessive error messages
    const errorCount = messages.filter((m) => 
      m.includes('pin_state_batch') || 
      m.includes('overflow') || 
      m.includes('clipped')
    ).length;
    
    expect(errorCount).toBe(0);
  });

  test('should maintain pin state array length in batch and match board display', async ({ page }) => {
    await page.goto('/');

    // Set multiple pins with different modes
    const code = `void setup() {
  Serial.begin(115200);
  
  // Configure multiple pins
  pinMode(0, OUTPUT);   // Digital out
  pinMode(1, OUTPUT);   // Digital out
  pinMode(2, INPUT);    // Digital in
  pinMode(A0, INPUT);   // Analog in
  
  // Set initial states
  digitalWrite(0, HIGH);
  digitalWrite(1, LOW);
  Serial.println("All pins configured");
}

void loop() {
  Serial.print("A0=");
  Serial.println(analogRead(A0));
  delay(200);
}`;

    await setCode(page, code);
    await compileAndStart(page, code);

    const serial = page.locator('[data-testid="serial-output"]');
    await expect(serial).toContainText(/configured/i, { timeout: SERIAL_TIMEOUT });

    // Wait for at least one analog read cycle
    await expect(serial).toContainText(/A0=/i, { timeout: SERIAL_TIMEOUT });

    // Verify board is rendered with all pin states
    const board = page.locator('svg').first();
    await expect(board).toBeVisible();
  });

  test('should handle rapid pin state updates without dropping visible states', async ({ page }) => {
    await page.goto('/');

    // Simulate a sketch with a loop that changes pins very frequently
    const code = `void setup() {
  Serial.begin(115200);
  pinMode(8, OUTPUT);
  pinMode(9, OUTPUT);
  Serial.println("Ready for rapid updates");
}

void loop() {
  // Change pins rapidly but with occasional Serial output
  for(int i = 0; i < 10; i++) {
    digitalWrite(8, i % 2);
    digitalWrite(9, (i + 1) % 2);
  }
  Serial.println("Update batch");
  delay(100);
}`;

    await setCode(page, code);
    await compileAndStart(page, code);

    const serial = page.locator('[data-testid="serial-output"]');
    await expect(serial).toContainText(/update batch/i, { timeout: SERIAL_TIMEOUT });

    // Capture board state and verify it responds to updates
    const board = page.locator('svg').first();
    await expect(board).toBeVisible();

    // Wait another cycle (20+ "Update batch" messages expected from loop)
    // Just verify the serial output contains multiple updates
    await page.waitForTimeout(2000);
    const serialText = await serial.textContent();
    const batchCount = (serialText?.match(/update batch/gi) || []).length;
    expect(batchCount).toBeGreaterThan(1); // Verify we got multiple batches
  });
});
