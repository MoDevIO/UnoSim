import type { SourceLocation } from "@shared/source-project";

/** A parser location, with a numeric form kept for legacy single-file callers. */
export type SourceNavigationTarget = SourceLocation | number;

export function isSourceLocation(
  target: SourceNavigationTarget,
): target is SourceLocation {
  return typeof target === "object" && target !== null;
}

export function isNavigableSourceTarget(
  target: SourceNavigationTarget | undefined,
): target is SourceNavigationTarget {
  if (target === undefined) return false;
  return isSourceLocation(target) ? target.line > 0 : target > 0;
}

export function formatSourceNavigationTarget(
  target: SourceNavigationTarget,
): string {
  return isSourceLocation(target) ? `${target.file}:${target.line}` : `Line ${target}`;
}
