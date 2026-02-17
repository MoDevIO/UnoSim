#!/usr/bin/env node
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:3000/?noautostart=1');
  await page.waitForTimeout(500);
  const vars = ['--background','--foreground','--card','--color-serial-monitor-bg','--color-ui-background','--color-ui-foreground'];
  const res = {};
  for (const v of vars) {
    res[v] = await page.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), v);
  }

  const headerStyles = await page.evaluate(() => {
    const h = document.querySelector('header.app-navbar');
    if (!h) return null;
    const cs = getComputedStyle(h);
    return {
      background: cs.backgroundColor,
      backgroundImage: cs.backgroundImage,
      boxShadow: cs.boxShadow,
      backdropFilter: cs.backdropFilter,
      color: cs.color,
      height: cs.height,
      padding: cs.padding,
    };
  });

  console.log('root variables:', res);
  console.log('\nheader computed styles:', headerStyles);
  await browser.close();
})();