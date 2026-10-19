import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsDialog from "@/components/features/settings-dialog";
import { resetRuntimeConfigCache } from "@/lib/runtime/runtime-config";
import { ENGINE_PREFERENCE_KEY } from "@/lib/runtime/runtime-selection";

vi.mock("@/components/features/external-examples-settings", () => ({ ExternalExamplesSettings: () => <section aria-label="External Examples settings" /> }));

function serve(backends: string[], defaultRuntime: string) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      boards: [{ id: "uno", displayName: "Arduino UNO", status: "available", runtimes: ["browser", "host-mock"] }],
      defaultBoard: "uno",
      runtime: { backends, default: defaultRuntime },
    }),
  }));
}

beforeEach(() => {
  resetRuntimeConfigCache();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SettingsDialog: Simulation engine (plan P3.1)", () => {
  it("offers Emulation and Legacy when the server offers both, with the server default first", async () => {
    serve(["browser", "host-mock"], "host-mock");

    render(<SettingsDialog open onOpenChange={vi.fn()} />);
    const select = await screen.findByLabelText("simulation engine");

    expect(screen.getByRole("heading", { name: "Simulation" })).toBeInTheDocument();
    expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual(["Server default (Legacy)", "Emulation", "Legacy"]);
  });

  it("stores the choice and clears it again", async () => {
    serve(["browser", "host-mock"], "host-mock");
    render(<SettingsDialog open onOpenChange={vi.fn()} />);
    const select = await screen.findByLabelText("simulation engine");

    fireEvent.change(select, { target: { value: "browser" } });
    expect(localStorage.getItem(ENGINE_PREFERENCE_KEY)).toBe("browser");
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe("browser"));

    fireEvent.change(select, { target: { value: "" } });
    expect(localStorage.getItem(ENGINE_PREFERENCE_KEY)).toBeNull();
  });

  it("shows the stored choice", async () => {
    serve(["browser", "host-mock"], "browser");
    localStorage.setItem(ENGINE_PREFERENCE_KEY, "host-mock");

    render(<SettingsDialog open onOpenChange={vi.fn()} />);
    const select = (await screen.findByLabelText("simulation engine")) as HTMLSelectElement;

    expect(select.value).toBe("host-mock");
  });

  it("hides the setting when the server offers a single engine", async () => {
    serve(["host-mock"], "host-mock");

    render(<SettingsDialog open onOpenChange={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());

    expect(screen.queryByLabelText("simulation engine")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Simulation" })).not.toBeInTheDocument();
  });
});
