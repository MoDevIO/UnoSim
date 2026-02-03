import { test, expect } from './fixtures/test-base';
import { startSimulation } from './fixtures/test-base';

test.describe('PWM-Controller', () => {
  test('PWM-Controller Validierung', async ({ page, startSimulation, stopSimulation }) => {
    // Enable pin-monitor via localStorage
    await page.addInitScript(() => {
      window.localStorage.setItem('unoPinMonitorVisible', '1');
    });
    await page.goto('/');

    // Wait for UI to load
    const pinMonitor = page.locator('[data-testid="pin-monitor"]');
    await pinMonitor.waitFor({ state: 'attached' });
    await expect(pinMonitor).toBeVisible();

    // Stop any running simulation and wait for clean shutdown
    await stopSimulation();
    await page.waitForTimeout(500);

    // Load a sketch that outputs PWM on Pin 9
    const code = `void setup() {\n  pinMode(9, OUTPUT);\n}\nvoid loop() {\n  analogWrite(9, 128);\n}`;
    await page.waitForFunction(() => typeof window.setEditorContent === 'function');
    await page.evaluate((code) => window.setEditorContent(code), code);

    // Wait for code to be registered in the editor
    await page.waitForTimeout(500);

    // Start simulation with new code
    await startSimulation();
    
    // Wait for PWM signal to stabilize
    await page.waitForTimeout(1000);

    // Find the Pin 9 display element in the Pin-Monitor
    const pinDiv = page.locator('div[data-pin="9"]');
    await pinDiv.waitFor({ state: 'attached' });
    await expect(pinDiv).toBeVisible();

    // The PWM value is stored in an inner span's text content
    const pwmValueSpan = pinDiv.locator('span[data-value="true"]');
    await pwmValueSpan.waitFor({ state: 'attached' });
    
    // Wait for PWM value to stabilize
    await page.waitForTimeout(500);
    
    // Read and parse the PWM value
    const pwmText = await pwmValueSpan.textContent();
    expect(pwmText).not.toBeNull();
    
    const valueNum = Number(pwmText);
    expect(valueNum).not.toBeNaN();
    expect(valueNum).toBeGreaterThanOrEqual(0);
    expect(valueNum).toBeLessThanOrEqual(255);
    
    // Validate PWM value is within expected tolerance range
    // Expected value: ~128, with tolerance for signal oscillation: [100-150]
    expect(valueNum).toBeGreaterThanOrEqual(100);
    expect(valueNum).toBeLessThanOrEqual(150);

    // Cleanup
    await stopSimulation();
  });
});
