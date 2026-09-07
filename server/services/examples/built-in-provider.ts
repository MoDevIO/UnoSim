import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePathWithinRoot } from "../../security/safe-paths";
import type { ExampleRecord } from "./examples-schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class BuiltInProvider {
  private snapshotPromise: Promise<ExampleRecord[]> | null = null;

  getExamples(): Promise<ExampleRecord[]> {
    this.snapshotPromise ??= this.loadExamples();
    return this.snapshotPromise;
  }

  private async loadExamples(): Promise<ExampleRecord[]> {
    const publicCandidates = [
      path.resolve(__dirname, "../../../public"),
      path.resolve(__dirname, "public"),
      path.resolve(__dirname, "../../public"),
    ];
    let publicDir = publicCandidates[0];
    for (const candidate of publicCandidates) {
      try {
        await stat(candidate);
        publicDir = candidate;
        break;
      } catch {
        // Try the next runtime layout.
      }
    }

    const examplesRoot = path.resolve(publicDir, "examples");
    const files: string[] = [];
    await this.collectFiles(examplesRoot, examplesRoot, files);
    files.sort((a, b) => a.localeCompare(b));
    const sketches = files.filter((file) => file.toLowerCase().endsWith(".ino"));

    return Promise.all(sketches.map(async (relativePath) => {
      const relativeDirectory = path.dirname(relativePath);
      const relatedHeaders = files.filter(
        (file) => path.dirname(file) === relativeDirectory && file.toLowerCase().endsWith(".h"),
      );
      const exampleFiles = [relativePath, ...relatedHeaders];
      const loadedFiles = await Promise.all(exampleFiles.map(async (file) => ({
        name: path.basename(file),
        path: file.replaceAll(path.sep, "/"),
        content: await readFile(resolvePathWithinRoot(examplesRoot, file), "utf8"),
      })));
      const name = path.basename(relativePath);
      const category = relativePath.split(path.sep)[0] ?? "Built-in";
      return {
        id: `builtin-${relativePath.replaceAll(path.sep, "-").replaceAll(/[^A-Za-z0-9_-]/g, "-").replaceAll(/-+/g, "-").replaceAll(/(?:^-|-$)/g, "")}`,
        title: name.replaceAll(/\.(?:ino|h)$/gi, "").replaceAll(/[-_]+/g, " "),
        category,
        files: loadedFiles,
        main: name,
        source: "builtin" as const,
      };
    }));
  }

  private async collectFiles(root: string, current: string, output: string[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const relative = path.relative(root, path.join(current, entry.name));
      if (entry.isDirectory()) {
        await this.collectFiles(root, path.join(current, entry.name), output);
      } else if (/\.(?:ino|h)$/i.test(entry.name)) {
        output.push(relative);
      }
    }
  }
}
