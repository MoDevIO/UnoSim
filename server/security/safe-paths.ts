import { relative, resolve } from "node:path";

/**
 * Resolve a path below a known root and reject any target outside that root.
 * This is defense in depth for values that have already passed a filename
 * schema: validation can regress, but filesystem confinement must not.
 */
export function resolvePathWithinRoot(root: string, ...segments: string[]): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, ...segments);
  const pathFromRoot = relative(resolvedRoot, target);
  if (
    pathFromRoot === "" ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${String.fromCodePoint(47)}`) ||
    pathFromRoot.startsWith(`..${String.fromCodePoint(92)}`)
  ) {
    throw new Error("Resolved path escapes its allowed root");
  }
  return target;
}
