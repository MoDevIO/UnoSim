import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

type PinModeOptions = {
  pin: number;
  mode?: "INPUT" | "OUTPUT" | "INPUT_PULLUP";
};

type VerifyOptions = PinModeOptions | { text: string };

type VerifyKind = "pinMode" | "text";

export class MonacoEditor {
  constructor(
    private page: Page,
    private editor: Locator = page.locator(".monaco-editor"),
  ) {}

  async waitForReady(): Promise<void> {
    // Wait for the editor element to appear in the DOM.  We intentionally
    // keep this method lightweight: the caller usually follows up with a
    // longer `expect.poll(getValue())` check, which is where we handle
    // slow-loading sketches.  Adding heavyweight content polling here made
    // the helper itself occasionally time out when the editor took over 30s
    // to hydrate.
    await this.editor.waitFor({ state: "visible" });
  }

  async getValue(): Promise<string> {
    const value = await this.page.evaluate(() => {
      const monacoEditor = (window as any).monaco?.editor;
      const model = monacoEditor?.getModels?.()[0];
      return model?.getValue?.() ?? "";
    });

    if (value && value.trim().length > 0) {
      return value;
    }

    const fallback = await this.editor.innerText();
    return fallback ?? "";
  }

  async setValue(code: string): Promise<void> {
    await this.page.evaluate((value) => {
      const monacoEditor = (window as any).monaco?.editor;
      const model = monacoEditor?.getModels?.()[0];
      if (model?.setValue) {
        model.setValue(value);
      }
    }, code);

    const current = await this.getValue();
    if (current.trim() === code.trim()) {
      return;
    }

    await this.editor.click();
    await this.page.keyboard.press("Control+A");
    await this.page.keyboard.press("Backspace");
    await this.page.keyboard.type(code);
  }

  async verifyCodeContains(kind: VerifyKind, options: VerifyOptions): Promise<void> {
    const code = await this.getValue();

    if (kind === "text") {
      const text = (options as { text: string }).text;
      expect(code).toContain(text);
      return;
    }

    const { pin, mode } = options as PinModeOptions;
    const varMatch = code.match(
      new RegExp(
        `\\b(?:const\\s+)?(?:int|uint8_t|byte|long|short|auto)\\s+(\\w*pin\\w*)\\s*=\\s*${pin}\\b`,
        "i",
      ),
    );
    const pinToken = varMatch?.[1] ? `(?:${varMatch[1]}|${pin})` : `${pin}`;
    const modeToken = mode ? mode : "(?:INPUT|OUTPUT|INPUT_PULLUP)";

    const rx = new RegExp(
      `\\bpinMode\\s*\\(\\s*${pinToken}\\s*,\\s*${modeToken}\\s*\\)`,
      "i",
    );
    expect(code).toMatch(rx);
  }
}
