import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsDialog from "@/components/features/settings-dialog";
import { resetRuntimeConfigCache } from "@/lib/runtime/runtime-config";
import { ENGINE_PREFERENCE_KEY } from "@/lib/runtime/runtime-selection";

vi.mock("@/components/features/external-examples-settings", () => ({ ExternalExamplesSettings: () => <section aria-label="External Examples settings" /> }));

function serve(backends: string[], defaultRuntime: string, board = { id: "uno", displayName: "Arduino UNO", status: "available", runtimes: ["browser", "host-mock"] }) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      boards: [board],
      defaultBoard: board.id,
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

  it("shows the setting fixed when the server offers a single engine", async () => {
    serve(["host-mock"], "host-mock");

    render(<SettingsDialog open onOpenChange={vi.fn()} />);
    const select = (await screen.findByLabelText("simulation engine")) as HTMLSelectElement;

    expect(select).toBeDisabled();
    expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual(["Legacy (only option)"]);
    expect(screen.getByText(/Emulation is not offered by this server\./)).toBeInTheDocument();
  });

  it.each([
    ["nano", "Arduino Nano"],
    ["mega2560", "Arduino Mega 2560"],
  ])("shows the setting fixed to Emulation for %s and says why Legacy is missing", async (id, displayName) => {
    serve(["browser", "host-mock"], "browser", { id, displayName, status: "preview", runtimes: ["browser"] });
    localStorage.setItem("unoSelectedBoard", id);

    render(<SettingsDialog open onOpenChange={vi.fn()} />);
    const select = (await screen.findByLabelText("simulation engine")) as HTMLSelectElement;

    await waitFor(() => expect(select).toBeDisabled());
    expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual(["Emulation (only option)"]);
    expect(screen.getByText(new RegExp(String.raw`Legacy is not implemented for ${displayName}\.`))).toBeInTheDocument();
  });
});
