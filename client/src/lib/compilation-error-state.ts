export type OutputTab = "compiler" | "messages" | "registry" | "debug" | "stats";

export interface GccCompilationErrorState {
  cliOutput: string;
  hasCompilationErrors: true;
  lastCompilationResult: "error";
  showCompilationOutput: true;
  parserPanelDismissed: false;
  activeOutputTab: "compiler";
}

export const buildGccCompilationErrorState = (
  messageData: string | null | undefined,
): GccCompilationErrorState => {
  const details = typeof messageData === "string" ? messageData : "";
  const prefix = "\u274C GCC Compilation Error:";
  const cliOutput = details ? `${prefix}\n\n${details}` : prefix;

  return {
    cliOutput,
    hasCompilationErrors: true,
    lastCompilationResult: "error",
    showCompilationOutput: true,
    parserPanelDismissed: false,
    activeOutputTab: "compiler",
  };
};
