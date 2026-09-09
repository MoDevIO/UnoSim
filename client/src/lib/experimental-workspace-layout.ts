export const EXPERIMENTAL_WORKSPACE_LAYOUT_KEY = "unoExperimentalWorkspaceLayout";
export const EXPERIMENTAL_WORKSPACE_COLUMNS_KEY = "unoExperimentalWorkspaceColumns";
export const EXPERIMENTAL_WORKSPACE_LAYOUT_CHANGE_EVENT = "experimentalWorkspaceLayoutChange";
export const DEFAULT_EXPERIMENTAL_WORKSPACE_LAYOUT = false;

export type WorkspaceColumn = "code" | "simulation" | "tutor";

export type WorkspaceColumnVisibility = Record<WorkspaceColumn, boolean>;
export type WorkspaceColumnSizes = Record<WorkspaceColumn, number>;

export const DEFAULT_WORKSPACE_COLUMN_VISIBILITY: WorkspaceColumnVisibility = {
  code: true,
  simulation: true,
  tutor: false,
};

export const DEFAULT_WORKSPACE_COLUMN_SIZES: WorkspaceColumnSizes = {
  code: 42,
  simulation: 33,
  tutor: 25,
};

export function getVisibleWorkspaceColumns(
  visibility: WorkspaceColumnVisibility,
): WorkspaceColumn[] {
  return (["code", "simulation", "tutor"] as WorkspaceColumn[]).filter(
    (column) => visibility[column],
  );
}

export function getWorkspaceResizePairs(
  columns: WorkspaceColumn[],
): Array<[WorkspaceColumn, WorkspaceColumn]> {
  return columns.slice(0, -1).map((column, index) => [column, columns[index + 1]]);
}

export function getWorkspaceDefaultSizes(
  columns: WorkspaceColumn[],
  rememberedSizes: WorkspaceColumnSizes = DEFAULT_WORKSPACE_COLUMN_SIZES,
): number[] {
  if (columns.length === 0) return [];
  if (columns.length === 1) return [100];

  const rememberedDefaults = Object.entries(DEFAULT_WORKSPACE_COLUMN_SIZES).every(
    ([column, size]) => rememberedSizes[column as WorkspaceColumn] === size,
  );
  if (columns.length === 2 && rememberedDefaults) return [50, 50];

  const defaults = DEFAULT_WORKSPACE_COLUMN_SIZES;
  const rawSizes = columns.map((column) => rememberedSizes[column] ?? defaults[column]);
  const total = rawSizes.reduce((sum, size) => sum + size, 0);
  return total > 0 ? rawSizes.map((size) => (size / total) * 100) : columns.map(() => 100 / columns.length);
}

export function parseWorkspaceColumnVisibility(value: string | null): WorkspaceColumnVisibility {
  if (!value) return { ...DEFAULT_WORKSPACE_COLUMN_VISIBILITY };
  try {
    const parsed = JSON.parse(value) as Partial<WorkspaceColumnVisibility>;
    return {
      code: parsed.code !== false,
      simulation: parsed.simulation !== false,
      tutor: parsed.tutor === true,
    };
  } catch {
    return { ...DEFAULT_WORKSPACE_COLUMN_VISIBILITY };
  }
}
