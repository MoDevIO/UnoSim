import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/pages/arduino-simulator", () => ({
  default: () => (
    <button type="button" onClick={() => globalThis.dispatchEvent(new CustomEvent("open-settings"))}>
      Settings
    </button>
  ),
}));

vi.mock("@/components/features/settings-dialog", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" data-testid="settings-dialog" /> : null,
}));

import App from "../../client/src/App";

describe("settings command parity", () => {
  it("opens from the menu event and remains open when the shortcut is repeated", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByTestId("settings-dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: ",", code: "Comma", ctrlKey: true });
    expect(screen.getByTestId("settings-dialog")).toBeInTheDocument();
  });
});
