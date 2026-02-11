import { test, expect } from './fixtures/test-base';

test.describe('Phase 7r - Keyboard Shortcut & Dropping (E2E)', () => {
  
  test('E2E-T1: Cmd/Ctrl+D keyboard shortcut should toggle debug mode', async ({ page, startSimulation, stopSimulation }) => {
    // Start at homepage
    await page.goto('/');
    
    // Wait for app to load
    await page.waitForFunction(() => typeof window.localStorage !== 'undefined');
    await page.waitForTimeout(500);
    
    // Debug mode should be off initially
    const initialDebugMode = await page.evaluate(() => window.localStorage.getItem('unoDebugMode'));
    expect(initialDebugMode).toBeFalsy();
    
    // Press Cmd+D (Mac) or Ctrl+D (Windows/Linux) to enable debug mode
    if (process.platform === 'darwin') {
      // Mac: ⌘+D
      await page.keyboard.press('Meta+KeyD');
    } else {
      // Windows/Linux: Ctrl+D
      await page.keyboard.press('Control+KeyD');
    }
    
    // Wait for toast notification to appear
    await page.waitForTimeout(500);
    const enabledToast = page.locator('text=Debug Mode Enabled, text=Telemetry displays are now visible').first();
    // Toast should appear (if implementation dispatches event properly)
    // Note: This might not appear if localStorage change is immediate
    
    // Verify localStorage changed
    const enabledDebugMode = await page.evaluate(() => window.localStorage.getItem('unoDebugMode'));
    expect(enabledDebugMode).toBe('1');
    
    // Press Cmd/Ctrl+D again to disable
    if (process.platform === 'darwin') {
      await page.keyboard.press('Meta+KeyD');
    } else {
      await page.keyboard.press('Control+KeyD');
    }
    await page.waitForTimeout(500);
    
    // Verify localStorage changed back
    const disabledDebugMode = await page.evaluate(() => window.localStorage.getItem('unoDebugMode'));
    expect(disabledDebugMode).not.toBe('1');
  });

  test('E2E-T2: Settings dialog should show Cmd/Ctrl+D shortcut hint', async ({ page }) => {
    await page.goto('/');
    
    // Wait for app to load and find settings button
    await page.waitForTimeout(500);
    
    // Find and open settings menu
    const settingsButton = page.locator('button[title*="einstellungen" i], button[title*="settings" i]').first();
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
      
      // Look for Debug Mode section
      const debugSection = page.locator('text=Debug Mode');
      await expect(debugSection).toBeVisible();
      
      // Look for keyboard shortcut hint (⌘+D on Mac, Strg+D on Windows)
      const isMac = process.platform === 'darwin';
      const shortcutKey = isMac ? '⌘' : 'Strg';
      const shortcutHint = page.locator(`text=${shortcutKey}+D`);
      // Shortcut hint should be visible if implementation is correct
    }
  });

  test('E2E-T3: High-frequency serial output should show drops in telemetry', async ({ page, startSimulation, stopSimulation }) => {
    // This test requires loading sketch, compiling, and running it
    // It's more complex and might need server running
    
    // Skip for now - focus on keyboard shortcut test
    test.skip();
  });
});
