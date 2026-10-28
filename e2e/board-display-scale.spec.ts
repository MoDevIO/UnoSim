import { expect, test, type Page } from "@playwright/test";

const BOARDS = [
  { id: "mega2560", label: /Arduino Mega 2560.*preview/, viewBox: "0 0 438.905 213.765" },
  { id: "uno", label: /Arduino UNO/, viewBox: "-4 -4 293.2 221" },
  { id: "nano", label: /Arduino Nano.*preview/, viewBox: "0 0 185 74" },
  { id: "attiny85", label: /ATtiny85.*preview/, viewBox: "0 0 168 112" },
] as const;

async function choose(page: Page, board: typeof BOARDS[number]) {
  await page.getByRole("menuitem", { name: "Tools" }).click();
  await page.getByTestId("menu-board").click();
  await page.getByRole("menuitemradio", { name: board.label }).click();
  await expect(page.locator(".arduino-overlay svg")).toHaveAttribute("viewBox", board.viewBox);
}

async function measure(page: Page) {
  return page.locator(".arduino-overlay").evaluate(overlay => {
    const drawing = overlay.parentElement!;
    const stage = drawing.parentElement!;
    const box = drawing.getBoundingClientRect();
    const panel = stage.getBoundingClientRect();
    return {
      width: box.width, height: box.height,
      centreX: box.x + box.width / 2, centreY: box.y + box.height / 2,
      panelX: panel.x, panelY: panel.y, panelWidth: panel.width, panelHeight: panel.height,
      scrollWidth: stage.scrollWidth, scrollHeight: stage.scrollHeight,
      clientWidth: stage.clientWidth, clientHeight: stage.clientHeight,
    };
  });
}

type Metrics = Awaited<ReturnType<typeof measure>>;

function fits(metrics: Metrics) {
  expect(metrics.width).toBeGreaterThan(0);
  expect(metrics.height).toBeGreaterThan(0);
  expect(metrics.width).toBeLessThanOrEqual(metrics.panelWidth + 0.1);
  expect(metrics.height).toBeLessThanOrEqual(metrics.panelHeight + 0.1);
  expect(metrics.centreX).toBeCloseTo(metrics.panelX + metrics.panelWidth / 2, 0);
  expect(metrics.centreY).toBeCloseTo(metrics.panelY + metrics.panelHeight / 2, 0);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("unoSimulationEngine", "browser");
    localStorage.setItem("unoSelectedBoard", "uno");
    localStorage.setItem("unoExperimentalWorkspaceLayout", "false");
  });
  await page.setViewportSize({ width: 1800, height: 1100 });
  await page.goto("/");
  await expect(page.locator(".arduino-overlay svg")).toBeVisible();
});

test("board switches preserve the selected widths, panel dimensions and centre", async ({ page }) => {
  const metrics: Record<string, Metrics> = {};
  for (const board of BOARDS) {
    await choose(page, board);
    await expect.poll(async () => {
      const current = await measure(page);
      return Math.abs(current.centreX - current.panelX - current.panelWidth / 2);
    }).toBeLessThan(0.5);
    metrics[board.id] = await measure(page);
    fits(metrics[board.id]);
  }
  const uno = metrics.uno;
  expect(uno.width).toBeGreaterThan(280);
  for (const current of Object.values(metrics)) {
    expect(current.panelWidth).toBeCloseTo(uno.panelWidth, 0);
    expect(current.panelHeight).toBeCloseTo(uno.panelHeight, 0);
    expect(current.centreX).toBeCloseTo(uno.centreX, 0);
    expect(current.centreY).toBeCloseTo(uno.centreY, 0);
  }
  expect(metrics.mega2560.width / uno.width).toBeCloseTo(1.25, 3);
  expect(metrics.nano.width / uno.width).toBeCloseTo(0.85, 3);
  expect(metrics.attiny85.width / uno.width).toBeCloseTo(0.65, 3);
});

test("narrow resized panels keep native proportions without scroll overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const handle = await page.getByTestId("horizontal-resizer").boundingBox();
  expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(1120, handle!.y + handle!.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await measure(page)).panelWidth).toBeLessThan(400);
  const widths: Record<string, number> = {};
  for (const board of BOARDS) {
    await choose(page, board);
    const current = await measure(page);
    fits(current);
    widths[board.id] = current.width;
  }
  expect(widths.mega2560).toBeGreaterThan(widths.uno);
  expect(widths.uno).toBeGreaterThan(widths.nano);
  expect(widths.nano).toBeGreaterThan(widths.attiny85);
  expect(widths.nano / widths.uno).toBeGreaterThan(0.85);
  expect(widths.attiny85 / widths.uno).toBeGreaterThan(0.65);
});
