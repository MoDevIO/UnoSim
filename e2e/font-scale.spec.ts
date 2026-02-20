import { test, expect } from "./fixtures/test-base";

// Verifies that changing --ui-font-scale updates UI elements that rely on
// the `text-ui-*` tokens (SerialMonitor + Sidebar/PinMonitor).
// This is a regression test for the Beamer / font-scale behaviour.

test.describe("UI font-scale responsiveness", () => {
  test("serial monitor and sidebar scale together when fontScale changes", async ({ page, monacoEditor }) => {
    await page.goto("/");
    await page.waitForSelector(".monaco-editor", { timeout: 15000 });

    const serialOutput = page.locator('[data-testid="serial-output"]');
    const pinMonitor = page.locator('[data-testid="pin-monitor"]');

    // Ensure Pin Monitor is visible for this test (don't rely on default)
    await page.evaluate(() => {
      try {
        // Inform any listeners that the Pin Monitor should be shown
        const ev = new CustomEvent("pinMonitorVisibleChange", { detail: { value: true } });
        document.dispatchEvent(ev);
      } catch {}
    });

    await expect(serialOutput).toBeVisible();
    await expect(pinMonitor).toBeVisible();

    const before = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="serial-output"]') as HTMLElement | null;
      const p = document.querySelector('[data-testid="pin-monitor"]') as HTMLElement | null;
      return {
        serial: s ? window.getComputedStyle(s).fontSize : null,
        pin: p ? window.getComputedStyle(p).fontSize : null,
      };
    });

    // Bump UI font scale (dispatch event so listeners can react)
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--ui-font-scale", "1.25");
      window.dispatchEvent(new Event("uiFontScaleChange"));
      document.dispatchEvent(new Event("uiFontScaleChange"));
    });

    await page.waitForTimeout(200);

    const after = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="serial-output"]') as HTMLElement | null;
      const p = document.querySelector('[data-testid="pin-monitor"]') as HTMLElement | null;
      return {
        serial: s ? window.getComputedStyle(s).fontSize : null,
        pin: p ? window.getComputedStyle(p).fontSize : null,
      };
    });

    expect(before.serial).not.toBeNull();
    expect(before.pin).not.toBeNull();
    expect(after.serial).not.toBeNull();
    expect(after.pin).not.toBeNull();

    const bSerial = parseFloat((before.serial as string).replace("px", ""));
    const aSerial = parseFloat((after.serial as string).replace("px", ""));
    const bPin = parseFloat((before.pin as string).replace("px", ""));
    const aPin = parseFloat((after.pin as string).replace("px", ""));

    expect(aSerial).toBeGreaterThan(bSerial);
    expect(aPin).toBeGreaterThan(bPin);

    // Ensure both changed by approximately the same factor (within 12%)
    const sFactor = aSerial / bSerial;
    const pFactor = aPin / bPin;
    expect(Math.abs(sFactor - pFactor)).toBeLessThan(0.12);
  });
});
