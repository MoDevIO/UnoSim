import { render, screen, fireEvent } from "@testing-library/react";
import { CompilationOutput } from "@/components/features/compilation-output";

describe("CompilationOutput", () => {
  it("should render output text", () => {
    render(
      <CompilationOutput
        output="Sketch uses 736 bytes (2%) of program storage space."
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByText(/Sketch uses 736 bytes/i)).not.toBeNull();
  });

  it("should render error message", () => {
    render(
      <CompilationOutput
        output="error: 'digitalWrit' was not declared in this scope"
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByText(/digitalWrit/i)).not.toBeNull();
  });

  it("should show placeholder when no output", () => {
    render(<CompilationOutput output="" onClear={vi.fn()} />);

    expect(screen.getByText(/Compilation output will appear here/i)).not.toBeNull();
  });

  it("should call onClear when clear button is clicked", () => {
    const onClear = vi.fn();
    render(<CompilationOutput output="Some output" onClear={onClear} />);

    const clearButton = screen.getByRole("button", { name: /clear/i });
    fireEvent.click(clearButton);

    expect(onClear).toHaveBeenCalled();
  });

  it("should handle multi-line output", () => {
    const multiLineOutput = `Sketch uses 736 bytes (2%) of program storage space.
Global variables use 9 bytes (0%) of dynamic memory.`;

    render(<CompilationOutput output={multiLineOutput} onClear={vi.fn()} />);

    expect(screen.getByTestId("compilation-text").textContent).toMatch(/Sketch uses 736 bytes/i);
    expect(screen.getByTestId("compilation-text").textContent).toMatch(/Global variables use 9 bytes/i);
  });

  it("should show the compilation failure title when the panel has errors", () => {
    render(
      <CompilationOutput
        output="error: compilation failed"
        hasCompilationErrors
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByTestId("compilation-failed-title")).toHaveTextContent("Compilation failed");
  });

  it("uses the shared success token for a successful compilation", () => {
    render(<CompilationOutput isSuccess onClear={vi.fn()} />);

    expect(screen.getByText("Compilation successful ✓")).toHaveClass("text-status-success");
  });

  it("uses shared error and warning tokens for compiler diagnostics", () => {
    render(
      <CompilationOutput
        hasCompilationErrors
        errors={[
          { file: "main.ino", line: 2, column: 1, type: "error", message: "Syntax error" },
          { file: "main.ino", line: 3, column: 1, type: "warning", message: "Unused value" },
        ]}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByText(/error: Syntax error/)).toHaveClass("text-status-error");
    expect(screen.getByText(/warning: Unused value/)).toHaveClass("text-status-warning");
  });
});
