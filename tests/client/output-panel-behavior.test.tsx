import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OutputPanel } from "../../client/src/components/features/output-panel";

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children, value }: any) => <div data-tabs-value={value}>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children, value, onDoubleClick }: any) => <button data-tab={value} onDoubleClick={onDoubleClick}>{children}</button>,
  TabsContent: ({ children, value }: any) => <section data-content={value}>{children}</section>,
}));
vi.mock("@/components/ui/tab-bar", () => ({ TabBar: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/ui/button", () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock("@/components/ui/scroll-area", () => ({ ScrollArea: ({ children }: any) => <div>{children}</div> }));
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
  parserMessages: [{ line: 4, message: "warning", severity: "warning" } as any],
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

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "state" } });
    fireEvent.click(screen.getByTitle("Switch to tiles view"));
    fireEvent.click(screen.getByText("Copy"));
    fireEvent.click(screen.getByText("Clear"));

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
