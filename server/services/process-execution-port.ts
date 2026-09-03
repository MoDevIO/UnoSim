import { ProcessExecutor } from "./process-executor";

export type ProcessExecution = Pick<ProcessExecutor, "execute">;
export function createProcessExecutionPort(): ProcessExecution { return new ProcessExecutor(); }
