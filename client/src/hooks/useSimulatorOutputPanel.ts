import { useCallback } from "react";
import { useOutputPanel } from "@/hooks/use-output-panel";
import type { ParserMessage } from "@shared/schema";

interface UseSimulatorOutputPanelProps {
  hasCompilationErrors: boolean;
  cliOutput: string;
  parserMessages: ParserMessage[];
  lastCompilationResult: string | null;
  parserMessagesContainerRef: React.RefObject<HTMLDivElement>;
  showCompilationOutput: boolean;
  setShowCompilationOutput: (show: boolean | ((prev: boolean) => boolean)) => void;
  setParserPanelDismissed: (dismissed: boolean) => void;
  setActiveOutputTab: (tab: "compiler" | "messages" | "registry" | "debug") => void;
  code: string;
}

export function useSimulatorOutputPanel({
  hasCompilationErrors,
  cliOutput,
  parserMessages,
  lastCompilationResult,
  parserMessagesContainerRef,
  showCompilationOutput,
  setShowCompilationOutput,
  setParserPanelDismissed,
  setActiveOutputTab,
  code,
}: UseSimulatorOutputPanelProps) {
  const compilationState: "success" | "error" | null =
    lastCompilationResult === "success" || lastCompilationResult === "error"
      ? lastCompilationResult
      : null;
  const {
    outputPanelRef,
    outputTabsHeaderRef,
    compilationPanelSize,
    setCompilationPanelSize,
    outputPanelMinPercent,
    outputPanelManuallyResizedRef,
    openOutputPanel,
  } = useOutputPanel(
    hasCompilationErrors,
    cliOutput,
    parserMessages,
    compilationState,
    parserMessagesContainerRef,
    showCompilationOutput,
    setShowCompilationOutput,
    setParserPanelDismissed,
    setActiveOutputTab,
    code,
  );

  const handleOutputTabChange = useCallback(
    (v: "compiler" | "messages" | "registry" | "debug") => {
      setActiveOutputTab(v);
    },
    [setActiveOutputTab],
  );

  const handleOutputCloseOrMinimize = useCallback(() => {
    const currentSize = outputPanelRef.current?.getSize?.() ?? 0;
    const isMinimized = currentSize <= outputPanelMinPercent + 1;

    if (isMinimized) {
      setShowCompilationOutput(false);
      setParserPanelDismissed(true);
      outputPanelManuallyResizedRef.current = false;
    } else {
      setCompilationPanelSize(3);
      outputPanelManuallyResizedRef.current = false;
      if (outputPanelRef.current?.resize) {
        outputPanelRef.current.resize(outputPanelMinPercent);
      }
    }
  }, [
    outputPanelMinPercent,
    setShowCompilationOutput,
    setParserPanelDismissed,
    setCompilationPanelSize,
  ]);

  const handleParserMessagesClear = useCallback(
    () => setParserPanelDismissed(true),
    [setParserPanelDismissed],
  );

  const handleParserGoToLine = useCallback((line: number) => {
    // Handled by editor ref logic in parent
    console.debug(`Go to line: ${line}`);
  }, []);

  const handleRegistryClear = useCallback(() => {
    // No-op for now
  }, []);

  return {
    outputPanelRef,
    outputTabsHeaderRef,
    compilationPanelSize,
    setCompilationPanelSize,
    outputPanelMinPercent,
    outputPanelManuallyResizedRef,
    openOutputPanel,
    handleOutputTabChange,
    handleOutputCloseOrMinimize,
    handleParserMessagesClear,
    handleParserGoToLine,
    handleRegistryClear,
  };
}
