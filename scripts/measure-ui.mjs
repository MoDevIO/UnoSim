#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const ports = [3001, 3000, 3002];
const outDir = path.resolve(process.cwd(), 'temp', 'typography-screenshots');
const outJson = path.resolve(process.cwd(), 'typography-headless-evidence.json');
fs.mkdirSync(outDir, { recursive: true });

async function measure(url, scale) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  // ensure persisted scale is set before first render by writing localStorage then reloading
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch (e) {
    await browser.close();
    throw e;
  }

  try {
    await page.evaluate((s) => { window.localStorage.setItem('unoFontScale', String(s)); }, scale);
    await page.reload({ waitUntil: 'networkidle' });
  } catch (e) {}

  // give page a moment to apply CSS vars and for Monaco to update
  await page.waitForTimeout(1200);

  // Capture expected base values (computed from CSS vars) so assertions can be performed
  const expected = await page.evaluate(() => {
    try {
      const cs = getComputedStyle(document.documentElement);
      const lineBase = parseFloat(cs.getPropertyValue('--ui-line-base')) || 20;
      const buttonBase = parseFloat(cs.getPropertyValue('--ui-button-base-height')) || 32;
      const fontBase = parseFloat(cs.getPropertyValue('--ui-font-base-size')) || 16;
      const scale = parseFloat(cs.getPropertyValue('--ui-font-scale')) || 1;
      return { lineBase, buttonBase, fontBase, scale };
    } catch (e) { return { lineBase: 20, buttonBase: 32, fontBase: 16, scale: 1 }; }
  });

  const results = await page.evaluate(() => {
    function elInfo(el) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        classes: el.className || null,
        text: (el.textContent || '').trim().slice(0, 80),
        rect: { height: Math.round(r.height * 100) / 100, width: Math.round(r.width * 100) / 100 },
        offsetHeight: el.offsetHeight,
        computedHeight: cs.height,
        lineHeight: cs.lineHeight,
        fontWeight: cs.fontWeight,
        fontFamily: cs.fontFamily,
        paddingTop: cs.paddingTop,
        paddingBottom: cs.paddingBottom,
        fontSize: cs.fontSize,
      };
    }

    // Category selectors for evidence-driven measurement
    const selectors = {
      editorLine: ['.monaco-editor .view-lines .view-line'],
      consoleOutput: ['.console-output', '[data-testid="compilation-text"]', '[data-testid="serial-output"]'],
      tabs: ['[role="tab"]', '.TabsTrigger', '.tabs-trigger'],
      buttons: ['button', '[role="button"]', '.menu-item'],
      menus: ['.app-menu', '[role="menubar"]', '[role="menu"]', '.dropdown-menu'],
      labels: ['.text-caption', '.text-small', '.text-ui-xs', '.text-ui-sm', '.text-muted-foreground']
    };

    const measureCategory = (arr) => {
      const nodes = arr.flatMap(s => Array.from(document.querySelectorAll(s))).filter((e, i, a) => a.indexOf(e) === i);
      return nodes.filter(e => e.offsetHeight > 0 && e.offsetWidth > 0).slice(0, 200).map(elInfo);
    };

    return {
      editorLine: measureCategory(selectors.editorLine),
      consoleOutput: measureCategory(selectors.consoleOutput),
      tabs: measureCategory(selectors.tabs),
      buttons: measureCategory(selectors.buttons),
      menus: measureCategory(selectors.menus),
      labels: measureCategory(selectors.labels),
      timestamp: Date.now(),
      url: location.href,
    };
  });

  const fullScreenshot = path.join(outDir, `full-page-${scale}.png`);
  await page.screenshot({ path: fullScreenshot, fullPage: true });

  // take element screenshots for first N buttons and tabs
  const elementShots = [];
  const maxShots = 8;
  const buttonHandles = await page.$$('button, [role="button"]');
  for (let i = 0; i < Math.min(buttonHandles.length, maxShots); i++) {
    try {
      const el = buttonHandles[i];
      const handle = await el.boundingBox();
      if (handle) {
        const shotPath = path.join(outDir, `button-${i + 1}.png`);
        await el.screenshot({ path: shotPath });
        elementShots.push(shotPath);
      }
    } catch (e) {
      // ignore per-element errors
    }
  }

  const tabHandles = await page.$$('[role="tab"]');
  for (let i = 0; i < Math.min(tabHandles.length, maxShots); i++) {
    try {
      const el = tabHandles[i];
      const shotPath = path.join(outDir, `tab-${i + 1}.png`);
      await el.screenshot({ path: shotPath });
      elementShots.push(shotPath);
    } catch (e) {
      // ignore
    }
  }

  await browser.close();

  const payload = { measuredAt: new Date().toISOString(), url, scale, expected, results, fullScreenshot: fullScreenshot, elementScreenshots: elementShots };
  return payload;
}

