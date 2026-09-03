export interface SketchTabInput { name: string; content: string }

/** Pure command builder shared by compile and compile-and-start flows. */
export function buildCompileCommand(code: string, tabs: SketchTabInput[]) {
  return { code, headers: tabs.slice(1).map(({ name, content }) => ({ name, content })) };
}
