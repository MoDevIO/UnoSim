import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// End-to-end check of the browser emulation (plan P3.10, milestone M1): a real
// compile, the artifact delivered to the page, the Uno emulated in a Web Worker.
// The runtime is chosen by the same localStorage key as File → Settings →
// "Simulation engine".

const ENGINE_KEY = "unoSimulationEngine";
const COMPILE_TIMEOUT = process.env.CI ? 120_000 : 60_000;

const COUNTER = `int n = 0;
void setup() {
  Serial.begin(115200);
}
void loop() {
  Serial.print("count ");
  Serial.println(n++);
  delay(100);
}`;

const ECHO = String.raw`void setup() {
  Serial.begin(115200);
  Serial.println("ready");
}
void loop() {
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    Serial.print("got:");
    Serial.println(line);
  }
}`;

const LATE_BEGIN = `void setup() {
  delay(2500);
  Serial.begin(115200);
  Serial.println("begun");
  while (Serial.available()) Serial.read();
}
void loop() {}`;

interface Traffic {
  readonly sentTypes: string[];
  compileRequests: number;
}

async function openWithEngine(page: Page, engine: "browser" | "host-mock"): Promise<Traffic> {
  const traffic: Traffic = { sentTypes: [], compileRequests: 0 };
  await page.addInitScript(([key, value]) => globalThis.localStorage.setItem(key, value), [ENGINE_KEY, engine]);
  page.on("websocket", (socket) => {
    socket.on("framesent", (frame) => {
      try {
        traffic.sentTypes.push(String((JSON.parse(String(frame.payload)) as { type?: unknown }).type));
      } catch {
        // not a JSON message
      }
    });
  });
  page.on("request", (request) => {
    if (request.url().endsWith("/api/compile")) traffic.compileRequests++;
  });
  await page.goto("/");
  await page.waitForFunction(() => Boolean((globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__), undefined, { timeout: 15_000 });
  return traffic;
}

async function setSketch(page: Page, code: string): Promise<void> {
  await page.evaluate((sketch) => {
    const editor = (globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__ as { setValue: (value: string) => void };
    editor.setValue(sketch);
  }, code);
}

/** The real path of a user: the sketch in the editor, Start Simulation compiles and runs. */
async function startFromEditor(page: Page, code: string): Promise<void> {
  await setSketch(page, code);
  await page.getByRole("button", { name: /start simulation/i }).click();
  await expect(page.getByRole("button", { name: /stop simulation/i })).toBeVisible({ timeout: COMPILE_TIMEOUT });
}

const serial = (page: Page) => page.locator('[data-testid="serial-output"]');

async function lastCount(page: Page): Promise<number> {
  const text = (await serial(page).innerText()) ?? "";
  const counts = [...text.matchAll(/count (\d+)/g)].map((match) => Number(match[1]));
  return counts.at(-1) ?? -1;
}

async function sendSerial(page: Page, text: string): Promise<void> {
  const input = page.getByPlaceholder("Send to Arduino...");
  await input.fill(text);
  await input.press("Enter");
}

test.describe("browser emulation (M1)", () => {
  test("compiles, runs the Uno in the browser and shows its serial output, without a server-side simulation", async ({ page }) => {
    const traffic = await openWithEngine(page, "browser");

    await startFromEditor(page, COUNTER);

    await expect(serial(page)).toContainText("count 3", { timeout: 15_000 });
    expect(traffic.sentTypes).not.toContain("start_simulation");
    expect(traffic.compileRequests).toBeGreaterThan(0);
  });

  test("serial input reaches the sketch and its answer comes back", async ({ page }) => {
    await openWithEngine(page, "browser");
    await startFromEditor(page, ECHO);
    await expect(serial(page)).toContainText("ready", { timeout: 15_000 });

    await sendSerial(page, "hello");

    await expect(serial(page)).toContainText("got:hello", { timeout: 10_000 });
  });

  test("lifecycle: pause holds simulated time, resume continues, stop ends the run, each with its system line", async ({ page }) => {
    await openWithEngine(page, "browser");
    await startFromEditor(page, COUNTER);
    await expect(serial(page)).toContainText("count 2", { timeout: 15_000 });

    await page.getByRole("button", { name: /pause simulation/i }).click();
    await expect(serial(page)).toContainText("--- Simulation paused ---");
    const frozen = await lastCount(page);
    await page.waitForTimeout(800);
    expect(await lastCount(page)).toBe(frozen);

    await page.getByRole("button", { name: /resume simulation/i }).click();
    await expect(serial(page)).toContainText("--- Simulation resumed ---");
    await expect.poll(() => lastCount(page), { timeout: 10_000 }).toBeGreaterThan(frozen);

    await page.getByRole("button", { name: /stop simulation/i }).click();
    await expect(page.getByRole("button", { name: /start simulation/i })).toBeVisible({ timeout: 10_000 });
    await expect(serial(page)).toContainText("--- Simulation stopped ---");
  });

  test("diagnostics: serial input before Serial.begin() is reported as a system line, not as output of the sketch", async ({ page }) => {
    await openWithEngine(page, "browser");
    await startFromEditor(page, LATE_BEGIN);

    await sendSerial(page, "too early");

    await expect(serial(page)).toContainText("Serial input discarded because the receiver was not enabled yet (Serial.begin() has not run)", { timeout: 10_000 });
    await expect(serial(page)).toContainText("begun", { timeout: 15_000 });
  });

  test("reset restarts the sketch without compiling again", async ({ page }) => {
    const traffic = await openWithEngine(page, "browser");
    await startFromEditor(page, COUNTER);
    await expect.poll(() => lastCount(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(8);
    const compiles = traffic.compileRequests;

    await page.locator("#reset-click").click();

    await expect.poll(() => lastCount(page), { timeout: 10_000 }).toBeLessThan(8);
    await expect(serial(page)).toContainText("count 2", { timeout: 10_000 });
    expect(traffic.compileRequests).toBe(compiles);
    await expect(page.getByRole("button", { name: /stop simulation/i })).toBeVisible();
  });

  test("a run in the browser goes on when the connection to the server is lost, and can be stopped", async ({ page, context }: { page: Page; context: BrowserContext }) => {
    await openWithEngine(page, "browser");
    await startFromEditor(page, COUNTER);
    await expect.poll(() => lastCount(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);

    await context.setOffline(true);
    try {
      const before = await lastCount(page);
      await expect.poll(() => lastCount(page), { timeout: 10_000 }).toBeGreaterThan(before + 2);
      await expect(page.getByRole("button", { name: /stop simulation/i })).toBeVisible();
      await expect(serial(page)).not.toContainText("connection to the server was lost");

      await page.getByRole("button", { name: /stop simulation/i }).click();
      // Stopped; a new start needs the server again (compile), so the start button is there but disabled.
      await expect(page.getByRole("button", { name: /stop simulation/i })).toBeHidden({ timeout: 10_000 });
      await expect(page.getByRole("button", { name: /start simulation/i })).toBeDisabled({ timeout: 15_000 });
    } finally {
      await context.setOffline(false);
    }
  });

  test("offline, a run in the browser can be paused and resumed, and the paused time does not advance", async ({ page, context }: { page: Page; context: BrowserContext }) => {
    await openWithEngine(page, "browser");
    await startFromEditor(page, COUNTER);
    await expect.poll(() => lastCount(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);

    await context.setOffline(true);
    try {
      // The health check runs every 5 s with a 2 s timeout: only after it the client knows the server is gone.
      await page.waitForTimeout(8_000);
      await page.getByRole("button", { name: /pause simulation/i }).click();
      await expect(serial(page)).toContainText("--- Simulation paused ---");
      const frozen = await lastCount(page);
      await page.waitForTimeout(800);
      expect(await lastCount(page)).toBe(frozen);

      // The paused run needs no server: Resume stays available while the connection is lost.
      const resume = page.getByRole("button", { name: /resume simulation/i });
      await expect(resume).toBeEnabled({ timeout: 10_000 });
      await resume.click();
      await expect(serial(page)).toContainText("--- Simulation resumed ---");
      await expect.poll(() => lastCount(page), { timeout: 10_000 }).toBeGreaterThan(frozen);
    } finally {
      await context.setOffline(false);
    }
  });

  test("host-mock fallback: with the Legacy engine selected the server simulates and the browser emulation stays unused", async ({ page }) => {
    const traffic = await openWithEngine(page, "host-mock");

    await startFromEditor(page, COUNTER);

    await expect(serial(page)).toContainText("count 2", { timeout: 60_000 });
    expect(traffic.sentTypes).toContain("start_simulation");
  });
});
