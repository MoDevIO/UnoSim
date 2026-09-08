import { expect, test, type Page } from "@playwright/test";

const topLevelMenus = ["File", "Edit", "Sketch", "Tools", "Help"] as const;

function topLevelTrigger(page: Page, name: string) {
  return page.getByRole("menuitem", { name, exact: true });
}

async function expectOnlyMenuOpen(page: Page, name: string) {
  await expect(page.locator('[role="menu"][data-state="open"]')).toHaveCount(1);
  for (const menuName of topLevelMenus) {
    await expect(topLevelTrigger(page, menuName)).toHaveAttribute(
      "data-state",
      menuName === name ? "open" : "closed",
    );
  }
}

test.describe("desktop top-level menubar", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(topLevelTrigger(page, "File")).toBeVisible();
  });

  test("switches menus in both directions only after opening one", async ({ page }) => {
    await topLevelTrigger(page, "Edit").hover();
    await expect(page.locator('[role="menu"][data-state="open"]')).toHaveCount(0);

    await topLevelTrigger(page, "File").click();
    await expectOnlyMenuOpen(page, "File");

    for (const name of ["Edit", "Sketch", "Tools", "Help"] as const) {
      await topLevelTrigger(page, name).hover();
      await expectOnlyMenuOpen(page, name);
    }

    for (const name of ["Tools", "Sketch", "Edit", "File"] as const) {
      await topLevelTrigger(page, name).hover();
      await expectOnlyMenuOpen(page, name);
    }
  });

  test("closes the active menu on outside click and Escape", async ({ page }) => {
    await topLevelTrigger(page, "File").click();
    await expectOnlyMenuOpen(page, "File");

    await page.mouse.click(8, 220);
    await expect(page.locator('[role="menu"][data-state="open"]')).toHaveCount(0);
    for (const name of topLevelMenus) {
      await expect(topLevelTrigger(page, name)).toHaveAttribute("data-state", "closed");
    }
    await topLevelTrigger(page, "Help").click();
    await expectOnlyMenuOpen(page, "Help");
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="menu"][data-state="open"]')).toHaveCount(0);
    for (const name of topLevelMenus) {
      await expect(topLevelTrigger(page, name)).toHaveAttribute("data-state", "closed");
    }
  });
});
