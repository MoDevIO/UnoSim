import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_WORKSPACE_COLUMN_SIZES,
  DEFAULT_EXPERIMENTAL_WORKSPACE_LAYOUT,
  EXPERIMENTAL_WORKSPACE_COLUMNS_KEY,
  EXPERIMENTAL_WORKSPACE_LAYOUT_CHANGE_EVENT,
  EXPERIMENTAL_WORKSPACE_LAYOUT_KEY,
  getVisibleWorkspaceColumns,
  parseWorkspaceColumnVisibility,
  type WorkspaceColumn,
  type WorkspaceColumnSizes,
  type WorkspaceColumnVisibility,
} from "@/lib/experimental-workspace-layout";

function readEnabled(): boolean {
  try {
    return globalThis.localStorage.getItem(EXPERIMENTAL_WORKSPACE_LAYOUT_KEY) === "1";
  } catch {
    return DEFAULT_EXPERIMENTAL_WORKSPACE_LAYOUT;
  }
}

function readVisibility(): WorkspaceColumnVisibility {
  try {
    return parseWorkspaceColumnVisibility(
      globalThis.localStorage.getItem(EXPERIMENTAL_WORKSPACE_COLUMNS_KEY),
    );
  } catch {
    return parseWorkspaceColumnVisibility(null);
  }
}

export function useExperimentalWorkspaceLayout() {
  const [enabled, setEnabled] = useState(readEnabled);
  const [visibility, setVisibility] = useState<WorkspaceColumnVisibility>(readVisibility);
  const [sizes, setSizes] = useState<WorkspaceColumnSizes>({
    ...DEFAULT_WORKSPACE_COLUMN_SIZES,
  });

  useEffect(() => {
    const onChange = (event: Event) => {
      const value = (event as CustomEvent<{ value?: boolean }>).detail?.value;
      if (typeof value === "boolean") setEnabled(value);
    };
    globalThis.addEventListener(EXPERIMENTAL_WORKSPACE_LAYOUT_CHANGE_EVENT, onChange);
    return () => globalThis.removeEventListener(EXPERIMENTAL_WORKSPACE_LAYOUT_CHANGE_EVENT, onChange);
  }, []);

  const setExperimentalEnabled = useCallback((value: boolean) => {
    try {
      globalThis.localStorage.setItem(EXPERIMENTAL_WORKSPACE_LAYOUT_KEY, value ? "1" : "0");
    } catch {}
    setEnabled(value);
  }, []);

  const setColumnVisible = useCallback((column: WorkspaceColumn, value: boolean) => {
    setVisibility((current) => {
      const next = { ...current, [column]: value };
      try {
        globalThis.localStorage.setItem(EXPERIMENTAL_WORKSPACE_COLUMNS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const restoreDefaultLayout = useCallback(() => {
    const next = { code: true, simulation: true, tutor: false } satisfies WorkspaceColumnVisibility;
    setVisibility(next);
    try {
      globalThis.localStorage.setItem(EXPERIMENTAL_WORKSPACE_COLUMNS_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const visibleColumns = useMemo(() => getVisibleWorkspaceColumns(visibility), [visibility]);

  return {
    enabled,
    setExperimentalEnabled,
    visibility,
    setColumnVisible,
    restoreDefaultLayout,
    visibleColumns,
    sizes,
    setSizes,
  };
}
