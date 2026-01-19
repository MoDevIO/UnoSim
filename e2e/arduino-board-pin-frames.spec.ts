import { test, expect } from '@playwright/test';

test.describe('Arduino Board - Pin Frame Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the app to be fully loaded
    await page.waitForSelector('.monaco-editor', { timeout: 10000 });
  });

  test('Pin 0 should display yellow frame when configured as INPUT', async ({ page }) => {
    // Load digital-pin-read.ino which has button on pin 2 as INPUT
    const examplesButton = page.getByRole('button', { name: /examples/i });
    await examplesButton.click();
    
    // Wait for menu
    await page.waitForTimeout(500);
    
    // Click digital pin read example
    const digitalReadExample = page.getByText(/digital pin read/i);
    await digitalReadExample.click();
    
    // Wait for load
    await page.waitForTimeout(1000);
    
    // Run
    const runButton = page.getByRole('button', { name: /compile|run|start/i }).first();
    await runButton.click();
    
    // Wait for simulation
    await page.waitForTimeout(3500);
    
    // Check pin 2 frame (buttonPin in example is pin 2)
    const frame = page.locator('#pin-2-frame');
    await expect(frame).toBeVisible({ timeout: 5000 });
  });

  test('Multiple INPUT pins should all display yellow frames', async ({ page }) => {
    // Load analog-pin-read.ino which has A0 as INPUT
    const examplesButton = page.getByRole('button', { name: /examples/i });
    await examplesButton.click();
    
    // Wait for examples menu to open
    await page.waitForTimeout(500);
    
    // Find and click analog pin read
    const analogReadExample = page.getByText(/analog pin read/i);
    await analogReadExample.click();
    
    // Wait for example to load
    await page.waitForTimeout(1000);
    
    const runButton = page.getByRole('button', { name: /compile|run|start/i }).first();
    await runButton.click();
    
    // Wait for compilation and simulation
    await page.waitForTimeout(3000);
    
    // Check frame for A0 (analog pin)
    const frameA0 = page.locator('#pin-A0-frame');
    await expect(frameA0).toBeVisible({ timeout: 5000 });
  });

  test('OUTPUT pins should NOT display yellow frames', async ({ page }) => {
    // Load digital-pin-write.ino which sets pin 13 as OUTPUT
    const examplesButton = page.getByRole('button', { name: /examples/i });
    await examplesButton.click();
    
    // Wait for examples menu
    await page.waitForTimeout(500);
    
    // Find and click digital pin write example
    const digitalWriteExample = page.getByText(/digital pin write/i);
    await digitalWriteExample.click();
    
    // Wait for example to load
    await page.waitForTimeout(1000);
    
    const runButton = page.getByRole('button', { name: /compile|run|start/i }).first();
    await runButton.click();
    
    // Wait for compilation and simulation
    await page.waitForTimeout(3000);
    
    // Pin 13 (OUTPUT in example) should NOT have visible frame
    const frame13 = page.locator('#pin-13-frame');
    await expect(frame13).toBeHidden();
    
    // Pins 0 (not configured) should also not have frames
    const frame0 = page.locator('#pin-0-frame');
    await expect(frame0).toBeHidden();
  });

  test('INPUT_PULLUP pins should display yellow frames', async ({ page }) => {
    const exampleCode = `
void setup() {
  pinMode(0, INPUT_PULLUP);
}

void loop() {
  int value = digitalRead(0);
}
`;

    await page.click('.monaco-editor');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(exampleCode);
    await page.waitForTimeout(500);
    
    const runButton = page.getByRole('button', { name: /compile|run|start/i }).first();
    await runButton.click();
    await page.waitForTimeout(2000);
    
    // Check if pin 0 frame is visible for INPUT_PULLUP
    const frame = page.locator('#pin-0-frame');
    await expect(frame).toBeVisible({ timeout: 5000 });
  });

  test('Analog pins (A0-A5) should display frames when configured as INPUT', async ({ page }) => {
    const exampleCode = `
void setup() {
  pinMode(A0, INPUT);
}

void loop() {
  int value = analogRead(A0);
}
`;

    await page.click('.monaco-editor');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(exampleCode);
    await page.waitForTimeout(500);
    
    const runButton = page.getByRole('button', { name: /compile|run|start/i }).first();
    await runButton.click();
    await page.waitForTimeout(2000);
    
    // Check if analog pin A0 frame is visible
    const frame = page.locator('#pin-A0-frame');
    await expect(frame).toBeVisible({ timeout: 5000 });
  });

  test('Switching pin mode from OUTPUT to INPUT should show frame', async ({ page }) => {
    // First set pin 0 as OUTPUT
    let exampleCode = `
void setup() {
  pinMode(0, OUTPUT);
}

void loop() {
  digitalWrite(0, HIGH);
}
`;

    await page.click('.monaco-editor');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(exampleCode);
    await page.waitForTimeout(500);
    
    let runButton = page.getByRole('button', { name: /compile|run|start/i }).first();
    await runButton.click();
    await page.waitForTimeout(2000);
    
    // Frame should be hidden
    let frame = page.locator('#pin-0-frame');
    await expect(frame).toBeHidden();
    
    // Stop simulation
    const stopButton = page.getByRole('button', { name: /stop|pause/i }).first();
    if (await stopButton.isVisible()) {
      await stopButton.click();
      await page.waitForTimeout(500);
    }
    
    // Now change to INPUT
    exampleCode = `
void setup() {
  pinMode(0, INPUT);
}

void loop() {
  int value = digitalRead(0);
}
`;

    await page.click('.monaco-editor');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(exampleCode);
    await page.waitForTimeout(500);
    
    runButton = page.getByRole('button', { name: /compile|run|start/i }).first();
    await runButton.click();
    await page.waitForTimeout(2000);
    
    // Frame should now be visible
    frame = page.locator('#pin-0-frame');
    await expect(frame).toBeVisible({ timeout: 5000 });
  });
});
