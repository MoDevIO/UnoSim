import { describe, expect, it } from "vitest";
import { buildGccCompilationErrorState } from "../../client/src/lib/compilation-error-state";

describe("GCC compilation error UI state", () => {
  it("forces compiler tab and error state", () => {
    const errorText = "sketch.ino:847:3: error: use of undeclared identifier 'func'";
    const state = buildGccCompilationErrorState(errorText);

    expect(state.hasCompilationErrors).toBe(true);
    expect(state.lastCompilationResult).toBe("error");
    expect(state.showCompilationOutput).toBe(true);
    expect(state.parserPanelDismissed).toBe(false);
    expect(state.activeOutputTab).toBe("compiler");
    expect(state.cliOutput).toContain("GCC Compilation Error");
    expect(state.cliOutput).toContain(errorText);
  });
});
