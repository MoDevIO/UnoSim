import { test, expect, type Page } from '@playwright/test';

// The postMessage API must work from a cross-origin parent in every browser.
// CI runs Chromium (location.ancestorOrigins). Firefox has no ancestorOrigins and
// takes the referrer fallback; run this spec with --browser=firefox to check it.

// The parent page is served by page.route and therefore has no network address
// space; Chromium's local network access check would block the loopback iframe.
test.use({
  launchOptions: async ({ browserName }, use) => {
    await use(browserName === 'chromium' ? { args: ['--disable-features=LocalNetworkAccessChecks'] } : {});
  },
});

// Both origins sit on the configured test port: the parent on localhost, the simulator on 127.0.0.1, so they
// stay cross-origin, and the server's allowlist for that port applies (playwright.config.ts, E2E_PORT).
function origins(baseURL: string | undefined): { readonly parentOrigin: string; readonly simulatorOrigin: string } {
  const { port, protocol } = new URL(baseURL ?? 'http://localhost:3000');
  return { parentOrigin: `${protocol}//localhost:${port}`, simulatorOrigin: `${protocol}//127.0.0.1:${port}` };
}

async function openEmbeddingPage(page: Page, { parentOrigin, simulatorOrigin }: ReturnType<typeof origins>): Promise<void> {
  await page.route(`${parentOrigin}/__embed-host`, (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><body>
      <iframe id="sim" src="${simulatorOrigin}/" style="width:1200px;height:800px"></iframe>
      <script>
        window.__responses = [];
        window.addEventListener('message', (event) => {
          if (event.origin === '${simulatorOrigin}') window.__responses.push(event.data);
        });
      </script>
    </body></html>`,
  }));
  await page.goto(`${parentOrigin}/__embed-host`);
}

async function expectStateResponse(page: Page, simulatorOrigin: string): Promise<void> {
  await expect.poll(async () => page.evaluate((target) => {
    const frame = (document.getElementById('sim') as HTMLIFrameElement).contentWindow;
    frame?.postMessage({ type: 'GET_SIMULATION_STATE' }, target);
    return (window as unknown as { __responses: Array<{ type?: string; success?: boolean }> }).__responses
      .some((message) => message.type === 'GET_SIMULATION_STATE' && message.success === true);
  }, simulatorOrigin), { timeout: 30000, intervals: [500] }).toBe(true);
}

test('external API answers a cross-origin parent', async ({ page, baseURL }) => {
  const embedding = origins(baseURL);
  expect(embedding.parentOrigin).not.toBe(embedding.simulatorOrigin);
  await openEmbeddingPage(page, embedding);
  await expectStateResponse(page, embedding.simulatorOrigin);
});
