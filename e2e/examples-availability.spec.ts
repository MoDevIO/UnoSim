import { expect, test, type Page, type Route } from "@playwright/test";

const catalogPath = /\/api\/examples(?:\?.*)?$/;
const externalCatalog = {
  schemaVersion: 1,
  source: { selection: "default", mode: "repository-ref", repository: "owner/repo", ref: "main", revision: "a".repeat(40), status: "remote", stale: false },
  examples: [{ id: "remote-test", title: "Remote example", category: "Basics", main: "remote.ino", source: "external", files: [{ name: "remote.ino", path: "remote.ino" }] }],
};

async function openExamples(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__));
  await expect(page.getByRole("button", { name: "Examples", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Examples", exact: true }).click();
}

const editorValue = (page: Page) => page.evaluate(() => (
  (globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__ as { getValue(): string }
).getValue());

test.describe("independent built-in examples", () => {
  test("loads real Blink files while the external catalog never completes", async ({ page }) => {
    let held: Route | undefined;
    await page.route(catalogPath, route => { held = route; });
    await openExamples(page);
    await expect(page.getByText("Loading external examples...")).toBeVisible();
    await page.getByRole("button", { name: "Built-in", exact: true }).click();
    const detail = page.waitForResponse(response => response.url().endsWith("/api/examples/builtin-01-blink-ino"));
    await page.getByRole("button", { name: /01-blink\.ino/ }).click();
    expect((await detail).status()).toBe(200);
    await expect.poll(() => editorValue(page)).toContain("const int ledPin = LED_BUILTIN");
    await held?.abort();
  });

  test("keeps local examples through an external failure and restores only the external group on Retry", async ({ page }) => {
    let attempts = 0;
    let localCatalogRequests = 0;
    page.on("request", request => { if (request.url().endsWith("/api/examples/builtin/catalog")) localCatalogRequests++; });
    await page.route(catalogPath, async route => {
      attempts++;
      await route.fulfill({ status: attempts === 1 ? 503 : 200, json: attempts === 1 ? { schemaVersion: 1, error: { code: "SOURCE_UNAVAILABLE" } } : externalCatalog });
    });
    await page.route(/\/api\/examples\/remote-test(?:\?.*)?$/, route => route.fulfill({ json: { files: [{ name: "remote.ino", content: "// Remote recovery\nvoid setup(){}\nvoid loop(){}" }] } }));
    await openExamples(page);
    await expect(page.getByText(/External examples are currently unavailable/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Built-in", exact: true })).toBeEnabled();
    const before = await editorValue(page);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("button", { name: "External", exact: true })).toBeVisible();
    expect(localCatalogRequests).toBe(1);
    expect(await editorValue(page)).toBe(before);
    await expect(page.getByRole("button", { name: "Built-in", exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "External", exact: true }).click();
    await page.getByRole("button", { name: "Basics", exact: true }).click();
    await page.getByRole("button", { name: /Remote example/ }).click();
    await expect.poll(() => editorValue(page)).toContain("// Remote recovery");
  });
});
