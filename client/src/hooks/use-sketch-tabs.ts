import { useState, useCallback } from "react";

interface SketchTab {
  id: string;
  name: string;
  content: string;
}

export function useSketchTabs() {
  const [tabs, setTabs] = useState<SketchTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const selectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  const createTab = useCallback((name: string, content: string = ""): string => {
    const newTabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const newTab: SketchTab = {
      id: newTabId,
      name,
      content,
    };
    setTabs((prevTabs) => [...prevTabs, newTab]);
    setActiveTabId(newTabId);
    return newTabId;
  }, []);

  const updateTab = useCallback((tabId: string, updates: Partial<SketchTab>) => {
    setTabs((prevTabs) =>
      prevTabs.map((tab) => (tab.id === tabId ? { ...tab, ...updates } : tab)),
    );
  }, []);

  const deleteTab = useCallback((tabId: string) => {
    setTabs((prevTabs) => {
      const newTabs = prevTabs.filter((tab) => tab.id !== tabId);
      // If we deleted the active tab, select another one
      if (activeTabId === tabId) {
        const nextTab = newTabs[0];
        setActiveTabId(nextTab ? nextTab.id : null);
      }
      return newTabs;
    });
  }, [activeTabId]);

  const renameTab = useCallback((tabId: string, newName: string) => {
    updateTab(tabId, { name: newName });
  }, [updateTab]);

  return {
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    selectTab,
    createTab,
    updateTab,
    deleteTab,
    renameTab,
  };
}
