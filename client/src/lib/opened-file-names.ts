/**
 * Browsers number a download whose name already exists: `sketch(1).ino` (Firefox) or `sketch (1).ino`
 * (Chrome, Safari). Opened again, such a file would name its tab, and the next save would add another
 * number (`sketch(1)(1).ino`). Arduino sketch and header names never contain parentheses, so the numbers
 * are dropped when a file is opened.
 */
function withoutCopyNumbers(stem: string): string {
  let current = stem;
  for (;;) {
    const open = current.lastIndexOf("(");
    if (open <= 0 || !current.endsWith(")")) return current;
    const number = current.slice(open + 1, -1);
    if (number.length === 0 || [...number].some((char) => char < "0" || char > "9")) return current;
    const rest = current.slice(0, open);
    const stripped = rest.endsWith(" ") ? rest.slice(0, -1) : rest;
    if (stripped.length === 0) return current;
    current = stripped;
  }
}

/** The file name without the browser's copy numbers; other names stay as they are. */
export function originalFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return name;
  return `${withoutCopyNumbers(name.slice(0, dot))}${name.slice(dot)}`;
}

function renamedPath(path: string, name: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? name : `${path.slice(0, slash + 1)}${name}`;
}

/**
 * Opened files with the browser's copy numbers dropped from their names and paths. A file keeps its name
 * when the original name is taken: by another opened file, or by one of `taken` (tabs that stay open).
 */
export function withOriginalFileNames<T extends { name: string; path?: string }>(files: readonly T[], taken: readonly string[] = []): T[] {
  const originals = files.map(({ name }) => originalFileName(name));
  const count = (name: string) => originals.filter((original) => original === name).length;
  return files.map((file, index) => {
    const name = originals[index]!;
    if (name === file.name || count(name) > 1 || taken.includes(name) || files.some((other) => other !== file && other.name === name)) return file;
    return { ...file, name, ...(file.path === undefined ? {} : { path: renamedPath(file.path, name) }) };
  });
}
