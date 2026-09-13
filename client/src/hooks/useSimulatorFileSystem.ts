import { useCallback, useMemo } from "react";

import { useFileManager } from "@/hooks/use-file-manager";
import { generateUuidV4 } from "@/lib/uuid";
import type { Sketch } from "@shared/schema";
import type { ToastFn } from "@/hooks/use-toast";

type SourceFileInput = { name: string; path?: string; content: string };
type SourceTab = { id: string; name: string; path?: string; content: string };

interface UseSimulatorFileSystemParams {
  code: string;
  setCode: (value: string) => void;
  isModified: boolean;
  setIsModified: (value: boolean) => void;
  tabs: SourceTab[];
  setTabs: (tabs: SourceTab[]) => void;
  activeTabId: string | null;
  setActiveTabId: (id: string | null) => void;
  initializeDefaultSketch: (sketches: Sketch[] | undefined) => void;
  toast: ToastFn;
  onReplaceAllFiles?: () => void;
  onLoadExample?: () => void;
}

export function useSimulatorFileSystem({
  code,
  setCode,
  isModified,
  setIsModified,
  tabs,
  setTabs,
  activeTabId,
  setActiveTabId,
  initializeDefaultSketch,
  toast,
  onReplaceAllFiles,
  onLoadExample,
}: UseSimulatorFileSystemParams) {
  const syncActiveTabContent = useCallback(
    (currentTabs: SourceTab[]) => {
      if (!activeTabId) return currentTabs;
      let changed = false;
      const nextTabs = currentTabs.map((tab) => {
        if (tab.id !== activeTabId || tab.content === code) return tab;
        changed = true;
        return { ...tab, content: code };
      });
      return changed ? nextTabs : currentTabs;
    },
    [activeTabId, code],
  );

  const handleTabClick = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) {
        setTabs(syncActiveTabContent(tabs));
        setActiveTabId(tabId);
        setCode(tabId === activeTabId ? code : tab.content);
        setIsModified(false);
      }
    },
    [activeTabId, code, setActiveTabId, setCode, setIsModified, setTabs, syncActiveTabContent, tabs],
  );

  const handleTabAdd = useCallback(() => {
    const newTabId = generateUuidV4().replaceAll("-", "").slice(0, 9);
    const newTab = {
      id: newTabId,
      name: `header_${tabs.length}.h`,
      path: `header_${tabs.length}.h`,
      content: "",
    };
    setTabs([...syncActiveTabContent(tabs), newTab]);
    setActiveTabId(newTabId);
    setCode("");
    setIsModified(false);
  }, [setTabs, setActiveTabId, setCode, setIsModified, syncActiveTabContent, tabs]);

  const handleTabClose = useCallback(
    (tabId: string) => {
      if (tabId === tabs[0]?.id) {
        toast({
          title: "Cannot Delete",
          description: "The main sketch file cannot be deleted",
          variant: "destructive",
        });
        return;
      }

      const newTabs = tabs.filter((t) => t.id !== tabId);
      setTabs(syncActiveTabContent(tabs).filter((t) => t.id !== tabId));

      if (activeTabId === tabId) {
        const newActiveTab = newTabs.at(-1);
        if (newActiveTab) {
          setActiveTabId(newActiveTab.id);
          setCode(newActiveTab.content);
        } else {
          setActiveTabId(null);
          setCode("");
        }
      }
    },
    [activeTabId, setActiveTabId, setCode, setTabs, syncActiveTabContent, tabs, toast],
  );

  const handleTabRename = useCallback(
    (tabId: string, newName: string) => {
      setTabs(
        tabs.map((tab) => {
          if (tab.id !== tabId) return tab;
          const followsDisplayName = tab.path === tab.name;
          return {
            ...tab,
            name: newName,
            ...(followsDisplayName ? { path: newName } : {}),
          };
        }),
      );
    },
    [tabs, setTabs],
  );

  const handleFilesLoaded = useCallback(
    (files: SourceFileInput[], replaceAll: boolean) => {
      if (replaceAll) {
        onReplaceAllFiles?.();

        const inoFiles = files.filter((f) => f.name.endsWith(".ino"));
        const otherFiles = files.filter((f) => !f.name.endsWith(".ino"));
        const orderedFiles = [...inoFiles, ...otherFiles];

        const newTabs = orderedFiles.map((file) => ({
          id: generateUuidV4().replaceAll("-", "").slice(0, 9),
          name: file.name,
          path: file.path ?? file.name,
          content: file.content,
        }));

        setTabs(newTabs);

        const inoTab = newTabs[0];
        if (inoTab) {
          setActiveTabId(inoTab.id);
          setCode(inoTab.content);
          setIsModified(false);
        }
      } else {
        const newHeaderFiles = files.map((file) => ({
          id: generateUuidV4().replaceAll("-", "").slice(0, 9),
          name: file.name,
          path: file.path ?? file.name,
          content: file.content,
        }));
        setTabs([...syncActiveTabContent(tabs), ...newHeaderFiles]);
      }
    },
    [onReplaceAllFiles, setTabs, setActiveTabId, setCode, setIsModified, syncActiveTabContent, tabs],
  );

  const toastAdapter = useMemo(
    () => (p: { title: string; description?: string; variant?: string }) =>
      toast({
        title: p.title,
        description: p.description,
        variant: p.variant === "destructive" ? "destructive" : undefined,
      }),
    [toast],
  );

  const { fileInputRef, onLoadFiles, downloadAllFiles, handleHiddenFileInput } =
    useFileManager({
      tabs,
      onFilesLoaded: handleFilesLoaded,
      toast: toastAdapter,
    });

  const handleLoadExample = useCallback(
    (
      filesOrName: SourceFileInput[] | string,
      contentOrTitle: string,
    ) => {
      onLoadExample?.();
      const files = typeof filesOrName === "string"
        ? [{ name: filesOrName, content: contentOrTitle }]
        : filesOrName;
      handleFilesLoaded(files, true);
    },
    [handleFilesLoaded, onLoadExample],
  );

  return {
    code,
    setCode,
    isModified,
    setIsModified,
    tabs,
    activeTabId,
    initializeDefaultSketch,
    fileInputRef,
    onLoadFiles,
    downloadAllFiles,
    handleHiddenFileInput,
    handleTabClick,
    handleTabAdd,
    handleTabClose,
    handleTabRename,
    handleFilesLoaded,
    handleLoadExample,
  } as const;
}
