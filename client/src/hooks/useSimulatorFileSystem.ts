import { useCallback, useMemo } from "react";

import { useFileManager } from "@/hooks/use-file-manager";
import type { Sketch } from "@shared/schema";
import type { ToastFn } from "@/hooks/use-toast";

interface UseSimulatorFileSystemParams {
  code: string;
  setCode: (value: string) => void;
  isModified: boolean;
  setIsModified: (value: boolean) => void;
  tabs: Array<{ id: string; name: string; content: string }>;
  setTabs: (tabs: Array<{ id: string; name: string; content: string }>) => void;
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
  const handleTabClick = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) {
        setActiveTabId(tabId);
        setCode(tab.content);
        setIsModified(false);
      }
    },
    [tabs, setActiveTabId, setCode, setIsModified],
  );

  const handleTabAdd = useCallback(() => {
    const newTabId = Math.random().toString(36).slice(2, 11);
    const newTab = {
      id: newTabId,
      name: `header_${tabs.length}.h`,
      content: "",
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newTabId);
    setCode("");
    setIsModified(false);
  }, [tabs, setTabs, setActiveTabId, setCode, setIsModified]);

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
      setTabs(newTabs);

      if (activeTabId === tabId) {
        if (newTabs.length > 0) {
          const newActiveTab = newTabs.at(-1)!;
          setActiveTabId(newActiveTab.id);
          setCode(newActiveTab.content);
        } else {
          setActiveTabId(null);
          setCode("");
        }
      }
    },
    [activeTabId, tabs, setActiveTabId, setCode, setTabs, toast],
  );

  const handleTabRename = useCallback(
    (tabId: string, newName: string) => {
      setTabs(
        tabs.map((tab) => (tab.id === tabId ? { ...tab, name: newName } : tab)),
      );
    },
    [tabs, setTabs],
  );

  const handleFilesLoaded = useCallback(
    (files: Array<{ name: string; content: string }>, replaceAll: boolean) => {
      if (replaceAll) {
        onReplaceAllFiles?.();

        const inoFiles = files.filter((f) => f.name.endsWith(".ino"));
        const hFiles = files.filter((f) => f.name.endsWith(".h"));
        const orderedFiles = [...inoFiles, ...hFiles];

        const newTabs = orderedFiles.map((file) => ({
          id: Math.random().toString(36).slice(2, 11),
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
      } else {
        const newHeaderFiles = files.map((file) => ({
          id: Math.random().toString(36).slice(2, 11),
          name: file.name,
          content: file.content,
        }));
        setTabs([...tabs, ...newHeaderFiles]);
      }
    },
    [onReplaceAllFiles, tabs, setTabs, setActiveTabId, setCode, setIsModified],
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
    (filename: string, content: string) => {
      onLoadExample?.();

      const newTab = {
        id: Math.random().toString(36).slice(2, 11),
        name: filename,
        content,
      };

      setTabs([newTab]);
      setActiveTabId(newTab.id);
      setCode(content);
      setIsModified(false);
    },
    [onLoadExample, setTabs, setActiveTabId, setCode, setIsModified],
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
