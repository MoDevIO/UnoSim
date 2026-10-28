import { expect, test, type Page } from "@playwright/test";

async function openRegistry(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("unoSimulationEngine", "browser");
    localStorage.setItem("unoSelectedBoard", "uno");
    localStorage.setItem("unoExperimentalWorkspaceLayout", "false");
  });
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto("/");
  await page.waitForFunction(() =>
    Boolean(
      (globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__,
    ),
  );
  await page.evaluate(() => {
    document.dispatchEvent(
      new CustomEvent("showCompileOutputChange", { detail: { value: true } }),
    );
    document.dispatchEvent(
      new CustomEvent("setOutputTab", { detail: { tab: "registry" } }),
    );
  });
  const registryTab = page.getByRole("tab", {
    name: "I/O Registry",
    exact: true,
  });
  await expect(registryTab).toHaveAttribute("data-state", "active");
  await registryTab.dblclick();
}

async function chooseBoard(page: Page, name: RegExp) {
  await page.getByRole("menuitem", { name: "Tools", exact: true }).click();
  await page.getByTestId("menu-board").click();
  await page.getByRole("menuitemradio", { name }).click();
}

test("Pin Infos follows board changes and keeps usage source details", async ({
  page,
}) => {
  await openRegistry(page);
  await page.evaluate(() => {
    const editor = (
      globalThis as unknown as {
        __MONACO_EDITOR__: { setValue: (value: string) => void };
      }
    ).__MONACO_EDITOR__;
    editor.setValue(
      "void setup() { pinMode(3, OUTPUT); }\nvoid loop() { digitalWrite(3, HIGH); }",
    );
  });
  await expect(
    page.getByRole("tab", { name: "Programmed Pins (1)" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show source locations" }).click();
  await expect(
    page.getByRole("button", { name: /Go to .*:1/ }).first(),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Pin Infos", exact: true }).click();
  const table = page.getByRole("table", { name: "Pin capabilities" });
  await expect(table.locator("thead tr")).toHaveCount(1);
  await expect(table.getByRole("columnheader")).toHaveCount(9);
  await expect(
    page.getByRole("button", { name: "Hide source locations" }),
  ).toHaveCount(0);
  for (const [board, pin] of [
    [/Arduino Mega 2560.*preview/, "A15"],
    [/Arduino Nano.*preview/, "A7"],
    [/ATtiny85.*preview/, "PB4"],
  ] as const) {
    await chooseBoard(page, board);
    await expect(
      table.getByRole("cell", { name: new RegExp(`^${pin}(?: |$)`) }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Pin Infos", exact: true }),
    ).toHaveAttribute("data-state", "active");
  }
  await page
    .getByRole("searchbox", { name: "Search pins or functions" })
    .fill("MISO");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.locator("tbody tr")).toContainText("PB0");
  await page.getByRole("tab", { name: "All Pins", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Hide source locations" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Go to .*:1/ }).first(),
  ).toBeVisible();
});

test("Pin Infos keeps a single sticky header and Pin column in a narrow, scaled panel", async ({
  page,
}, testInfo) => {
  await openRegistry(page);
  await chooseBoard(page, /Arduino Mega 2560.*preview/);
  await page.getByRole("tab", { name: "Pin Infos", exact: true }).click();
  const viewport = page.getByTestId("pin-infos-viewport");
  const header = page.getByRole("columnheader", { name: "Pin", exact: true });
  const firstPin = viewport.locator('tr[data-pin="0"] td').first();
  for (const scale of [1, 1.5]) {
    await page.evaluate(
      (value) =>
        document.documentElement.style.setProperty(
          "--ui-font-scale",
          String(value),
        ),
      scale,
    );
    await page.setViewportSize({ width: 1100, height: 1000 });
    await expect(viewport).toBeVisible();
    await viewport.evaluate((node) => {
      node.scrollTop = 0;
      node.scrollLeft = 0;
    });
    const pinX = (await firstPin.boundingBox())!.x;
    const headerY = (await header.boundingBox())!.y;
    await viewport.evaluate((node) => {
      node.scrollLeft = 400;
      node.scrollTop = 300;
    });
    await expect
      .poll(async () => Math.abs((await header.boundingBox())!.y - headerY))
      .toBeLessThan(1);
    // Compare the horizontally sticky cell after restoring only the vertical position.
    await viewport.evaluate((node) => {
      node.scrollTop = 0;
    });
    await expect
      .poll(async () => Math.abs((await firstPin.boundingBox())!.x - pinX))
      .toBeLessThan(1);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    const tab = page.getByRole("tab", { name: "Pin Infos", exact: true });
    expect(
      await tab.evaluate((node) => node.classList.contains("app-tab")),
    ).toBe(true);
    const heights = await tab.evaluate((node) => ({
      tab: node.getBoundingClientRect().height,
      header: node.closest(".panel-content-header")!.getBoundingClientRect()
        .height,
    }));
    expect(heights.tab).toBeCloseTo(heights.header, 0);
  }
  await page.screenshot({
    path: testInfo.outputPath("pin-infos-scaled.png"),
    fullPage: true,
  });
});
