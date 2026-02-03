import { expect } from "@playwright/test";

expect.extend({
  toHaveArduinoCode(received: string, expected: string | RegExp) {
    const code = typeof received === "string" ? received : String(received ?? "");
    const pass =
      expected instanceof RegExp
        ? expected.test(code)
        : code.includes(expected);

    return {
      pass,
      message: () =>
        `Expected code to contain ${expected instanceof RegExp ? expected : JSON.stringify(expected)}`,
    };
  },
});

export {};
