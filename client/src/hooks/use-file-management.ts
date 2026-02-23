import { useCallback, useEffect, useRef } from "react";
import { useFileManager, FileEntry } from "./use-file-manager";
import type { IOPinRecord, Sketch } from "@shared/schema";

// Note: we re-use the Sketch type from shared schema; the page already
// fetches sketches via react-query using that same interface.
export interface UseFileManagementParams {
  // current tab state (needed by downloadAllFiles)
  tabs: Array<{ id: string; name: string; content: string }>;
  toast?: (params: { title: string; description?: string; variant?: string }) => void;

  // sketch data from server (optional)
  sketches?: Sketch[];

  // simulation / UI state setters that the file manager needs to reset
  simulationStatus: string;
  sendMessage: (msg: any) => void;
  setTabs: React.Dispatch<React.SetStateAction<Array<{ id: string; name: string; content: string }>>>;
  setActiveTabId: React.Dispatch<React.SetStateAction<string | null>>;
  setCode: React.Dispatch<React.SetStateAction<string>>;
  setIsModified: React.Dispatch<React.SetStateAction<boolean>>;

  clearOutputs: () => void;
  resetPinUI: (opts?: { keepDetected?: boolean }) => void;
  setCompilationStatus: React.Dispatch<React.SetStateAction<any>>;
  setArduinoCliStatus: React.Dispatch<React.SetStateAction<any>>;
  setLastCompilationResult: React.Dispatch<React.SetStateAction<"success" | "error" | null>>;
  setSimulationStatus: React.Dispatch<React.SetStateAction<any>>;
  setHasCompiledOnce: React.Dispatch<React.SetStateAction<boolean>>;
  setCompilationPanelSize: React.Dispatch<React.SetStateAction<number>>;
  setActiveOutputTab: React.Dispatch<React.SetStateAction<"compiler" | "messages" | "registry" | "debug">>;
  setIoRegistry: React.Dispatch<React.SetStateAction<IOPinRecord[]>>;
  setParserPanelDismissed: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useFileManagement(params: UseFileManagementParams) {
  const {
    tabs,
    toast,
    sketches,
    simulationStatus,
    sendMessage,
    setTabs,
    setActiveTabId,
    setCode,
    setIsModified,
    clearOutputs,
    resetPinUI,
    setCompilationStatus,
    setArduinoCliStatus,
    setLastCompilationResult,
    setSimulationStatus,
    setHasCompiledOnce,
    setCompilationPanelSize,
    setActiveOutputTab,
    setIoRegistry,
    setParserPanelDismissed,
  } = params;

  const hasLoadedDefault = useRef(false);

  // When sketches list arrives we obey the original page logic and
  // initialize the editor with the first sketch. Only do this once.
  useEffect(() => {
    if (sketches && sketches.length > 0 && !hasLoadedDefault.current) {
      hasLoadedDefault.current = true;
      const defaultSketch = sketches[0];
      setCode(defaultSketch.content);

      const defaultTabId = "default-sketch";
      setTabs([
        {
          id: defaultTabId,
          name: "sketch.ino",
          content: defaultSketch.content,
        },
      ]);
      setActiveTabId(defaultTabId);
    }
  }, [sketches, setCode, setTabs, setActiveTabId]);

  const handleFilesLoaded = useCallback(
    (files: FileEntry[], replaceAll: boolean) => {
      if (replaceAll) {
        if (simulationStatus === "running") {
          sendMessage({ type: "stop_simulation" });
        }

        const inoFiles = files.filter((f) => f.name.endsWith(".ino"));
        const hFiles = files.filter((f) => f.name.endsWith(".h"));

        const orderedFiles = [...inoFiles, ...hFiles];

        const newTabs = orderedFiles.map((file) => ({
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          content: file.content,
        }));

        setTabs(newTabs);

        const inoTab = newTabs[0];
        if (inoTab) {
          setActiveTabId(inoTab.id);
          setCode(inoTab.content);
          setIsModified(false);
        }

        clearOutputs();
        resetPinUI();
        setCompilationStatus("ready");
        setArduinoCliStatus("idle");
        setLastCompilationResult(null);
        setSimulationStatus("stopped");
        setHasCompiledOnce(false);
      } else {
        const newHeaderFiles = files.map((file) => ({
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          content: file.content,
        }));

        setTabs((prev) => [...prev, ...newHeaderFiles]);
      }
    },
    [
      simulationStatus,
      sendMessage,
      setTabs,
      setActiveTabId,
      setCode,
      setIsModified,
      clearOutputs,
      resetPinUI,
      setCompilationStatus,
      setArduinoCliStatus,
      setLastCompilationResult,
      setSimulationStatus,
      setHasCompiledOnce,
    ],
  );

  const handleLoadExample = useCallback(
    (filename: string, content: string) => {
      if (simulationStatus === "running") {
        sendMessage({ type: "stop_simulation" });
      }

      const newTab = {
        id: Math.random().toString(36).substr(2, 9),
        name: filename,
        content: content,
      };

      setTabs([newTab]);
      setActiveTabId(newTab.id);
      setCode(content);
      setIsModified(false);
      setCompilationPanelSize(3);
      setActiveOutputTab("compiler");

      clearOutputs();
      setIoRegistry(() => {
        const pins: IOPinRecord[] = [];
        for (let i = 0; i <= 13; i++)
          pins.push({ pin: String(i), defined: false, usedAt: [] });
        for (let i = 0; i <= 5; i++)
          pins.push({ pin: `A${i}`, defined: false, usedAt: [] });
        return pins;
      });
      setCompilationStatus("ready");
      setArduinoCliStatus("idle");
      setLastCompilationResult(null);
      setSimulationStatus("stopped");
      setHasCompiledOnce(false);
      setActiveOutputTab("compiler");
      setCompilationPanelSize(5);
      setParserPanelDismissed(false);
    },
    [
      simulationStatus,
      sendMessage,
      setTabs,
      setActiveTabId,
      setCode,
      setIsModified,
      setCompilationPanelSize,
      setActiveOutputTab,
      clearOutputs,
      setIoRegistry,
      setCompilationStatus,
      setArduinoCliStatus,
      setLastCompilationResult,
      setSimulationStatus,
      setHasCompiledOnce,
      setParserPanelDismissed,
    ],
  );

  const fm = useFileManager({ tabs, onFilesLoaded: handleFilesLoaded, toast });

  return {
    ...fm,
    handleFilesLoaded,
    handleLoadExample,
  } as const;
}
