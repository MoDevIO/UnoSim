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
    const resolved = resolveSourceProject({
      entryFile,
      files: {
        [entryFile]: code,
        ...(headers ?? []).reduce<Record<string, string>>((files, header) => {
          files[header.name] = header.content;
          return files;
        }, {}),
      },
    });
    if (sketchDir && headers) {
      for (const header of headers) {
        const headerPath = resolvePathWithinRoot(sketchDir, header.name);
        await mkdir(dirname(headerPath), { recursive: true });
        await writeFile(headerPath, header.content);
      }
    }
    const sourceLines = resolved.source.split("\n").length;
    const codeLines = code.split("\n").length;
    return {
      processedCode: resolved.source,
      lineOffset: Math.max(0, sourceLines - codeLines),
    };
  }

  let processedCode = code;
  let lineOffset = 0;

  if (!headers || headers.length === 0) {
    return { processedCode, lineOffset };
  }

  logger.debug(`Processing ${headers.length} header includes`);

  for (const header of headers) {
    // Try to find includes with both the full name (header_1.h) and without extension (header_1)
    const headerWithoutExt = header.name.replace(/\.[^/.]+$/, "");

    // Search for both variants: #include "header_1.h" and #include "header_1"
    const includeVariants = [`#include "${header.name}"`, `#include "${headerWithoutExt}"`];

    let found = false;
    for (const includeStatement of includeVariants) {
      if (processedCode.includes(includeStatement)) {
        logger.debug(`Found include for: ${header.name} (pattern: ${includeStatement})`);
        
        // Replace the #include with the actual header content
        const replacement = `// --- Start of ${header.name} ---\n${header.content}\n// --- End of ${header.name} ---`;
        const escapedInclude = includeStatement.split('"')[1].replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
        const patternString = String.raw`#include\s*"${escapedInclude}"`;
        processedCode = processedCode.replaceAll(
          new RegExp(patternString, "g"),
          replacement,
        );

        // Calculate line offset by counting newlines in replacement
        const newlinesInReplacement = (replacement.match(/\n/g) || []).length;
        lineOffset += newlinesInReplacement;

        found = true;
        logger.debug(`Replaced include for: ${header.name}, line offset now: ${lineOffset}`);
        break;
      }
    }

    if (!found) {
      logger.debug(
        `Include not found for: ${header.name} (tried: ${includeVariants.join(", ")})`,
      );
    }
  }

  // Write header files to disk as separate files
  if (sketchDir) {
    logger.debug(`Writing ${headers.length} header files to ${sketchDir}`);
    for (const header of headers) {
      const headerPath = resolvePathWithinRoot(sketchDir, header.name);
      logger.debug(`Writing header: ${headerPath}`);
      await mkdir(dirname(headerPath), { recursive: true });
      await writeFile(headerPath, header.content);
    }
  }

  return { processedCode, lineOffset };
}
