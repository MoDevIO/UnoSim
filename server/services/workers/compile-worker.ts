/**
 * Compilation Worker Thread
 * 
 * This worker thread receives Arduino sketch code and compiles it
 * synchronously without blocking the main thread.
 * 
 * Communication:
 * - Receives: { type: "compile", task: { code, headers?, tempRoot? } }
 * - Sends: { type: "ready" } (startup) or { result: CompilationResult | error: string } (completion)
 * 
 * IMPORTANT: This worker runs in a separate thread. The worker pool controls
 * concurrency, so we disable the per-compiler gatekeeper here.
 */

import { parentPort } from "worker_threads";
import { Logger } from "@shared/logger";

// Disable the CompileGatekeeper in worker threads since the pool controls concurrency
process.env.COMPILE_GATEKEEPER_DISABLED = "true";

const logger = new Logger("compile-worker");

// Dynamic import of ArduinoCompiler (ESM-aware)
let ArduinoCompiler: any = null;

async function initializeCompiler() {
  try {
    // Try .js first (production build), fallback to .ts (development with tsx)
    let module;
    try {
      module = await import("../arduino-compiler.js");
    } catch (jsErr) {
      // In development mode with tsx, import the .ts file directly
      module = await import("../arduino-compiler.ts");
    }
    ArduinoCompiler = module.ArduinoCompiler;
    logger.debug("[Worker] ArduinoCompiler loaded");
  } catch (err) {
    logger.error(`[Worker] Failed to load ArduinoCompiler: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

/**
 * Process incoming compilation requests
 */
async function processCompileRequest(task: any) {
  try {
    if (!ArduinoCompiler) {
      await initializeCompiler();
    }

    const compiler = new ArduinoCompiler();
    const result = await compiler.compile(task.code, task.headers, task.tempRoot);

    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[Worker] Compilation failed: ${errorMsg}`);
    throw err;
  }
}

/**
 * Main message handler
 */
if (parentPort) {
  parentPort.on("message", async (msg) => {
    try {
      if (msg.type === "compile" && msg.task) {
        const result = await processCompileRequest(msg.task);
        parentPort!.postMessage({
          type: "compile_result",
          result,
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      parentPort!.postMessage({
        type: "compile_result",
        error: errorMsg,
      });
    }
  });

  // Signal that worker is ready
  parentPort.postMessage({ type: "ready" });
  logger.debug("[Worker] Startup complete, waiting for tasks");
} else {
  logger.error("[Worker] Not running in worker_threads context");
  process.exit(1);
}
