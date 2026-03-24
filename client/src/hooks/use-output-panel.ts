import { useState, useRef, useCallback, useEffect } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import type { ParserMessage } from "@shared/schema";

type CompilationResultType = "success" | "error" | null;
type OutputTabType = "compiler" | "messages" | "registry" | "debug";

export function useOutputPanel(
  hasCompilationErrors: boolean,
  cliOutput: string,
  parserMessages: ParserMessage[],
  lastCompilationResult: CompilationResultType,
  parserMessagesContainerRef: React.RefObject<HTMLDivElement>,
  showCompilationOutput: boolean,
  setShowCompilationOutput: (value: boolean | ((prev: boolean) => boolean)) => void,
  setParserPanelDismissed: (value: boolean) => void,
  setActiveOutputTab: (tab: OutputTabType) => void,
  code: string,
) {
  const outputPanelRef = useRef<ImperativePanelHandle | null>(null);
  const outputTabsHeaderRef = useRef<HTMLDivElement | null>(null);
  const [outputPanelMinPercent, setOutputPanelMinPercent] = useState<number>(3);
  const [compilationPanelSize, setCompilationPanelSize] = useState(3);
  const [outputPanelManuallyResized, setOutputPanelManuallyResized] = useState(false);
  const outputPanelManuallyResizedRef = useRef(false);

  // Helper function to open the output panel (via double-click on tabs)
  const openOutputPanel = useCallback(
    (targetTab: OutputTabType) => {
      // Mark as manually resized FIRST before showing panel (update both state and ref)
      outputPanelManuallyResizedRef.current = true;
      setOutputPanelManuallyResized(true);
      setShowCompilationOutput(true);
      setParserPanelDismissed(false);
      setActiveOutputTab(targetTab);

      // Resize panel to 50% directly without triggering compilationPanelSize state
      // This prevents the auto-sizing useEffect from interfering
      requestAnimationFrame(() => {
        if (
          outputPanelRef.current &&
          typeof outputPanelRef.current.resize === "function"
        ) {
          outputPanelRef.current.resize(50);
          // Update state after to reflect the manual size
          setCompilationPanelSize(50);
        }
      });
    },
    [setShowCompilationOutput, setParserPanelDismissed, setActiveOutputTab],
  );

  useEffect(() => {
    const handler: EventListener = (ev) => {
      try {
        const custom = ev as CustomEvent<{ value?: unknown }>;
        const newValue = Boolean(custom?.detail?.value);
        setShowCompilationOutput(newValue);
        // Reset manual resize flag when toggling panel visibility (update both ref and state)
        outputPanelManuallyResizedRef.current = false;
        setOutputPanelManuallyResized(false);
        // Persist to localStorage
        try {
          globalThis.localStorage.setItem(
            "unoShowCompileOutput",
            newValue ? "1" : "0",
          );
        } catch {
          // localStorage may be unavailable (private browsing, etc.)
        }
      } catch {
        // ignore
      }
    };
    document.addEventListener("showCompileOutputChange", handler);
    return () => document.removeEventListener("showCompileOutputChange", handler);
  }, [setShowCompilationOutput]);

  useEffect(() => {
    const handler: EventListener = (ev) => {
      try {
        const custom = ev as CustomEvent<{ tab?: "compiler" | "messages" | "registry" | "debug" }>;
        const tab = custom?.detail?.tab;
        if (!tab) return;
        setActiveOutputTab(tab);
        setShowCompilationOutput(true);
      } catch {
        // ignore invalid payloads
      }
    };
    document.addEventListener("setOutputTab", handler);
    return () => document.removeEventListener("setOutputTab", handler);
  }, [setActiveOutputTab, setShowCompilationOutput]);

  // Persist showCompilationOutput state to localStorage whenever it changes
  useEffect(() => {
    try {
      globalThis.localStorage.setItem(
        "unoShowCompileOutput",
        showCompilationOutput ? "1" : "0",
      );
    } catch {
      // localStorage may be unavailable (private browsing, etc.)
    }
  }, [showCompilationOutput]);

  // Update compilation panel size based on error content and parser messages
  useEffect(() => {
    // Reset parserPanelDismissed when new errors occur (auto-reopen logic)
    if (hasCompilationErrors && cliOutput.trim().length > 0) {
      setParserPanelDismissed(false);
      setShowCompilationOutput(true);

      // Only auto-size if user hasn't manually resized
      if (!outputPanelManuallyResized) {
        // Auto-show and size panel for compiler errors
        const lines = cliOutput.split("\n").length;
        const totalChars = cliOutput.length;
        const HEADER_HEIGHT = 50;
        const PER_LINE = 20;
        const PADDING = 60;
        const AVAILABLE_HEIGHT = 800;

        const lineBasedPx =
          HEADER_HEIGHT +
          PADDING +
          Math.max(lines, Math.ceil(totalChars / 80)) * PER_LINE;
        const newSize = Math.min(
          75,
          Math.max(25, Math.ceil((lineBasedPx / AVAILABLE_HEIGHT) * 100)),
        );

        setCompilationPanelSize(newSize);
      }
    } else if (parserMessages.length > 0 && !hasCompilationErrors) {
      // Reset dismissal flag and show panel for new parser messages (auto-reopen)
      setParserPanelDismissed(false);
      setShowCompilationOutput(true);
      setActiveOutputTab("messages");

      // Only auto-size if user hasn't manually resized
      if (!outputPanelManuallyResized) {
        // Auto-show and size panel for parser messages (spec 3.2)
        const messageCount = parserMessages.length;
        const totalMessageLength = parserMessages.reduce(
          (sum, msg) => sum + (msg.message?.length || 0),
          0,
        );
        const HEADER_HEIGHT = 50;
        const PER_MESSAGE_BASE = 55;
        const PADDING = 60;
        const AVAILABLE_HEIGHT = 800;

        // SSOT formula (based on count + text length)
        const estimatedPx =
          HEADER_HEIGHT +
          PADDING +
          messageCount * PER_MESSAGE_BASE +
          Math.ceil(totalMessageLength / 100) * 15;
        const estimatedPercent = Math.min(
          75,
          Math.max(25, Math.ceil((estimatedPx / AVAILABLE_HEIGHT) * 100)),
        );

        // Measure rendered message container to ensure all containers stay visible
        const headerEl = outputTabsHeaderRef.current;
        const headerHeightPx = headerEl
          ? Math.ceil(headerEl.getBoundingClientRect().height || HEADER_HEIGHT)
          : HEADER_HEIGHT;
        let measuredPercent = estimatedPercent;

        try {
          const panelNode = headerEl?.closest("[data-panel]") as
            | HTMLElement
            | null;
          const groupNode = panelNode?.parentElement as HTMLElement | null;
          const groupHeightPx = Math.ceil(
            groupNode?.getBoundingClientRect().height || 0,
          );
          const messagesHeightPx = parserMessagesContainerRef.current
            ? Math.ceil(parserMessagesContainerRef.current.scrollHeight)
            : 0;

          if (groupHeightPx > 0) {
            const measuredPx = headerHeightPx + messagesHeightPx;
            measuredPercent = Math.min(
              75,
              Math.max(25, Math.ceil((measuredPx / groupHeightPx) * 100)),
            );
          }
        } catch {
          // Fallback to estimatedPercent
        }

        const newSize = Math.min(75, Math.max(25, Math.max(estimatedPercent, measuredPercent)));
        setCompilationPanelSize(newSize);
      }
    } else if (
      lastCompilationResult === "success" &&
      !hasCompilationErrors &&
      parserMessages.length === 0
    ) {
      // Only auto-minimize if user hasn't manually resized
      if (!outputPanelManuallyResized) {
        // Minimize panel when no errors and no messages (keep visible at 3%)
        setCompilationPanelSize(3);
      }
    }
  }, [
    cliOutput,
    hasCompilationErrors,
    lastCompilationResult,
    parserMessages.length,
    outputPanelManuallyResized,
    setParserPanelDismissed,
    setShowCompilationOutput,
    setActiveOutputTab,
  ]);

  // Apply panel size imperatively to ResizablePanel using absolute pixel floor
  const enforceOutputPanelFloor = useCallback(
    (forceResize: boolean = false) => {
      if (!showCompilationOutput) return;
      // ALWAYS skip auto-sizing if user manually resized the panel - use REF for current value (avoids stale closure)
      if (outputPanelManuallyResizedRef.current) return;
      const headerEl = outputTabsHeaderRef.current;
      const panelHandle = outputPanelRef.current;
      if (!headerEl || !panelHandle) return;

      const panelNode = headerEl.closest<HTMLElement>("[data-panel]");
      const groupNode = panelNode?.parentElement as HTMLElement | null;
      if (!panelNode || !groupNode) return;

      const headerRect = headerEl.getBoundingClientRect();
      const headerHeight = Math.ceil(headerRect.height);
      const groupHeight = Math.ceil(groupNode.getBoundingClientRect().height);
      if (!groupHeight || headerHeight <= 0) return;

      // Enforce absolute minimum height (px) equal to the header height (plus 0 gap target).
      // The panel is the bottom panel; keeping it at header height keeps the header near the bottom edge.
      const absoluteMinPx = headerHeight;
      const currentMinPx = Number.parseInt(panelNode.style.minHeight || "0", 10);
      if (Number.isNaN(currentMinPx) || currentMinPx !== absoluteMinPx) {
        panelNode.style.minHeight = `${absoluteMinPx}px`;
      }

      // Convert absolute floor to percentage only for library API calls
      const minPercent = Math.max((absoluteMinPx / groupHeight) * 100, 3);
      const targetMinPercent = Math.min(75, minPercent);

      setOutputPanelMinPercent((prev) =>
        Math.abs(prev - targetMinPercent) > 0.01 ? targetMinPercent : prev,
      );

      if (
        typeof panelHandle.getSize === "function" &&
        typeof panelHandle.resize === "function"
      ) {
        const currentSize = panelHandle.getSize();
        if (typeof currentSize === "number") {
          const target = forceResize
            ? targetMinPercent // when forced (e.g., example load), snap to computed floor
            : Math.max(currentSize, targetMinPercent);
          if (Math.abs(currentSize - target) > 0.01) {
            panelHandle.resize(target);
          }
        }
      }
    },
    [showCompilationOutput],
  );

  useEffect(() => {
    // Only auto-resize if not manually resized by user (use ref for current value)
    if (
      !outputPanelManuallyResizedRef.current &&
      outputPanelRef.current &&
      typeof outputPanelRef.current.resize === "function"
    ) {
      outputPanelRef.current.resize(compilationPanelSize);
    }
  }, [compilationPanelSize, outputPanelManuallyResized]);

  useEffect(() => {
    const handleResize = () =>
      requestAnimationFrame(() => enforceOutputPanelFloor(false)); // Don't force resize on window resize
    const handleUiScale: EventListener = () => {
      // Double rAF to ensure CSS has fully applied and DOM has re-rendered
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          enforceOutputPanelFloor(true); // Force resize on scale change
          // Additional delayed enforcement for complex layout changes
          setTimeout(() => enforceOutputPanelFloor(true), 50);
        });
      });
    };
    globalThis.addEventListener("resize", handleResize);
    globalThis.addEventListener("uiFontScaleChange", handleUiScale);
    document.addEventListener("uiFontScaleChange", handleUiScale);
    return () => {
      globalThis.removeEventListener("resize", handleResize);
      globalThis.removeEventListener("uiFontScaleChange", handleUiScale);
      document.removeEventListener("uiFontScaleChange", handleUiScale);
    };
  }, [enforceOutputPanelFloor]);

  // ResizeObserver to continuously enforce floor when panel group size changes (e.g., when dragging divider)
  useEffect(() => {
    if (!showCompilationOutput) return;

    const headerEl = outputTabsHeaderRef.current;
    const panelNode = headerEl?.closest<HTMLElement>("[data-panel]");
    const groupNode = panelNode?.parentElement as HTMLElement | null;

    if (!groupNode) return;

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => enforceOutputPanelFloor(false)); // Don't force on group resize
    });

    observer.observe(groupNode);
    return () => observer.disconnect();
  }, [showCompilationOutput, enforceOutputPanelFloor]);

  // Initial floor enforcement on first layout
  useEffect(() => {
    // Run after first paint to ensure DOM sizes are available
    requestAnimationFrame(() => enforceOutputPanelFloor(true));
  }, [enforceOutputPanelFloor]);

  // Re-enforce output panel floor when code changes (e.g., loading new example)
  // Use iterative correction loop until gap reaches 0, same approach as ResizeObserver
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 10;

    const correctUntilFlush = () => {
      if (cancelled || attempts >= maxAttempts) return;
      attempts++;

      const headerEl = outputTabsHeaderRef.current;
      if (!headerEl) return;

      const panelNode = headerEl.closest<HTMLElement>("[data-panel]");
      const groupNode = panelNode?.parentElement as HTMLElement | null;
      if (!panelNode || !groupNode) return;

      const headerRect = headerEl.getBoundingClientRect();
      const groupRect = groupNode.getBoundingClientRect();
      const gap = Math.round(groupRect.bottom - headerRect.bottom);

      enforceOutputPanelFloor(true);

      // If gap still exists, schedule another correction
      if (gap > 1) {
        requestAnimationFrame(correctUntilFlush);
      }
    };

    // Start after a brief delay to let DOM settle
    const timeoutId = setTimeout(() => {
      requestAnimationFrame(correctUntilFlush);
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [code, enforceOutputPanelFloor]);

  const handleOnResizeOutputPanel = useCallback(() => {
    outputPanelManuallyResizedRef.current = true;
    setOutputPanelManuallyResized(true);
  }, []);

  return {
    outputPanelRef,
    outputTabsHeaderRef,
    outputPanelMinPercent,
    compilationPanelSize,
    setCompilationPanelSize,
    outputPanelManuallyResized,
    setOutputPanelManuallyResized,
    outputPanelManuallyResizedRef,
    openOutputPanel,
    enforceOutputPanelFloor,
    handleOnResizeOutputPanel,
  };
}
