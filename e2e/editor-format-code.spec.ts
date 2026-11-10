import { expect, test, type Page } from "@playwright/test";

// "Format Code" through the real menus on the real Monaco editor (ssot/ssot_function_definition_CodeFormatting.md):
// the editor's text after formatting, Undo back to the text before, and a second run that changes nothing.

const UNFORMATTED = [
  "int zahl = 7;",
  "void setup() {",
  "Serial.begin(9600);",
  "}",
  "void loop() {",
  "int eingabe = Serial.parseInt();",
  "if (eingabe == zahl)",
  "Serial.println(\"Zahl gefunden\");",
  "else",
  "Serial.println(\"Falsche Zahl\");",
  "}",
].join("\n");

const FORMATTED = [
  "int zahl = 7;",
  "void setup() {",
  "  Serial.begin(9600);",
  "}",
  "void loop() {",
  "  int eingabe = Serial.parseInt();",
  "  if (eingabe == zahl)",
  "    Serial.println(\"Zahl gefunden\");",
  "  else",
  "    Serial.println(\"Falsche Zahl\");",
  "}",
  "",
].join("\n");

const text = (page: Page) => page.evaluate(() => (globalThis as any).__MONACO_EDITOR__.getValue() as string);

// The page fills an empty editor with the default sketch once /api/sketches answers, so the sketch is set after it.
async function editorWith(page: Page, code: string) {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((globalThis as any).__MONACO_EDITOR__?.getValue()));
  await page.evaluate((value) => (globalThis as any).__MONACO_EDITOR__.setValue(value), code);
  expect(await text(page)).toBe(code);
}

test.describe("Format Code", () => {
  test("File → Format Code indents brace-less if and else, and Undo restores the text before", async ({ page }) => {
    await editorWith(page, UNFORMATTED);
    // Typed right before formatting: Undo must step back to this text, not merge it with the formatting.
    await page.locator('[data-testid="code-editor"]').click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("int ende;");
    const typed = `${UNFORMATTED}int ende;`;
    await expect.poll(() => text(page)).toBe(typed);

    await page.getByRole("menuitem", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Format Code/ }).click();
    await expect.poll(() => text(page)).toBe(`${FORMATTED}int ende;\n`);

    await page.locator('[data-testid="code-editor"]').click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => text(page)).toBe(typed);

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(() => text(page)).toBe(`${FORMATTED}int ende;\n`);
  });

  test("the sketch tab's Format Code gives the same text, and formatting again changes nothing", async ({ page }) => {
    await editorWith(page, UNFORMATTED);

    await page.getByRole("button", { name: "Options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Format Code", exact: true }).click();
    await expect.poll(() => text(page)).toBe(FORMATTED);

    const version = () => page.evaluate(() => (globalThis as any).__MONACO_EDITOR__.getModel().getVersionId() as number);
    const before = await version();
    await page.getByRole("button", { name: "Options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Format Code", exact: true }).click();
    await expect(page.getByRole("menu")).toBeHidden();
    expect(await text(page)).toBe(FORMATTED);
    expect(await version()).toBe(before);
  });
});
