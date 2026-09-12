import type { SourceProject } from "@shared/source-project";

export interface SketchTabInput { name: string; path?: string; content: string }

export interface CompileCommand {
  code: string;
  headers: Array<{ name: string; content: string }>;
}

/** Pure command builder shared by compile and compile-and-start flows. */
export function buildCompileCommand(
  project: SourceProject,
): CompileCommand;
export function buildCompileCommand(
  code: string,
  tabs: SketchTabInput[],
): CompileCommand;
export function buildCompileCommand(
  projectOrCode: SourceProject | string,
  tabs?: SketchTabInput[],
): CompileCommand {
  if (typeof projectOrCode !== "string") {
    const { entryFile, files } = projectOrCode;
    return {
      code: files[entryFile] ?? "",
      headers: Object.entries(files)
        .filter(([path]) => path !== entryFile)
        .map(([path, content]) => ({ name: path, content })),
    };
  }

  return {
    code: projectOrCode,
    headers: (tabs ?? []).slice(1).map(({ name, path, content }) => ({
      name: path ?? name,
      content,
    })),
  };
}