(async () => {
  const scales = [1.0, 1.25];
  const args = process.argv.slice(2);
  const assertMode = args.includes('--assert') || process.env.FAIL_ON_DEVIATION === '1';
  const runs = [];
  for (const p of ports) {
    const url = `http://localhost:${p}`;
    try {
      console.log('Trying', url);
      for (const s of scales) {
        console.log(' Measuring scale', s);
        const res = await measure(url, s);
        runs.push(res);
        // save after each run
        fs.writeFileSync(outJson, JSON.stringify({ measuredAt: new Date().toISOString(), url, runs }, null, 2));
        console.log(' Wrote evidence for scale', s, '->', outJson);

        // If assertion mode is enabled, validate measured values against expected
        if (assertMode) {
          try {
            const last = res;
            const expectedLine = (last.expected.lineBase || 20) * (last.expected.scale || 1);
            const expectedButton = (last.expected.buttonBase || 32) * (last.expected.scale || 1);

            const measuredEditor = last.results.editorLine && last.results.editorLine[0] ? (last.results.editorLine[0].rect.height || last.results.editorLine[0].offsetHeight) : null;
            const measuredTab = last.results.tabs && last.results.tabs[0] ? (last.results.tabs[0].rect.height || last.results.tabs[0].offsetHeight) : null;
            const measuredButton = last.results.buttons && last.results.buttons[0] ? (last.results.buttons[0].rect.height || last.results.buttons[0].offsetHeight) : null;

            const errors = [];
            if (measuredEditor !== null) {
              const d = Math.abs(measuredEditor - expectedLine);
              if (d > 1) errors.push(`editorLine: expected ${expectedLine}px got ${measuredEditor}px (Δ ${d}px)`);
            }
            if (measuredTab !== null) {
              const d = Math.abs(measuredTab - expectedButton);
              if (d > 1) errors.push(`tab: expected ${expectedButton}px got ${measuredTab}px (Δ ${d}px)`);
            }
            if (measuredButton !== null) {
              const d = Math.abs(measuredButton - expectedButton);
              if (d > 1) errors.push(`button: expected ${expectedButton}px got ${measuredButton}px (Δ ${d}px)`);
            }

            if (errors.length) {
              console.error('ASSERTION ERRORS:', errors.join('; '));
              // Keep writing evidence, but exit with non-zero to indicate hard failure
              fs.writeFileSync(outJson, JSON.stringify({ measuredAt: new Date().toISOString(), url, runs, assertionErrors: errors }, null, 2));
              process.exit(3);
            } else {
              console.log('Assertions passed for scale', s);
            }
          } catch (ae) {
            console.error('Assertion logic failed', ae);
          }
        }
      }
      console.log('ALL RUNS COMPLETE');
      process.exit(0);
    } catch (err) {
      console.error('Failed to measure at', url, err && err.message ? err.message : err);
    }
  }
  console.error('All ports failed.');
  process.exit(2);
})();
