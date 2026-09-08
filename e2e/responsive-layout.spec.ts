import { test, expect } from "@playwright/test";

async function waitForMonaco(page: import("@playwright/test").Page) {
  await page.waitForFunction(
    () => Boolean((globalThis as Record<string, unknown>).__MONACO_EDITOR__),
    { timeout: 15000 },
  );
  await expect(page.getByTestId("code-editor")).toBeVisible();
}

test.describe("responsive workspace", () => {
  test("keeps the editor visible at every layout boundary", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto("/");
    await waitForMonaco(page);

    const editorState = await page.evaluate(() => {
      const editor = (globalThis as any).__MONACO_EDITOR__;
      const model = editor.getModel();
      const value = Array.from({ length: 80 }, (_, index) => `int value${index} = ${index};`).join("\n");
      editor.executeEdits("responsive-layout-test", [
        { range: model.getFullModelRange(), text: value },
      ]);
      editor.setPosition({ lineNumber: 40, column: 5 });
      editor.setScrollTop(320);
      return {
        id: editor.getId(),
        value: model.getValue(),
        line: editor.getPosition().lineNumber,
        scrollTop: editor.getScrollTop(),
      };
    });

    for (const width of [767, 768, 1023, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(page.getByTestId("code-editor")).toBeVisible();
      await expect(page.getByRole("button", { name: /start simulation/i })).toBeVisible();

      if (width <= 767) {
        await expect(page.getByTestId("mobile-fab-container")).toBeAttached();
      } else {
        await expect(page.getByTestId("mobile-fab-container")).toHaveCount(0);
      }

      if (width >= 768 && width <= 1023) {
        await expect(page.locator('[data-layout-mode="tablet"]')).toBeVisible();
        await expect
          .poll(async () =>
            page.evaluate(() => {
              const code = document.querySelector<HTMLElement>(".workspace-code-panel");
              const output = document.querySelector<HTMLElement>(".workspace-output-panel");
              return (code?.getBoundingClientRect().width ?? 0) / (output?.getBoundingClientRect().width ?? 1);
            }),
          )
          .toBeGreaterThan(1.4);
      }
    }

    const afterResize = await page.evaluate(() => {
      const editor = (globalThis as any).__MONACO_EDITOR__;
      const model = editor.getModel();
      return {
        id: editor.getId(),
        value: model.getValue(),
        line: editor.getPosition().lineNumber,
        scrollTop: editor.getScrollTop(),
      };
    });

    expect(afterResize.id).toBe(editorState.id);
    expect(afterResize.value).toBe(editorState.value);
    expect(afterResize.line).toBe(editorState.line);
    expect(afterResize.scrollTop).toBeGreaterThan(0);

    const undoRedoState = await page.evaluate(() => {
      const editor = (globalThis as any).__MONACO_EDITOR__;
      const beforeUndo = editor.getModel().getValue();
      editor.trigger("keyboard", "undo", {});
      const afterUndo = editor.getModel().getValue();
      editor.trigger("keyboard", "redo", {});
      const afterRedo = editor.getModel().getValue();
      return { beforeUndo, afterUndo, afterRedo };
    });

    expect(undoRedoState.afterUndo).not.toBe(undoRedoState.beforeUndo);
    expect(undoRedoState.afterRedo).toBe(undoRedoState.beforeUndo);
    await expect(page.getByTestId("code-editor")).toBeVisible();
  });

  test("keeps the active output tab across mobile and desktop resize", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto("/");
    await waitForMonaco(page);

    await page.evaluate(() => {
      document.dispatchEvent(
        new CustomEvent("showCompileOutputChange", { detail: { value: true } }),
      );
      document.dispatchEvent(
        new CustomEvent("setOutputTab", { detail: { tab: "registry" } }),
      );
    });
    await expect(page.getByRole("tab", { name: "I/O Registry" })).toHaveAttribute(
      "data-state",
      "active",
    );

    await page.setViewportSize({ width: 767, height: 800 });
    await page.getByRole("button", { name: "Compilation Output" }).click();
    await expect(page.getByRole("tab", { name: "I/O Registry" })).toHaveAttribute(
      "data-state",
      "active",
    );

    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(page.getByRole("tab", { name: "I/O Registry" })).toHaveAttribute(
      "data-state",
      "active",
    );
  });

  test("uses the shared serial view and returns to the editor", async ({ page }) => {
    await page.setViewportSize({ width: 767, height: 800 });
    await page.goto("/");
    await waitForMonaco(page);

    await page.getByRole("button", { name: "Serial Output" }).click();
    await expect(page.getByText("Serial Output", { exact: true })).toBeVisible();

    const viewToggle = page.getByTestId("button-serial-view-toggle");
    await expect(viewToggle).toHaveAttribute("aria-label", "Monitor only");
    await viewToggle.click();
    await expect(viewToggle).toHaveAttribute("aria-label", "Split view");
    await viewToggle.click();
    await expect(viewToggle).toHaveAttribute("aria-label", "Plotter only");
    await expect(page.getByTestId("serial-plotter")).toBeVisible();

    await page.getByRole("button", { name: "Code Editor" }).click();
    await expect(page.getByTestId("code-editor")).toBeVisible();
    await expect(page.getByTestId("serial-plotter")).not.toBeVisible();
  });

  test("keeps a running simulation alive while resizing", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto("/");
    await waitForMonaco(page);

    const code = `void setup() {
  Serial.begin(115200);
}
void loop() {
  Serial.println("RESIZE_OK");
  delay(100);
}`;
    const compileResponse = await page.request.post("/api/compile", {
      data: { code },
      timeout: 120000,
    });
    expect(compileResponse.ok()).toBeTruthy();
    const compileResult = await compileResponse.json();
    expect(compileResult.success).toBeTruthy();

    await page.evaluate((source) => {
      const editor = (globalThis as any).__MONACO_EDITOR__;
      editor.setValue(source);
      (globalThis as any).__SET_LAST_COMPILED_CODE__?.(source);
    }, code);

    await page.getByRole("button", { name: /start simulation/i }).click();
    const stopButton = page.getByRole("button", { name: /stop simulation/i });
    await expect(stopButton).toBeVisible({ timeout: 30000 });

    await page.setViewportSize({ width: 767, height: 800 });
    await expect(stopButton).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(stopButton).toBeVisible();

    await stopButton.click();
  });
});
