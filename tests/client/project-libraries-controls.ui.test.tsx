import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LibraryHintsBar } from "@/components/features/project-libraries-controls";

describe("hints for written includes (SSOT Libraries §7)", () => {
  it("names the header and offers the concrete version", async () => {
    const onAdd = vi.fn();
    render(<LibraryHintsBar hints={[{ header: "AUnit.h", file: "sketch.ino", line: 1, candidates: [{ name: "AUnit", version: "1.7.1" }] }]} onAdd={onAdd} />);

    expect(screen.getByText("AUnit.h detected. AUnit is not in the project libraries yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add AUnit 1.7.1" }));

    expect(onAdd).toHaveBeenCalledWith({ name: "AUnit", version: "1.7.1" });
  });

  it("lets the person choose when several packages provide the header", () => {
    render(<LibraryHintsBar hints={[{ header: "Twin.h", file: "sketch.ino", line: 1, candidates: [{ name: "TwinA", version: "1.0.0" }, { name: "TwinB", version: "1.0.0" }] }]} onAdd={vi.fn()} />);

    expect(screen.getByText("Twin.h detected. Several libraries provide this header:")).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Add TwinA 1.0.0", "Add TwinB 1.0.0"]);
  });

  it("renders nothing without hints", () => {
    const { container } = render(<LibraryHintsBar hints={[]} onAdd={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });
});
