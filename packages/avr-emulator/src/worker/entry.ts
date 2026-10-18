/**
 * Worker entry point, imported as `@unosim/avr-emulator/worker` from a Web
 * Worker module: it starts the host on the worker's global scope.
 */
import { type WorkerScopeLike, installWorker } from "./install";

installWorker(globalThis as unknown as WorkerScopeLike);
