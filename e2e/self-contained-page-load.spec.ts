import { test, expect } from '@playwright/test';

// The page must load from the UnoSim origin alone. A blocking third-party
// stylesheet or script (formerly Google Fonts and a Replit banner) left the page
// blank until its host answered, which made E2E runs flaky and breaks filtered
// school networks.

test('the start page loads without any third-party request', async ({ page, baseURL }) => {
  const ownHost = new URL(baseURL ?? 'http://localhost:3000').host;
  const thirdParty: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    // HTTP and WebSocket requests to the UnoSim host are first-party; blob:/data: never leave the page.
    if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && url.host !== ownHost) {
      thirdParty.push(request.url());
    }
  });

  await page.goto('/');
  await expect(page.getByRole('button', { name: /start simulation/i })).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);

  expect(thirdParty).toEqual([]);
});
