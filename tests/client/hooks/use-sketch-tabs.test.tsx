import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSketchTabs } from "../../../client/src/hooks/use-sketch-tabs";

describe("useSketchTabs", () => {
  beforeEach(() => {
    // Reset Date.now for consistent tab ID generation
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should initialize with empty tabs and no active tab", () => {
    const { result } = renderHook(() => useSketchTabs());

    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTabId).toBeNull();
  });

  it("should create a new tab and set it as active", () => {
    const { result } = renderHook(() => useSketchTabs());

    let newTabId: string;
    act(() => {
      newTabId = result.current.createTab("MySketch", "void setup() {}");
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].name).toBe("MySketch");
    expect(result.current.tabs[0].content).toBe("void setup() {}");
    expect(result.current.tabs[0].id).toBe(newTabId!);
    expect(result.current.activeTabId).toBe(newTabId!);
  });

  it("should create tab with empty content by default", () => {
    const { result } = renderHook(() => useSketchTabs());

    act(() => {
      result.current.createTab("EmptySketch");
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].content).toBe("");
  });

  it("should create multiple tabs", () => {
    const { result } = renderHook(() => useSketchTabs());

    act(() => {
      result.current.createTab("Tab1");
      result.current.createTab("Tab2");
      result.current.createTab("Tab3");
    });

    expect(result.current.tabs).toHaveLength(3);
    expect(result.current.tabs.map((t) => t.name)).toEqual(["Tab1", "Tab2", "Tab3"]);
  });

  it("should select a tab", () => {
    const { result } = renderHook(() => useSketchTabs());

    let tab1Id: string, tab2Id: string;
    act(() => {
      tab1Id = result.current.createTab("Tab1");
      tab2Id = result.current.createTab("Tab2");
    });

    // Tab2 should be active after creation
    expect(result.current.activeTabId).toBe(tab2Id!);

    act(() => {
      result.current.selectTab(tab1Id!);
    });

    expect(result.current.activeTabId).toBe(tab1Id!);
  });

  it("should update tab content", () => {
    const { result } = renderHook(() => useSketchTabs());

    let tabId: string;
    act(() => {
      tabId = result.current.createTab("Tab1", "old content");
    });

    act(() => {
      result.current.updateTab(tabId!, { content: "new content" });
    });

    expect(result.current.tabs[0].content).toBe("new content");
    expect(result.current.tabs[0].name).toBe("Tab1");
  });

  it("should update tab name", () => {
    const { result } = renderHook(() => useSketchTabs());

    let tabId: string;
    act(() => {
      tabId = result.current.createTab("OldName");
    });

    act(() => {
      result.current.updateTab(tabId!, { name: "NewName" });
    });

    expect(result.current.tabs[0].name).toBe("NewName");
  });

  it("should rename tab using renameTab", () => {
    const { result } = renderHook(() => useSketchTabs());

    let tabId: string;
    act(() => {
      tabId = result.current.createTab("Original");
    });

    act(() => {
      result.current.renameTab(tabId!, "Renamed");
    });

    expect(result.current.tabs[0].name).toBe("Renamed");
  });

  it("should delete a tab", () => {
    const { result } = renderHook(() => useSketchTabs());

    let tab1Id: string, tab2Id: string;
    act(() => {
      tab1Id = result.current.createTab("Tab1");
      tab2Id = result.current.createTab("Tab2");
    });

    expect(result.current.tabs).toHaveLength(2);

    act(() => {
      result.current.deleteTab(tab1Id!);
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].id).toBe(tab2Id!);
  });

  it("should switch to first tab when deleting active tab", () => {
    const { result } = renderHook(() => useSketchTabs());

    let tab1Id: string, tab2Id: string;
    act(() => {
      tab1Id = result.current.createTab("Tab1");
      tab2Id = result.current.createTab("Tab2");
    });

    // Tab2 is active
    expect(result.current.activeTabId).toBe(tab2Id!);

    act(() => {
      result.current.deleteTab(tab2Id!);
    });

    // Should switch to Tab1
    expect(result.current.activeTabId).toBe(tab1Id!);
    expect(result.current.tabs).toHaveLength(1);
  });

  it("should set activeTabId to null when deleting the last tab", () => {
    const { result } = renderHook(() => useSketchTabs());

    let tabId: string;
    act(() => {
      tabId = result.current.createTab("OnlyTab");
    });

    act(() => {
      result.current.deleteTab(tabId!);
    });

    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeTabId).toBeNull();
  });

  it("should not change activeTabId when deleting non-active tab", () => {
    const { result } = renderHook(() => useSketchTabs());

    let tab1Id: string, tab2Id: string, tab3Id: string;
    act(() => {
      tab1Id = result.current.createTab("Tab1");
      tab2Id = result.current.createTab("Tab2");
      tab3Id = result.current.createTab("Tab3");
    });

    // Select Tab2
    act(() => {
      result.current.selectTab(tab2Id!);
    });

    expect(result.current.activeTabId).toBe(tab2Id!);

    // Delete Tab3 (not active)
    act(() => {
      result.current.deleteTab(tab3Id!);
    });

    // Active tab should remain Tab2
    expect(result.current.activeTabId).toBe(tab2Id!);
    expect(result.current.tabs).toHaveLength(2);
  });

  it("should generate unique tab IDs", () => {
    const { result } = renderHook(() => useSketchTabs());

    const ids: string[] = [];
    act(() => {
      ids.push(result.current.createTab("Tab1"));
      vi.advanceTimersByTime(1); // Advance time slightly
      ids.push(result.current.createTab("Tab2"));
      vi.advanceTimersByTime(1);
      ids.push(result.current.createTab("Tab3"));
    });

    // All IDs should be unique
    expect(new Set(ids).size).toBe(3);
    // IDs should follow the pattern
    ids.forEach((id) => {
      expect(id).toMatch(/^tab-\d+-[a-z0-9]+$/);
    });
  });

  it("should allow setting tabs directly", () => {
    const { result } = renderHook(() => useSketchTabs());

    const customTabs = [
      { id: "custom-1", name: "Custom1", content: "content1" },
      { id: "custom-2", name: "Custom2", content: "content2" },
    ];

    act(() => {
      result.current.setTabs(customTabs);
    });

    expect(result.current.tabs).toEqual(customTabs);
  });

  it("should allow setting activeTabId directly", () => {
    const { result } = renderHook(() => useSketchTabs());

    let tabId: string;
    act(() => {
      tabId = result.current.createTab("Tab1");
      result.current.setActiveTabId("custom-id");
    });

    expect(result.current.activeTabId).toBe("custom-id");
  });

  it("should maintain callback reference stability", () => {
    const { result, rerender } = renderHook(() => useSketchTabs());

    const selectTabRef = result.current.selectTab;
    const createTabRef = result.current.createTab;
    const updateTabRef = result.current.updateTab;
    const deleteTabRef = result.current.deleteTab;
    const renameTabRef = result.current.renameTab;

    rerender();

    // useCallback should maintain references
    expect(result.current.selectTab).toBe(selectTabRef);
    expect(result.current.createTab).toBe(createTabRef);
    expect(result.current.updateTab).toBe(updateTabRef);
    
    // deleteTab depends on activeTabId, so may change
    // renameTab depends on updateTab, so should be stable
    expect(result.current.renameTab).toBe(renameTabRef);
  });

  it("should handle concurrent updates correctly", () => {
    const { result } = renderHook(() => useSketchTabs());

    let tabId: string;
    act(() => {
      tabId = result.current.createTab("Tab1", "initial");
    });

    act(() => {
      result.current.updateTab(tabId!, { content: "update1" });
      result.current.updateTab(tabId!, { name: "NewName" });
    });

    expect(result.current.tabs[0].content).toBe("update1");
    expect(result.current.tabs[0].name).toBe("NewName");
  });
});
