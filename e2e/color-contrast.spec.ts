import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The color contract in the browser (client/src/STYLE_GUIDE.md): computed colors of the main actions and of
 * the neutral delete and clear actions, at rest and on hover. Colors are resolved through a canvas, so any CSS
 * color syntax counts; the background is the first opaque one behind the element, translucent layers mixed in.
 */

interface Measure {
  readonly ratio: number;
  readonly foreground: readonly number[];
  readonly red: boolean;
}

async function measure(locator: Locator, part: "self" | "svg" = "self"): Promise<Measure> {
  // Hover and focus transitions finish before the colors are read.
  await locator.evaluate((element) => Promise.all(element.getAnimations({ subtree: true })
    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
    .map((animation) => animation.finished)));
  return locator.evaluate((element, which) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const rgba = (value: string): [number, number, number, number] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = "rgba(0, 0, 0, 0)";
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return [r!, g!, b!, a! / 255];
    };
    const target = which === "svg" ? element.querySelector("svg") ?? element : element;
    const style = getComputedStyle(target);
    const foreground = rgba(which === "svg" ? style.stroke !== "none" ? style.stroke : style.color : style.color);
    let background: [number, number, number] = [0, 0, 0];
    const layers: [number, number, number, number][] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const layer = rgba(getComputedStyle(node).backgroundColor);
      if (layer[3] === 0) continue;
      layers.push(layer);
      if (layer[3] === 1) break;
    }
    for (const [r, g, b, a] of layers.reverse()) background = [r * a + background[0] * (1 - a), g * a + background[1] * (1 - a), b * a + background[2] * (1 - a)];
    const text = [0, 1, 2].map((index) => foreground[index]! * foreground[3] + background[index]! * (1 - foreground[3]));
    const luminance = (rgb: readonly number[]) => {
      const [r, g, b] = rgb.map((value) => {
        const c = value / 255;
        return c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const [light, dark] = [luminance(text), luminance(background)].sort((a, b) => b - a);
    const [r, g, b] = foreground;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const hue = max === min ? 0 : (((max === r ? (g - b) / (max - min) : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4) * 60) + 360) % 360;
    return { ratio: (light! + 0.05) / (dark! + 0.05), foreground: text.map(Math.round), red: saturation > 0.35 && (hue < 15 || hue > 345) };
  }, part);
}

async function expectReadable(locator: Locator, label: string) {
  const rest = await measure(locator);
  expect(rest.ratio, `${label} at rest ${JSON.stringify(rest)}`).toBeGreaterThanOrEqual(4.5);
  await locator.hover();
  const hover = await measure(locator);
  expect(hover.ratio, `${label} on hover ${JSON.stringify(hover)}`).toBeGreaterThanOrEqual(4.5);
}

async function expectNeutral(locator: Locator, label: string, part: "self" | "svg" = "self") {
  const states: [string, Measure][] = [["rest", await measure(locator, part)]];
  await locator.hover();
  states.push(["hover", await measure(locator, part)]);
  await locator.focus();
  states.push(["focus", await measure(locator, part)]);
  for (const [state, value] of states) expect(value.red, `${label} ${state} ${JSON.stringify(value)}`).toBe(false);
}

async function open(page: Page, columns = { code: true, simulation: true, tutor: true }) {
  await page.addInitScript((visible) => {
    localStorage.setItem("unoExperimentalWorkspaceLayout", "1");
    localStorage.setItem("unoExperimentalWorkspaceColumns", JSON.stringify(visible));
  }, columns);
  await page.goto("/");
  await page.waitForFunction(() => Boolean((globalThis as unknown as Record<string, unknown>).__MONACO_EDITOR__));
}

test.describe("color contract", () => {
  test("Start and the Tutor's primary actions are readable at rest and on hover", async ({ page }) => {
    await page.route("**/api/tutor/models", (route) => route.fulfill({ json: { models: ["pilot-model"] } }));
    await open(page);
    await expectReadable(page.getByRole("button", { name: "Start Simulation", exact: true }), "Start");
    await expectReadable(page.getByTestId("tutor-setup-action"), "Tutor einrichten");
    await page.getByTestId("tutor-setup-action").click();
    await page.getByLabel("API-Key", { exact: true }).fill("contrast-key");
    await expectReadable(page.getByTestId("tutor-apply-key"), "Übernehmen");
    await page.getByTestId("tutor-apply-key").click();
    await expectReadable(page.getByTestId("tutor-start-question"), "Frage starten");
  });

  test("the settings dialog's Done is readable at rest and on hover", async ({ page }) => {
    await open(page);
    await page.evaluate(() => globalThis.dispatchEvent(new CustomEvent("open-settings")));
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectReadable(page.getByRole("button", { name: "Done", exact: true }), "Done");
  });

  test("deleting a file is neutral and readable, its label and confirmation kept", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Options", exact: true }).click();
    await page.getByRole("menuitem", { name: "New File", exact: true }).click();
    await page.getByRole("button", { name: "Options", exact: true }).click();
    const entry = page.getByRole("menuitem", { name: "Delete File", exact: true });
    await expect(entry).toBeVisible();
    const rest = await measure(entry);
    expect(rest.ratio, JSON.stringify(rest)).toBeGreaterThanOrEqual(4.5);
    expect(rest.red, JSON.stringify(rest)).toBe(false);
    await entry.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("This action cannot be undone.");
    const confirm = dialog.getByRole("button", { name: "Delete", exact: true });
    await expectReadable(confirm, "Delete confirmation");
    await expectNeutral(confirm, "Delete confirmation");
  });

  test("clearing the serial output is neutral at rest, on hover and on focus", async ({ page }) => {
    await open(page);
    const clear = page.getByTestId("button-clear-serial");
    await expect(clear).toBeVisible();
    await expectNeutral(clear, "Clear serial output", "svg");
  });

  // The workspace toggles share the toolbar icon button: its state color on the opaque hover surface, measured on the
  // icon itself (review of 0fa5bda47, N2: the active icon was green on the green accent surface, 2.08:1).
  test("active and inactive workspace toggles keep their icon readable at rest, on hover and on focus", async ({ page }) => {
    await open(page, { code: true, simulation: true, tutor: false });
    for (const [testId, label, pressed] of [
      ["workspace-toggle-code", "Hide code workspace", "true"],
      ["workspace-toggle-simulation", "Hide simulation workspace", "true"],
      ["workspace-toggle-tutor", "Show tutor workspace", "false"],
    ] as const) {
      const toggle = page.getByTestId(testId);
      await expect(toggle).toHaveAttribute("aria-label", label);
      await expect(toggle).toHaveAttribute("aria-pressed", pressed);
      await page.mouse.move(0, 0);
      const rest = await measure(toggle, "svg");
      await toggle.hover();
      const hover = await measure(toggle, "svg");
      await toggle.focus();
      const focus = await measure(toggle, "svg");
      for (const [state, value] of [["rest", rest], ["hover", hover], ["focus", focus]] as const) {
        expect(value.ratio, `${label} ${state} ${JSON.stringify(value)}`).toBeGreaterThanOrEqual(4.5);
      }
      // The state stays visible on hover: the active icon keeps its success color, the inactive one stays gray.
      expect(hover.foreground, `${label} keeps its state color on hover`).toEqual(rest.foreground);
    }
  });
});
