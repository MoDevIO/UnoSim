import { WebSocket } from "ws";
import { WSMessageType } from "@shared/schema";
import type { Logger } from "@shared/logger";
import type { SandboxRunner } from "../../services/sandbox-runner";
import type { SandboxRunnerPool } from "../../services/sandbox-runner-pool";
import { WsSessionLifecycle } from "../../services/ws-session-lifecycle";
import { sendMessageToClient } from "./ws-output-buffer";

export type ClientState = {
  subject: string;
  runner: SandboxRunner | null;
  isRunning: boolean;
  isPaused: boolean;
  testRunId?: string;
  queueAbortController: AbortController | null;
};

interface WsSessionManagerParams {
  pool: SandboxRunnerPool;
  logger: Logger;
}

export class WsSessionManager {
  private readonly clientRunners = new WsSessionLifecycle<WebSocket, ClientState>();

  constructor(private readonly params: WsSessionManagerParams) {}

  register(ws: WebSocket, state: ClientState): void {
    this.clientRunners.register(ws, state);
  }

  get(ws: WebSocket): ClientState | undefined {
    return this.clientRunners.get(ws);
  }

  remove(ws: WebSocket): ClientState | undefined {
    return this.clientRunners.remove(ws);
  }

  entries(): IterableIterator<[WebSocket, ClientState]> {
    return this.clientRunners.entries();
  }

  get size(): number {
    return this.clientRunners.size;
  }

  countRunningClients(): number {
    let count = 0;
    for (const state of this.clientRunners.values()) {
      if (state.isRunning) count++;
    }
    return count;
  }

  broadcastWorkerTotal(excludeWs?: WebSocket): void {
    const newTotal = this.countRunningClients();
    for (const [otherWs, otherState] of this.clientRunners.entries()) {
      if (otherWs !== excludeWs && otherState.isRunning) {
        sendMessageToClient(otherWs, {
          type: WSMessageType.COMPILATION_STATUS,
          workerTotal: newTotal,
        });
      }
    }
  }

  async safeReleaseRunner(state: ClientState, reason: string): Promise<void> {
    if (!state.runner) {
      return;
    }

    const runner = state.runner;
    state.runner = null;
    const wasRunning = state.isRunning;
    state.isRunning = false;
    state.isPaused = false;

    if (wasRunning) {
      this.broadcastWorkerTotal();
    }

    try {
      await runner.stop();
    } catch (error) {
      this.params.logger.debug(
        `[SandboxRunnerPool] runner.stop() failed during ${reason}: ${error}`,
      );
    }

    try {
      await this.params.pool.releaseRunner(runner);
    } catch (error) {
      this.params.logger.warn(
        `[SandboxRunnerPool] releaseRunner failed during ${reason}: ${error}`,
      );
    }
  }

  abortQueuedAcquire(state: ClientState): void {
    if (state.queueAbortController) {
      state.queueAbortController.abort();
      state.queueAbortController = null;
    }
  }

  async cleanupClient(ws: WebSocket, reason: string): Promise<void> {
    const clientState = this.get(ws);
    if (clientState) {
      this.abortQueuedAcquire(clientState);
      if (clientState.runner) {
        await this.safeReleaseRunner(clientState, reason);
      }
    }

    this.remove(ws);
    this.broadcastWorkerTotal();
  }
}
