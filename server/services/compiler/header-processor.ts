import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Logger } from "@shared/logger";
import { resolvePathWithinRoot } from "../../security/safe-paths";
import { resolveSourceProject } from "@shared/source-project";

const logger = new Logger("HeaderProcessor");

export interface HeaderInclude {
  name: string;
  content: string;
}

export interface HeaderProcessingResult {
  processedCode: string;
  lineOffset: number;
}

async function writeHeaderFiles(
  headers: HeaderInclude[],
  sketchDir: string,
  logWrites = false,
): Promise<void> {
  for (const header of headers) {
    const headerPath = resolvePathWithinRoot(sketchDir, header.name);
    if (logWrites) logger.debug(`Writing header: ${headerPath}`);
    await mkdir(dirname(headerPath), { recursive: true });
    await writeFile(headerPath, header.content);
  }
}

async function processProjectHeaders(
  code: string,
  headers: HeaderInclude[],
  sketchDir: string | undefined,
  entryFile: string,
): Promise<HeaderProcessingResult> {
  const files = Object.fromEntries(headers.map((header) => [header.name, header.content]));
  const resolved = resolveSourceProject({ entryFile, files: { [entryFile]: code, ...files } });
  if (sketchDir) await writeHeaderFiles(headers, sketchDir);

  const sourceLines = resolved.source.split("\n").length;
  const codeLines = code.split("\n").length;
  return {
    processedCode: resolved.source,
    lineOffset: Math.max(0, sourceLines - codeLines),
  };
}

function replaceHeaderInclude(
  code: string,
  header: HeaderInclude,
): { code: string; lineOffset: number; found: boolean } {
  const headerWithoutExt = header.name.replace(/\.[^/.]+$/, "");
  const includeVariants = [`#include "${header.name}"`, `#include "${headerWithoutExt}"`];

  for (const includeStatement of includeVariants) {
    if (!code.includes(includeStatement)) continue;

    logger.debug(`Found include for: ${header.name} (pattern: ${includeStatement})`);
    const replacement = `// --- Start of ${header.name} ---\n${header.content}\n// --- End of ${header.name} ---`;
    const escapedInclude = includeStatement.split('"')[1].replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const patternString = String.raw`#include\s*"${escapedInclude}"`;
    return {
      code: code.replaceAll(new RegExp(patternString, "g"), replacement),
      lineOffset: (replacement.match(/\n/g) || []).length,
      found: true,
    };
  }
  logger.debug(
    `Include not found for: ${header.name} (tried: ${includeVariants.join(", ")})`,
  );
  return { code, lineOffset: 0, found: false };
}

/**
 * Processes header includes by replacing #include statements with actual header content.
 * Tracks line offset for later error correction.
 * 
 * @param code - The original sketch code
 * @param headers - Array of header includes with name and content
 * @param sketchDir - Optional directory to write header files to
 * @returns Processed code and cumulative line offset
 */
export async function processHeaderIncludes(
  code: string,
  headers?: HeaderInclude[],
  sketchDir?: string,
  entryFile?: string,
): Promise<HeaderProcessingResult> {
  if (entryFile) {
    return processProjectHeaders(code, headers ?? [], sketchDir, entryFile);
  }

  let processedCode = code;
  let lineOffset = 0;

  if (!headers || headers.length === 0) {
    return { processedCode, lineOffset };
  }

  logger.debug(`Processing ${headers.length} header includes`);

  for (const header of headers) {
    const replacement = replaceHeaderInclude(processedCode, header);
    processedCode = replacement.code;
    lineOffset += replacement.lineOffset;
    if (replacement.found) {
      logger.debug(`Replaced include for: ${header.name}, line offset now: ${lineOffset}`);
    }
  }

  // Write header files to disk as separate files
  if (sketchDir) {
    logger.debug(`Writing ${headers.length} header files to ${sketchDir}`);
    await writeHeaderFiles(headers, sketchDir, true);
  }

  return { processedCode, lineOffset };
}
