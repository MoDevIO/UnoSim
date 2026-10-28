import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LibrariesButton, LibraryHintsBar } from "@/components/features/project-libraries-controls";

describe("Libraries button (SSOT Libraries §5.1)", () => {
  it("counts the direct selection and opens the dialog", async () => {
    const onClick = vi.fn();
    render(<LibrariesButton count={1} onClick={onClick} />);

    await userEvent.click(screen.getByRole("button", { name: "Libraries (1)" }));

    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("hints for written includes (SSOT Libraries §7)", () => {
  it("names the header and offers the concrete version", async () => {
    const onAdd = vi.fn();
    render(<LibraryHintsBar hints={[{ header: "AUnit.h", file: "sketch.ino", line: 1, candidates: [{ name: "AUnit", version: "1.7.1" }] }]} onAdd={onAdd} />);

    expect(screen.getByText("AUnit.h erkannt. AUnit fehlt noch in den Projektbibliotheken.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "AUnit 1.7.1 hinzufügen" }));

    expect(onAdd).toHaveBeenCalledWith({ name: "AUnit", version: "1.7.1" });
  });

  it("lets the person choose when several packages provide the header", () => {
    render(<LibraryHintsBar hints={[{ header: "Twin.h", file: "sketch.ino", line: 1, candidates: [{ name: "TwinA", version: "1.0.0" }, { name: "TwinB", version: "1.0.0" }] }]} onAdd={vi.fn()} />);

    expect(screen.getByText("Twin.h erkannt. Mehrere Bibliotheken stellen diesen Header bereit:")).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["TwinA 1.0.0 hinzufügen", "TwinB 1.0.0 hinzufügen"]);
  });

  it("renders nothing without hints", () => {
    const { container } = render(<LibraryHintsBar hints={[]} onAdd={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });
});
