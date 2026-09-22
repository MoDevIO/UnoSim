import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OutputPanel } from "../../client/src/components/features/output-panel";

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children, value }: any) => <div data-tabs-value={value}>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children, value, onDoubleClick, className }: any) => <button data-tab={value} className={className} onDoubleClick={onDoubleClick}>{children}</button>,
  TabsContent: ({ children, value }: any) => <section data-content={value}>{children}</section>,
}));
vi.mock("@/components/ui/button", () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock("@/components/ui/unified-scroll-area", () => ({
  UnifiedScrollArea: ({ children }: any) => <div data-testid="unified-output-scroll-area">{children}</div>,
}));
vi.mock("@/components/features/compilation-output", () => ({ CompilationOutput: ({ output, onClear }: any) => <div><span>{output}</span><button onClick={onClear}>clear compilation</button></div> }));
vi.mock("@/components/features/parser-output", () => ({ ParserOutput: ({ messages, onClear, onGoToLine, onInsertSuggestion }: any) => <div><span>{messages.length} parser messages</span><button onClick={onClear}>clear parser</button><button onClick={() => onGoToLine(4)}>go line</button><button onClick={() => onInsertSuggestion("fix", 4)}>insert</button></div> }));

const baseProps = () => ({
  activeOutputTab: "compiler" as const,
  isSuccessState: true,
  isModified: false,
  debugMode: true,
  debugViewMode: "table" as const,
  debugMessageFilter: "",
  cliOutput: "compile output",
  parserMessages: [{ id: "message-1", type: "warning", category: "hardware", line: 4, message: "warning", severity: 2 }],
  ioRegistry: [{ pinId: 13, usedAt: [{ operation: "digitalWrite:13" }] } as any],
  debugMessages: [{ id: "1", timestamp: new Date(), sender: "server", protocol: "ws", type: "state", content: "{}" } as any],
  lastCompilationResult: "ok",
  hasCompilationErrors: false,
  outputTabsHeaderRef: { current: null },
  parserMessagesContainerRef: { current: null },
  debugMessagesContainerRef: { current: null },
  onTabChange: vi.fn(),
  openOutputPanel: vi.fn(),
  onClose: vi.fn(),
  onClearCompilationOutput: vi.fn(),
  onParserMessagesClear: vi.fn(),
  onParserGoToLine: vi.fn(),
  onInsertSuggestion: vi.fn(),
  onRegistryClear: vi.fn(),
  setDebugMessageFilter: vi.fn(),
  setDebugViewMode: vi.fn(),
  onCopyDebugMessages: vi.fn(),
  onClearDebugMessages: vi.fn(),
});

describe("OutputPanel behavior", () => {
  it.each([
    ["no messages", [], "text-muted-foreground"],
    ["informational messages", [{ severity: 1 }], "text-accent-cyan"],
    ["a warning is present", [{ severity: 1 }, { severity: 2 }], "text-status-warning"],
    ["an error is present", [{ severity: 2 }, { severity: 3 }], "text-status-error"],
  ])("colors the Messages tab by severity: %s", (_case, severities, expectedClass) => {
    const parserMessages = severities.map((message, index) => ({
      id: `message-${index}`,
      type: "info" as const,
      category: "hardware" as const,
      message: "diagnostic",
      severity: message.severity as 1 | 2 | 3,
    }));

    render(<OutputPanel {...baseProps()} parserMessages={parserMessages} />);

    expect(screen.getByRole("button", { name: /Messages/i })).toHaveClass(expectedClass);
  });

  it("uses the shared error color for a registry conflict", () => {
    render(<OutputPanel {...baseProps()} />);

    expect(screen.getByRole("button", { name: /I\/O Registry/i })).toHaveClass("text-status-error");
  });

  it("uses the shared muted color when the registry has no conflict", () => {
    render(<OutputPanel {...baseProps()} ioRegistry={[]} />);

    expect(screen.getByRole("button", { name: /I\/O Registry/i })).toHaveClass("text-muted-foreground");
  });

  it("colors the Compiler tab with shared success and error semantics", () => {
    const { rerender } = render(<OutputPanel {...baseProps()} />);
    const compiler = screen.getByRole("button", { name: /Compiler/i });
    expect(compiler).toHaveClass("text-status-success");

    rerender(<OutputPanel {...baseProps()} hasCompilationErrors={true} />);
    expect(screen.getByRole("button", { name: /Compiler/i })).toHaveClass("text-status-error");
  });

  it("keeps panel tabs on the shared typography and outer alignment contract", () => {
    render(<OutputPanel {...baseProps()} />);

    const header = screen.getByTestId("output-tabs-header");
    expect(header).not.toHaveClass("px-[var(--header-padding-x)]");
    expect(screen.getByRole("button", { name: /Compiler/i })).toHaveClass("uppercase", "tracking-wide");
  });

  it("renders compiler/messages/registry tabs and routes user actions", () => {
    const props = baseProps();
    render(<OutputPanel {...props} />);

    expect(screen.getByText("compile output")).toBeInTheDocument();
    fireEvent.doubleClick(screen.getByRole("button", { name: /Compiler/i }));
    fireEvent.doubleClick(screen.getByRole("button", { name: /Messages/i }));
    fireEvent.click(screen.getByText("clear compilation"));
    fireEvent.click(screen.getAllByText("clear parser")[0]);
    fireEvent.click(screen.getAllByText("go line")[0]);
    fireEvent.click(screen.getAllByText("insert")[0]);
    fireEvent.click(screen.getByTitle("Close"));

    expect(props.openOutputPanel).toHaveBeenCalledWith("compiler");
    expect(props.openOutputPanel).toHaveBeenCalledWith("messages");
    expect(props.onClearCompilationOutput).toHaveBeenCalled();
    expect(props.onParserMessagesClear).toHaveBeenCalled();
    expect(props.onParserGoToLine).toHaveBeenCalledWith(4);
    expect(props.onInsertSuggestion).toHaveBeenCalledWith("fix", 4);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("renders debug controls, filters messages, toggles view, and clears/copies", () => {
    const props = baseProps();
    render(<OutputPanel {...props} activeOutputTab="debug" />);

    expect(screen.getByTestId("unified-output-scroll-area")).toBeInTheDocument();
    expect(screen.getByRole("combobox").closest(".panel-content-header")).not.toBeNull();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "state" } });
    fireEvent.click(screen.getByTitle("Switch to tiles view"));
    const copyButton = screen.getByRole("button", { name: "Copy debug messages" });
    const clearButton = screen.getByRole("button", { name: "Clear debug messages" });
    expect(screen.queryByText("Copy")).toBeNull();
    expect(screen.queryByText("Clear")).toBeNull();
    expect(copyButton).toHaveAttribute("variant", "ghost");
    expect(clearButton).toHaveAttribute("variant", "ghost");
    fireEvent.click(copyButton);
    fireEvent.click(clearButton);

    expect(props.setDebugMessageFilter).toHaveBeenCalledWith("state");
    expect(props.setDebugViewMode).toHaveBeenCalledWith("tiles");
    expect(props.onCopyDebugMessages).toHaveBeenCalled();
    expect(props.onClearDebugMessages).toHaveBeenCalled();
  });

  it("hides debug controls when debug mode is disabled", () => {
    render(<OutputPanel {...baseProps()} debugMode={false} />);
    expect(screen.queryByText("Debug")).not.toBeInTheDocument();
  });
});
