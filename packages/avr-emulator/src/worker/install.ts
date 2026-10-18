import { type RuntimeClock, systemClock } from "../runtime/clock";
import { WorkerHost } from "./host";

/** The part of a Web Worker global scope the host needs (the package is built without DOM types). */
export interface WorkerScopeLike {
  postMessage(message: unknown, transfer?: unknown[]): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
}

/** Connects a {@link WorkerHost} to a worker scope: messages in, events out. */
export function installWorker(scope: WorkerScopeLike, clock: RuntimeClock = systemClock()): WorkerHost {
  const host = new WorkerHost({ clock, post: (event) => scope.postMessage(event) });
  scope.addEventListener("message", (event) => host.handleMessage(event.data));
  return host;
}
