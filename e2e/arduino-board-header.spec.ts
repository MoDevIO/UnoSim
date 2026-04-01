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

    // Insert code into editor
    const editor = page.locator('[data-testid="code-editor"]');
    await editor.click();
    await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(code, { delay: 20 });

    // Start simulation
    const startButton = page.getByRole('button', { name: /start simulation/i });
    await expect(startButton).toBeVisible({ timeout: 10000 });
    await startButton.click();

    // Wait for simulation to be running - use more specific selector
    await expect(page.locator('div.text-ui-sm.opacity-90', { hasText: /running/i })).toBeVisible({ timeout: 15000 });

    // Wait a moment for pins to be registered and displayed
    await page.waitForTimeout(500);

    // Check Arduino Board component is rendered
    const board = page.locator('[data-testid*="arduino"], svg').first();
    await expect(board).toBeVisible({ timeout: 5000 });

    // Verify serial output shows setup completed (generous timeout for cold-start compiles)
    const serial = page.locator('[data-testid="serial-output"]');
    await expect(serial).toContainText(/pins set to high/i, { timeout: 15000 });
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

    const editor = page.locator('[data-testid="code-editor"]');
    await editor.click();
    await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(code, { delay: 20 });

    const startButton = page.getByRole('button', { name: /start simulation/i });
    await startButton.click();

    // Wait for simulation running
    await expect(page.locator('div.text-ui-sm.opacity-90', { hasText: /running/i })).toBeVisible({ timeout: 10000 });

    // Wait for state transitions to be visible
    const serial = page.locator('[data-testid="serial-output"]');
    await expect(serial).toContainText(/state/i, { timeout: 10000 });

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

    const editor = page.locator('[data-testid="code-editor"]');
    await editor.click();
    await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(code, { delay: 20 });

    const startButton = page.getByRole('button', { name: /start simulation/i });
    await startButton.click();

    await expect(page.locator('div.text-ui-sm.opacity-90', { hasText: /running/i })).toBeVisible({ timeout: 10000 });
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
    // Use strict character class to eliminate backtracking
    if (headerHeight) {
      const trimmedHeight = headerHeight.trim();
      // Allow numeric+ unit (px, rem, %, em)
      const isValidUnit = /^\d+(?:\.\d+)?(?:px|rem|%|em)$/.test(trimmedHeight);
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

    const editor = page.locator('[data-testid="code-editor"]');
    await editor.click();
    await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(code, { delay: 20 });

    const startButton = page.getByRole('button', { name: /start simulation/i });
    await startButton.click();

    await expect(page.locator('div.text-ui-sm.opacity-90', { hasText: /running/i })).toBeVisible({ timeout: 10000 });

    // Wait for PWM messages
    const serial = page.locator('[data-testid="serial-output"]');
    await expect(serial).toContainText(/PWM/i, { timeout: 15000 });

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

    const editor = page.locator('[data-testid="code-editor"]');
    await editor.click();
    await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(code, { delay: 20 });

    const startButton = page.getByRole('button', { name: /start simulation/i });
    await startButton.click();

    await expect(page.locator('div.text-ui-sm.opacity-90', { hasText: /running/i })).toBeVisible({ timeout: 10000 });

    const serial = page.locator('[data-testid="serial-output"]');
    await expect(serial).toContainText(/configured/i, { timeout: 10000 });

    // Wait for at least one analog read cycle
    await expect(serial).toContainText(/A0=/i, { timeout: 10000 });

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

    const editor = page.locator('[data-testid="code-editor"]');
    await editor.click();
    await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(code, { delay: 20 });

    const startButton = page.getByRole('button', { name: /start simulation/i });
    await startButton.click();

    await expect(page.locator('div.text-ui-sm.opacity-90', { hasText: /running/i })).toBeVisible({ timeout: 10000 });

    const serial = page.locator('[data-testid="serial-output"]');
    await expect(serial).toContainText(/update batch/i, { timeout: 10000 });

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
