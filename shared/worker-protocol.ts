/**
 * Worker Thread Communication Protocol
 * 
 * Defines strict types for message passing between main thread and worker threads.
 * Eliminates 'any' types and enforces type safety in the compilation worker pool.
 * 
 * Architecture:
 * - Main Thread (compilation-worker-pool.ts) sends WorkerMessage<CompileRequestPayload>
 * - Worker Thread (compile-worker.ts) sends WorkerMessage<CompileResponsePayload>
 * - Generic WorkerMessage<T> ensures type safety across all message types
 */

import type { CompilationResult } from "../server/services/arduino-compiler";

/**
 * Commands that can be sent to worker threads
 */
export enum WorkerCommand {
  COMPILE = "compile",
  READY = "ready",
  SHUTDOWN = "shutdown",
  COMPILE_RESULT = "compile_result",
}

/**
 * Compilation request payload sent from main thread to worker
 */
export interface CompileRequestPayload {
  code: string;
  headers?: Array<{ name: string; content: string }>;
  tempRoot?: string;
  fqbn?: string;
  libraries?: string[];
  sketchHash?: string;
  coreFingerprint?: string;
}

/**
 * Compilation response payload sent from worker to main thread
 */
export interface CompileResponsePayload {
  result?: CompilationResult;
  error?: WorkerError;
}

/**
 * Structured error object for worker errors
 */
export interface WorkerError {
  message: string;
  code?: string;
  stack?: string;
}

/**
 * Generic worker message envelope
 * T = payload type (CompileRequestPayload | CompileResponsePayload | void)
 */
export interface WorkerMessage<T = void> {
  type: WorkerCommand;
  taskId?: string;
  payload?: T;
}

/**
 * Specific message types for type narrowing
 */

export interface CompileRequestMessage extends WorkerMessage<CompileRequestPayload> {
  type: WorkerCommand.COMPILE;
  payload: CompileRequestPayload;
}

export interface CompileResponseMessage extends WorkerMessage<CompileResponsePayload> {
  type: WorkerCommand.COMPILE_RESULT;
  payload: CompileResponsePayload;
}

export interface ReadyMessage extends WorkerMessage<void> {
  type: WorkerCommand.READY;
}

export interface ShutdownMessage extends WorkerMessage<void> {
  type: WorkerCommand.SHUTDOWN;
}

/**
 * Union type for all possible worker messages
 */
export type AnyWorkerMessage =
  | CompileRequestMessage
  | CompileResponseMessage
  | ReadyMessage
  | ShutdownMessage;

/**
 * Type guard to check if a message is a compile request
 */
export function isCompileRequest(msg: WorkerMessage<unknown>): msg is CompileRequestMessage {
  return msg.type === WorkerCommand.COMPILE && msg.payload !== undefined;
}

/**
 * Type guard to check if a message is a compile response
 */
export function isCompileResponse(msg: WorkerMessage<unknown>): msg is CompileResponseMessage {
  return msg.type === WorkerCommand.COMPILE_RESULT && msg.payload !== undefined;
}

/**
 * Type guard to check if a message is a ready signal
 */
export function isReadyMessage(msg: WorkerMessage<unknown>): msg is ReadyMessage {
  return msg.type === WorkerCommand.READY;
}

/**
 * Type guard to check if a message is a shutdown signal
 */
export function isShutdownMessage(msg: WorkerMessage<unknown>): msg is ShutdownMessage {
  return msg.type === WorkerCommand.SHUTDOWN;
}

/**
 * Helper to create a compile request message
 */
export function createCompileRequest(
  payload: CompileRequestPayload,
  taskId?: string
): CompileRequestMessage {
  return {
    type: WorkerCommand.COMPILE,
    payload,
    taskId,
  };
}

/**
 * Helper to create a compile response message
 */
export function createCompileResponse(
  payload: CompileResponsePayload,
  taskId?: string
): CompileResponseMessage {
  return {
    type: WorkerCommand.COMPILE_RESULT,
    payload,
    taskId,
  };
}

/**
 * Helper to create a ready message
 */
export function createReadyMessage(): ReadyMessage {
  return {
    type: WorkerCommand.READY,
  };
}

/**
 * Helper to create a structured worker error
 */
export function createWorkerError(err: unknown): WorkerError {
  if (err instanceof Error) {
    return {
      message: err.message,
      code: (err as any).code,
      stack: err.stack,
    };
  }
  return {
    message: String(err),
  };
}


