#!/usr/bin/env node
import { chromium } from "playwright";

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;

async function verifyTabAlignment() {
  console.log(`Verifying tab alignment at ${BASE_URL}...`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  const scales = [1.5, 1.25, 1.0, 0.875, 1.0, 1.25];
  const results = [];

  for (const scale of scales) {
    // Set scale and trigger enforceOutputPanelFloor
    await page.evaluate((s) => {
      document.documentElement.style.setProperty("--ui-font-scale", String(s));
      window.dispatchEvent(
        new CustomEvent("uiFontScaleChange", { detail: { value: s } }),
      );
      document.dispatchEvent(
        new CustomEvent("uiFontScaleChange", { detail: { value: s } }),
      );
    }, scale);

    // Wait for React state + rAF + layout + delayed retry
    await page.waitForTimeout(150);

    // Trigger window resize to force enforceOutputPanelFloor
    await page.evaluate(() => {
      window.dispatchEvent(new Event("resize"));
    });

    await page.waitForTimeout(100);

    // Measure tab header and viewport
    const measurement = await page.evaluate(() => {
      const tabHeader =
        document.querySelector('[data-testid="output-tabs-header"]') ||
        document.querySelector(
          ".flex.items-center.justify-between.px-2.h-\\[var\\(--ui-button-height\\)\\].bg-muted.border-b",
        );

      if (!tabHeader) return { error: "Tab header not found" };

      const headerRect = tabHeader.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const gap = viewportHeight - headerRect.bottom;

      return {
        scale: getComputedStyle(document.documentElement).getPropertyValue(
          "--ui-font-scale",
        ),
        headerBottom: Math.round(headerRect.bottom * 100) / 100,
        viewportHeight,
        gap: Math.round(gap * 100) / 100,
        headerHeight: Math.round(headerRect.height * 100) / 100,
      };
    });

    results.push({ scale, ...measurement });

    const status =
      measurement.gap !== undefined && Math.abs(measurement.gap) <= 1
        ? "✓"
        : "✗";
    console.log(`Scale ${scale}: gap=${measurement.gap}px ${status}`);
  }

  await browser.close();

  // Check all gaps are within tolerance
  const allPassed = results.every(
    (r) => r.gap !== undefined && Math.abs(r.gap) <= 1,
  );

  console.log("\n=== VERIFICATION RESULTS ===");
  console.table(results);
  console.log(
    `\nStatus: ${allPassed ? "✓ PASSED" : "✗ FAILED"} (tolerance: ±1px)`,
  );

  process.exit(allPassed ? 0 : 1);
}

verifyTabAlignment().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
