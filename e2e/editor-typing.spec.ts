import { expect, test, type Page } from "@playwright/test";

// Typing comfort of the sketch editor (real Monaco, real key presses): Enter continues the indentation,
// brackets and quotes close themselves, Tab indents by two spaces.

// Keys are typed with a small delay like a person would; Monaco finishes auto-closing and re-tokenizing between
// key presses, which a zero-delay burst does not give it.
async function freshEditor(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((globalThis as any).__MONACO_EDITOR__));
  await page.evaluate(() => (globalThis as any).__MONACO_EDITOR__.setValue(""));
  await page.locator('[data-testid="code-editor"]').click();
}

const text = (page: Page) => page.evaluate(() => (globalThis as any).__MONACO_EDITOR__.getValue() as string);

test.describe("editor typing comfort", () => {
  test("Enter after an opening brace indents and puts the closing brace below", async ({ page }) => {
    await freshEditor(page);
    await page.keyboard.type("void setup() {", { delay: 25 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("Serial.begin(9600);", { delay: 25 });

    expect(await text(page)).toBe("void setup() {\n  Serial.begin(9600);\n}");
  });

  test("Enter after a statement keeps the indentation, nested blocks go one level deeper", async ({ page }) => {
    await freshEditor(page);
    await page.keyboard.type("void loop() {", { delay: 25 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("if (x) {", { delay: 25 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("y();", { delay: 25 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("z();", { delay: 25 });

    expect(await text(page)).toBe("void loop() {\n  if (x) {\n    y();\n    z();\n  }\n}");
  });

  test("typing a closing bracket steps over the automatic one on the same line", async ({ page }) => {
    await freshEditor(page);
    await page.keyboard.type("int a[] = {1, 2};", { delay: 25 });

    expect(await text(page)).toBe("int a[] = {1, 2};");
  });

  test("Enter in the middle of an indented line continues at that indentation", async ({ page }) => {
    await freshEditor(page);
    await page.evaluate(() => (globalThis as any).__MONACO_EDITOR__.setValue("void f() {\n    a(); b();\n}"));
    await page.evaluate(() => (globalThis as any).__MONACO_EDITOR__.setPosition({ lineNumber: 2, column: 10 }));
    await page.keyboard.press("Enter");

    expect((await text(page)).split("\n")[2]).toMatch(/^ {4}b\(\);$/);
  });

  test("Enter after a line comment keeps the indentation", async ({ page }) => {
    await freshEditor(page);
    await page.keyboard.type("void f() {", { delay: 25 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("// note", { delay: 25 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("a();", { delay: 25 });

    expect(await text(page)).toBe("void f() {\n  // note\n  a();\n}");
  });

  test("parentheses and quotes close themselves, typing the closer steps over it", async ({ page }) => {
    await freshEditor(page);
    await page.keyboard.type('Serial.println("hi");', { delay: 25 });

    expect(await text(page)).toBe('Serial.println("hi");');
  });

  test("Tab indents by two spaces", async ({ page }) => {
    await freshEditor(page);
    await page.keyboard.press("Tab");
    await page.keyboard.type("a();", { delay: 25 });

    expect(await text(page)).toBe("  a();");
  });

  test("setValue keeps programmatic code exactly as given", async ({ page }) => {
    await freshEditor(page);
    const code = "void setup() {\n      Serial.begin(9600);\n}\n";
    await page.evaluate((c) => (globalThis as any).__MONACO_EDITOR__.setValue(c), code);

    expect(await text(page)).toBe(code);
  });
});
