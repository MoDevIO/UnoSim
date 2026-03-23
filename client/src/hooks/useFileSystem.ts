/**
 * useFileSystem Hook
 *
 * Orchestrates file system operations and state management.
 * Aggregates sketch management, code editor state, and file I/O operations.
 *
 * This hook coordinates:
 * - Current sketch selection and caching
 * - Code editor content tracking
 * - Modification state (isModified flag)
 * - Integration with sketch tabs and file manager
 */

import { useState, useCallback, useEffect, Dispatch, SetStateAction } from "react";
import type { Sketch } from "@shared/schema";
import { useSketchTabs } from "./use-sketch-tabs";
import { useFileManager } from "./use-file-manager";

/**
 * File system state and operations
 */
interface FileSystemState {
  /** Currently active sketch */
  currentSketch: Sketch | null;
  /** Code content in the editor */
  code: string;
  /** Whether the current code has unsaved changes */
  isModified: boolean;
}

/**
 * File system operations
 */
interface FileSystemOperations {
  /** Set the active sketch */
  setCurrentSketch: Dispatch<SetStateAction<Sketch | null>>;
  /** Update the code content */
  setCode: Dispatch<SetStateAction<string>>;
  /** Mark code as modified or saved */
  setIsModified: Dispatch<SetStateAction<boolean>>;
  /** Initialize default sketch when available */
  initializeDefaultSketch: (sketches: Sketch[] | undefined) => void;
}

/**
 * Return type for useFileSystem hook
 */
interface UseFileSystemResult extends FileSystemState, FileSystemOperations {
  /** Access to sketch tabs management */
  tabs: ReturnType<typeof useSketchTabs>["tabs"];
  activeTabId: ReturnType<typeof useSketchTabs>["activeTabId"];
  setActiveTabId: ReturnType<typeof useSketchTabs>["setActiveTabId"];
  setTabs: ReturnType<typeof useSketchTabs>["setTabs"];
  /** Access to file manager operations */
  fileInputRef: ReturnType<typeof useFileManager>["fileInputRef"];
  onLoadFiles: ReturnType<typeof useFileManager>["onLoadFiles"];
  downloadAllFiles: ReturnType<typeof useFileManager>["downloadAllFiles"];
  handleHiddenFileInput: ReturnType<typeof useFileManager>["handleHiddenFileInput"];
}

/**
 * Parameters for useFileSystem
 */
interface UseFileSystemParams {
  /** Sketches available from the sketch tabs hook result */
  sketches: Sketch[] | undefined;
}

/**
 * Hook that manages file system state and operations.
 * Provides a unified interface for sketch management and code editing.
 *
 * @param params Configuration with available sketches
 * @returns File system state, operations, and integrated sub-hook interfaces
 */
export function useFileSystem(params: UseFileSystemParams): UseFileSystemResult {
  const [currentSketch, setCurrentSketch] = useState<Sketch | null>(null);
  const [code, setCode] = useState("");
  const [isModified, setIsModified] = useState(false);

  // Get sketch tabs management
  const { tabs, setTabs, activeTabId, setActiveTabId } = useSketchTabs();

  // Get file manager for I/O operations
  // Pass minimal required params: tabs (empty array if not available)
  const fileManager = useFileManager({
    tabs: tabs || [],
  });

  // Initialize default sketch when sketches become available
  const initializeDefaultSketch = useCallback(
    (availableSketches: Sketch[] | undefined) => {
      if (availableSketches && availableSketches.length > 0 && !currentSketch) {
        const defaultSketch = availableSketches[0];
        setCurrentSketch(defaultSketch);

        // Ensure the default sketch is visible as a tab (so the user can’t accidentally close it)
        setTabs((prevTabs) => {
          if (prevTabs.length > 0) return prevTabs;

          const tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          setActiveTabId(tabId);
          return [
            {
              id: tabId,
              name: defaultSketch.name,
              content: defaultSketch.content,
            },
          ];
        });

        if (!code && defaultSketch.content) {
          setCode(defaultSketch.content);
        }
      }
    },
    [currentSketch, code, setActiveTabId, setTabs, setCode],
  );

  // Initialize on sketch load
  useEffect(() => {
    initializeDefaultSketch(params.sketches);
  }, [params.sketches, initializeDefaultSketch]);

  return {
    // State
    currentSketch,
    code,
    isModified,
    // Operations
    setCurrentSketch,
    setCode,
    setIsModified,
    initializeDefaultSketch,
    // Sketch tabs integration
    tabs,
    activeTabId,
    setActiveTabId,
    setTabs,
    // File manager integration
    ...fileManager,
  };
}
