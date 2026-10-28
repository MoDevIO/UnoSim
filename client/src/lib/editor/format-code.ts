/** "Format Code" of the editor: one brace per line, 2-space indentation, one blank line at most, final newline. */
export function formatCode(code: string): string {
  let formatted = code;

  // 1. Normalize line endings
  formatted = formatted.replaceAll('\r\n', '\n');

  // 2. Add newlines after opening braces
  formatted = formatted.replaceAll(/\{\s*/g, "{\n");

  // 3. Add newlines before closing braces
  formatted = formatted.replaceAll(/[ \t\n\r]*\}/g, "\n}"); // NOSONAR S2631

  // 4. Indent blocks (simple 2-space indentation)
  const lines = formatted.split("\n");
  let indentLevel = 0;
  const indentedLines = lines.map((line) => {
    const trimmed = line.trim();

    // Decrease indent for closing braces
    if (trimmed.startsWith("}")) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    const indented = "  ".repeat(indentLevel) + trimmed;

    // Increase indent after opening braces
    if (trimmed.endsWith("{")) {
      indentLevel++;
    }

    return indented;
  });

  formatted = indentedLines.join("\n");

  // 5. Remove multiple consecutive blank lines
  formatted = formatted.replaceAll(/\n{3,}/g, "\n\n");

  // 6. Ensure newline at end of file
  if (!formatted.endsWith("\n")) {
    formatted += "\n";
  }

  return formatted;
}
