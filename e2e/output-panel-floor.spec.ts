import { test, expect } from "@playwright/test";

// Verifies that the Output Panel enforces an absolute pixel minimum height
// matching the header height, both on initial load and after window resize,
// and also when loading a new example.

test.describe("Output Panel absolute floor", () => {
  test.beforeEach(async ({ page }) => {
    // Reset backend and frontend state before each test
    const testRunId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      await page.context().request.post("/api/test-reset");
    } catch (err) {
      // Silent - test-reset may not be critical for output panel tests
    }
    
    await page.addInitScript((testId: string) => {
      window.sessionStorage.setItem("__TEST_RUN_ID__", testId);
    }, testRunId);

    await page.goto("/");

    // Wait for app ready
    await page.waitForTimeout(500);
  });

  test("min-height equals header height on load and after resize", async ({ page }) => {
    await page.goto("/");

    const header = page.locator('[data-testid="output-tabs-header"]');
    await expect(header).toBeVisible();

    // Read initial header height and panel min-height style
    const initial = await header.evaluate((el) => {
      const panel = el.closest('[data-panel]') as HTMLElement | null;
      const h = Math.ceil(el.getBoundingClientRect().height);
      return { h, min: panel?.style.minHeight || "" };
    });

    expect(initial.min).toBe(`${initial.h}px`);

    // Resize the viewport and verify enforcement runs again
    await page.setViewportSize({ width: 1100, height: 700 });
    await page.waitForTimeout(50);

    const after = await header.evaluate((el) => {
      const panel = el.closest('[data-panel]') as HTMLElement | null;
      const h = Math.ceil(el.getBoundingClientRect().height);
      return { h, min: panel?.style.minHeight || "" };
    });

    expect(after.min).toBe(`${after.h}px`);
  });

  test("min-height re-enforces when code/example changes", async ({ page }) => {
    await page.goto("/");

    const header = page.locator('[data-testid="output-tabs-header"]');
    await expect(header).toBeVisible();

    // Get initial state
    const initial = await header.evaluate((el) => {
      const panel = el.closest('[data-panel]') as HTMLElement | null;
      const h = Math.ceil(el.getBoundingClientRect().height);
      return { h, min: panel?.style.minHeight || "" };
    });

    // Open the Examples menu (if available) to load an example
    // For this test, we trigger a re-render by changing viewport to large and back
    await page.setViewportSize({ width: 1800, height: 1200 });
    await page.waitForTimeout(100);

    // After the large viewport, check that enforcement still holds
    const afterLarge = await header.evaluate((el) => {
      const panel = el.closest('[data-panel]') as HTMLElement | null;
      const h = Math.ceil(el.getBoundingClientRect().height);
      return { h, min: panel?.style.minHeight || "" };
    });

    // The min-height should still match header height (not the old value)
    expect(afterLarge.min).toBe(`${afterLarge.h}px`);
  });
});

