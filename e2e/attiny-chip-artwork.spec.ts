import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("unoSelectedBoard", "attiny85");
    localStorage.setItem("unoSimulationEngine", "browser");
  });
  await page.goto("/");
  await expect(page.locator("#attiny-package")).toBeVisible();
});

test("shows only the eight-lead chip and keeps pin targets on metal while resizing", async ({ page }) => {
  await expect(page.locator('path[id^="attiny-lead-"]')).toHaveCount(8);
  await expect(page.locator('#led-on, #led-l, #led-tx, #led-rx, #reset-click, #reset-button')).toHaveCount(0);
  await expect(page.locator('img[src="/TH_Koeln_Logo.svg"]')).toHaveCount(0);
  await expect(page.locator("#pin-5-click")).toHaveCount(0);
  for (const viewport of [{ width: 1600, height: 1000 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => page.evaluate(() => Math.max(...[[0, 5], [1, 6], [2, 7], [3, 2], [4, 3]].map(([pin, dip]) => {
      const base = document.getElementById(`attiny-contact-${dip}`)!.getBoundingClientRect();
      const target = document.getElementById(`pin-${pin}-state`)!.getBoundingClientRect();
      if (!base.width || !target.width) return Infinity;
      return Math.hypot(base.x + base.width / 2 - target.x - target.width / 2, base.y + base.height / 2 - target.y - target.height / 2);
    }))), { message: "Pin overlays must stay centred on the drawn metal contacts" }).toBeLessThan(0.05);
  }
  for (const pin of [0, 1, 2, 3, 4]) {
    await expect(page.locator(`#pin-${pin}-state`)).toHaveCSS("fill-opacity", "0");
  }
});

test("operates digital PB3 and analog PB4 directly on the chip without LED or reset elements", async ({ page }) => {
  await page.waitForFunction(() => Boolean((globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__));
  await page.evaluate(() => {
    const editor = (globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__ as { setValue: (code: string) => void };
    editor.setValue(`void setup() {
  Serial.begin(9600);
  pinMode(3, INPUT);
}
void loop() {
  Serial.print("PB3="); Serial.print(digitalRead(3));
  Serial.print(" A2="); Serial.println(analogRead(A2));
  delay(150);
}`);
  });
  await page.getByRole("button", { name: /start simulation/i }).click();
  await expect(page.getByRole("button", { name: /stop simulation/i })).toBeVisible({ timeout: 60000 });
  const serial = page.getByTestId("serial-output");
  await expect(serial).toContainText("PB3=0 A2=0");
  await page.locator("#pin-3-click").click();
  await expect(serial).toContainText("PB3=1 A2=0");
  await page.locator("#pin-4-click").click();
  await page.locator('input[type="number"]').fill("600");
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(serial).toContainText("PB3=1 A2=600");
  await expect(page.locator('#led-on, #led-l, #reset-click')).toHaveCount(0);
  await page.getByRole("button", { name: /stop simulation/i }).click();
  await expect(page.locator("#attiny-package")).toBeVisible();
});
