import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("unoSelectedBoard", "nano");
    localStorage.setItem("unoSimulationEngine", "browser");
  });
  await page.goto("/");
  await expect(page.locator("#nano-artwork")).toBeVisible();
  await expect(page.locator("#pin-A7-click")).toBeAttached();
});

test("every Nano contact, LED and reset target follows the supplied artwork at different sizes", async ({ page }) => {
  for (const viewport of [{ width: 1600, height: 1000 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => page.evaluate(() => {
      const names = [...Array.from({ length: 14 }, (_, pin) => String(pin)), ...Array.from({ length: 8 }, (_, pin) => `A${pin}`)];
      const pairs = names.map(name => [`nano-pad-${name}`, `pin-${name}-state`]);
      pairs.push(["nano-reset-surface", "reset-click"]);
      for (const name of ["l", "on", "tx", "rx"]) pairs.push([`nano-led-${name}`, `led-${name}`]);
      return Math.max(...pairs.map(([baseId, overlayId]) => {
        const base = document.getElementById(baseId)!.getBoundingClientRect();
        const target = document.getElementById(overlayId)!.getBoundingClientRect();
        if (!base.width || !target.width) return Infinity;
        return Math.hypot(base.x + base.width / 2 - target.x - target.width / 2, base.y + base.height / 2 - target.y - target.height / 2);
      }));
    }), { message: "Every Nano target must align within 0.05 CSS pixels" }).toBeLessThan(0.05);
  }
});

test("the new Nano drawing controls D2, A6/A7, LEDs and the actual reset button", async ({ page }) => {
  await expect(page.locator("#led-on")).toHaveAttribute("fill-opacity", "0");
  await page.waitForFunction(() => Boolean((globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__));
  await page.evaluate(() => {
    const editor = (globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__ as { setValue: (code: string) => void };
    editor.setValue(`void setup() {
  Serial.begin(115200);
  pinMode(13, OUTPUT); digitalWrite(13, HIGH);
  pinMode(2, INPUT);
}
void loop() {
  if (Serial.available()) { Serial.read(); digitalWrite(13, LOW); }
  Serial.print("D2="); Serial.print(digitalRead(2));
  Serial.print(" A6="); Serial.print(analogRead(A6));
  Serial.print(" A7="); Serial.println(analogRead(A7));
  delay(100);
}`);
  });
  await page.getByRole("button", { name: /start simulation/i }).click();
  await expect(page.getByRole("button", { name: /stop simulation/i })).toBeVisible({ timeout: 60000 });
  const serial = page.getByTestId("serial-output");
  await expect(serial).toContainText("D2=0 A6=0 A7=0");
  await expect(page.locator("#led-on")).toHaveAttribute("fill-opacity", "1");
  await expect(page.locator("#led-l")).toHaveAttribute("fill-opacity", "1");
  await page.locator("#pin-2-click").click();
  await expect(serial).toContainText("D2=1 A6=0 A7=0");
  for (const [name, value] of [["A6", "600"], ["A7", "700"]]) {
    await page.locator(`#pin-${name}-click`).click();
    await page.locator('input[type="number"]').fill(value);
    await page.getByRole("button", { name: "Confirm" }).click();
  }
  await expect(serial).toContainText("D2=1 A6=600 A7=700");
  const input = page.getByPlaceholder("Send to Arduino...");
  await input.fill("x");
  await input.press("Enter");
  await expect(page.locator("#led-l")).toHaveAttribute("fill-opacity", "0");
  await page.locator("#reset-click").click();
  await expect(page.locator("#led-l")).toHaveAttribute("fill-opacity", "1");
  await page.getByRole("button", { name: /stop simulation/i }).click();
  await expect(page.locator("#led-on")).toHaveAttribute("fill-opacity", "0");
});
