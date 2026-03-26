import React, { useCallback, useMemo, useRef, useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { OutputPanel } from "../../client/src/components/features/output-panel";

describe("OutputPanel — callback reference stability", () => {
  it("does not re-render when parent updates unrelated state while callbacks and data props are stable", () => {
    function Wrapper() {
      const [count, setCount] = useState(0);

      // Stable (memoized) data props
      const parserMessages = useMemo(() => [], [] as any);
      const ioRegistry = useMemo(() => [], [] as any);
      const debugMessages = useMemo(() => [], [] as any);

      // Stable callbacks (useCallback ensures referential stability)
      const onTabChange = useCallback(() => {}, []);
      const openOutputPanel = useCallback(() => {}, []);
      const onClose = useCallback(() => {}, []);
      const onClearCompilationOutput = useCallback(() => {}, []);
      const onParserMessagesClear = useCallback(() => {}, []);
      const onParserGoToLine = useCallback(() => {}, []);
      const onInsertSuggestion = useCallback(() => {}, []);
      const onRegistryClear = useCallback(() => {}, []);
      const setDebugMessageFilter = useCallback(() => {}, []);
      const setDebugViewMode = useCallback(() => {}, []);
      const onCopyDebugMessages = useCallback(() => {}, []);
      const onClearDebugMessages = useCallback(() => {}, []);

      // Stable refs
      const outputTabsHeaderRef = useRef<HTMLDivElement | null>(null);
      const parserMessagesContainerRef = useRef<HTMLDivElement | null>(null);
      const debugMessagesContainerRef = useRef<HTMLDivElement | null>(null);

      return (
        <>
          <button data-count={count} onClick={() => setCount((c) => c + 1)}>Inc</button>
          <div data-testid="output-root">
            <OutputPanel
              activeOutputTab="compiler"
              showCompilationOutput={true}
              isSuccessState={true}
              isModified={false}
              compilationPanelSize={3}
              outputPanelMinPercent={3}
              debugMode={false}
              debugViewMode="table"
              debugMessageFilter={""}

              cliOutput={""}
              parserMessages={parserMessages}
              ioRegistry={ioRegistry}
              debugMessages={debugMessages}
              lastCompilationResult={null}
              hasCompilationErrors={false}

              outputTabsHeaderRef={outputTabsHeaderRef}
              parserMessagesContainerRef={parserMessagesContainerRef}
              debugMessagesContainerRef={debugMessagesContainerRef}

              onTabChange={onTabChange}
              openOutputPanel={openOutputPanel}
              onClose={onClose}

              onClearCompilationOutput={onClearCompilationOutput}
              onParserMessagesClear={onParserMessagesClear}
              onParserGoToLine={onParserGoToLine}
              onInsertSuggestion={onInsertSuggestion}
              onRegistryClear={onRegistryClear}

              setDebugMessageFilter={setDebugMessageFilter}
              setDebugViewMode={setDebugViewMode}
              onCopyDebugMessages={onCopyDebugMessages}
              onClearDebugMessages={onClearDebugMessages}
            />
          </div>
        </>
      );
    }

    render(<Wrapper />);

    const container = screen.getByTestId("output-root");

    // Observe DOM mutations inside the OutputPanel root
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((mutations) => records.push(...mutations));
    observer.observe(container, { attributes: true, childList: true, subtree: true, characterData: true });

    // Clear any mutations produced by initial mount
    records.splice(0, records.length);

    // Trigger unrelated parent state update
    fireEvent.click(screen.getByText("Inc"));

    // Allow microtask queue to settle and then check that OutputPanel DOM did not change
    // (no unnecessary DOM mutations == no visible flicker)
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        observer.disconnect();
        expect(records.length).toBe(0);
        resolve();
      });
    });
  });
});
