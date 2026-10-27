import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("unoSelectedBoard", "mega2560");
    localStorage.setItem("unoSimulationEngine", "browser");
  });
  await page.goto("/");
  await expect(page.locator("#mega-artwork")).toBeVisible();
  await expect(page.locator("#pin-A15-click")).toBeAttached();
});

test("all Mega targets stay on the actual artwork while the board is resized", async ({ page }) => {
  for (const viewport of [{ width: 1600, height: 1000 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => page.evaluate(() => {
      const names = [...Array.from({ length: 54 }, (_, pin) => String(pin)), ...Array.from({ length: 16 }, (_, pin) => `A${pin}`), "20-sda", "21-scl"];
      const pairs = names.map(name => [`mega-pad-${name}`, `pin-${name}-state`]);
      pairs.push(["mega-source-button_off", "reset-click"]);
      for (const [name, source] of [["l", "led_l_off"], ["on", "led_l_off-2"], ["tx", "led_l_off-3"], ["rx", "led_l_off-4"]]) {
        pairs.push([`mega-source-${source}`, `led-${name}`]);
      }
      return Math.max(...pairs.map(([baseId, overlayId]) => {
        const base = document.getElementById(baseId)!.getBoundingClientRect();
        const target = document.getElementById(overlayId)!.getBoundingClientRect();
        if (!base.width || !target.width) return Infinity;
        return Math.hypot(base.x + base.width / 2 - target.x - target.width / 2, base.y + base.height / 2 - target.y - target.height / 2);
      }));
    }), { message: "Every pin, LED and reset target must follow the drawn part to within 0.05 CSS pixels" }).toBeLessThan(0.05);
  }
});

test("SDA/SCL duplicate sockets control D20/D21, LEDs follow the run and the drawn reset button resets it", async ({ page }) => {
  await expect(page.locator("#led-on")).toHaveAttribute("fill-opacity", "0");
  await page.waitForFunction(() => Boolean((globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__));
  await page.evaluate(() => {
    const editor = (globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__ as { setValue: (code: string) => void };
    editor.setValue(`void setup() {
  Serial.begin(9600);
  pinMode(13, OUTPUT);
  digitalWrite(13, HIGH);
  pinMode(20, INPUT);
  pinMode(21, INPUT);
}
void loop() {
  if (Serial.available()) { Serial.read(); digitalWrite(13, LOW); }
  Serial.print("SDA="); Serial.print(digitalRead(20));
  Serial.print(" SCL="); Serial.println(digitalRead(21));
  delay(100);
}`);
  });
  await page.getByRole("button", { name: /start simulation/i }).click();
  await expect(page.getByRole("button", { name: /stop simulation/i })).toBeVisible({ timeout: 60000 });
  const serial = page.getByTestId("serial-output");
  await expect(serial).toContainText("SDA=0 SCL=0");
  await expect(page.locator("#led-on")).toHaveAttribute("fill-opacity", "1");
  await expect(page.locator("#led-l")).toHaveAttribute("fill-opacity", "1");

  await page.locator("#pin-21-scl-click").click();
  await expect(serial).toContainText("SDA=0 SCL=1");
  await page.locator("#pin-20-sda-click").click();
  await expect(serial).toContainText("SDA=1 SCL=1");
  await page.locator("#pin-21-click").click();
  await expect(serial).toContainText("SDA=1 SCL=0");

  const input = page.getByPlaceholder("Send to Arduino...");
  await input.fill("x");
  await input.press("Enter");
  await expect(page.locator("#led-l")).toHaveAttribute("fill-opacity", "0");
  await page.locator("#reset-click").click();
  await expect(page.locator("#led-l")).toHaveAttribute("fill-opacity", "1");
  await page.getByRole("button", { name: /stop simulation/i }).click();
  await expect(page.locator("#led-on")).toHaveAttribute("fill-opacity", "0");
});
