import { WebSocket } from "ws";
import { WSMessageType } from "@shared/schema";
import type { Logger } from "@shared/logger";
import type { SandboxRunner } from "../../services/sandbox-runner";
import type { SandboxRunnerPool } from "../../services/sandbox-runner-pool";
import { WsSessionLifecycle } from "../../services/ws-session-lifecycle";
import { sendMessageToClient } from "./ws-output-buffer";
import { webSocketMetricsTracker } from "../../services/server-metrics";
import type {
  SimulationAdmissionController,
  SimulationReservation,
} from "../../services/simulation-admission-controller";

export type ClientState = {
  subject: string;
  runner: SandboxRunner | null;
  isRunning: boolean;
  isPaused: boolean;
  testRunId?: string;
  queueAbortController: AbortController | null;
  reservation: SimulationReservation | null;
  metricsState?: "running" | "paused" | null;
  /**
   * In-flight release of this connection's lifecycle. Its reservation is
   * already detached from the state, but runner and admission are not yet
   * returned; a new start on this connection waits for it.
   */
  releasing?: Promise<void> | null;
  /** Incremented by stop, code change and disconnect to cancel waiting starts. */
  startGeneration?: number;
  closed?: boolean;
};

/**
 * A connection owns at most one simulation lifecycle: from admission until its
 * release has returned runner and admission. Separate connections of the same
 * subject remain independent (bounded by the per-subject admission limit).
 */
export function hasSimulationLifecycle(state: ClientState): boolean {
  return Boolean(
    state.reservation || state.runner || state.queueAbortController || state.releasing,
  );
}

interface WsSessionManagerParams {
  pool: SandboxRunnerPool;
  logger: Logger;
  admissionController?: Pick<SimulationAdmissionController, "release">;
}

export class WsSessionManager {
  private readonly clientRunners = new WsSessionLifecycle<WebSocket, ClientState>();

  constructor(private readonly params: WsSessionManagerParams) {}

  register(ws: WebSocket, state: ClientState): void {
    state.metricsState ??= null;
    webSocketMetricsTracker.onConnection();
    this.clientRunners.register(ws, state);
  }

  markSessionRunning(state: ClientState): void {
    if (state.metricsState === "running") return;
    state.isRunning = true;
    state.isPaused = false;
    webSocketMetricsTracker.onSessionStart();
    state.metricsState = "running";
  }

  markSessionPaused(state: ClientState): void {
    if (state.metricsState !== "running") return;
    state.isRunning = true;
    state.isPaused = true;
    webSocketMetricsTracker.onSessionPause();
    state.metricsState = "paused";
  }

  markSessionStopped(state: ClientState): void {
    if (state.metricsState === null || state.metricsState === undefined) return;
    state.isRunning = false;
    state.isPaused = false;
    webSocketMetricsTracker.onSessionStop(state.metricsState);
    state.metricsState = null;
  }

  get(ws: WebSocket): ClientState | undefined {
    return this.clientRunners.get(ws);
  }

  remove(ws: WebSocket): ClientState | undefined {
    const state = this.clientRunners.remove(ws);
    if (state) {
      webSocketMetricsTracker.onDisconnection();
    }
    return state;
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

  /**
   * Ends the connection's current lifecycle. The reservation is detached
   * synchronously, so every async continuation of the old run sees that it no
   * longer owns the session; runner and admission are returned before the
   * returned promise settles. Concurrent callers join the release in flight.
   */
  safeReleaseRunner(
    state: ClientState,
    reason: string,
    expectedReservation: SimulationReservation | null = state.reservation,
  ): Promise<void> {
    if (expectedReservation && state.reservation !== expectedReservation) {
      return Promise.resolve();
    }
    if (state.releasing) return state.releasing;

    // The settled release clears itself before any waiter resumes.
    const release: Promise<void> = this.releaseLifecycle(state, reason, expectedReservation)
      .finally(() => {
        if (state.releasing === release) state.releasing = null;
      });
    state.releasing = release;
    return release;
  }

  private async releaseLifecycle(
    state: ClientState,
    reason: string,
    expectedReservation: SimulationReservation | null,
  ): Promise<void> {
    if (expectedReservation) state.reservation = null;
    const runner = state.runner;
    state.runner = null;
    const wasRunning = state.isRunning;
    state.isRunning = false;
    state.isPaused = false;

    if (state.metricsState !== null && state.metricsState !== undefined) {
      this.markSessionStopped(state);
      this.broadcastWorkerTotal();
    } else if (wasRunning) {
      // Compatibility for callers that construct legacy ClientState objects.
      webSocketMetricsTracker.onSessionStop();
      this.broadcastWorkerTotal();
    }

    if (runner) {
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

    if (expectedReservation) {
      this.params.admissionController?.release(expectedReservation);
    }
  }

  /** Cancels a start that is still waiting for this connection's previous release. */
  cancelPendingStart(state: ClientState): void {
    state.startGeneration = (state.startGeneration ?? 0) + 1;
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
      clientState.closed = true;
      this.cancelPendingStart(clientState);
      this.abortQueuedAcquire(clientState);
      if (clientState.runner || clientState.reservation) {
        await this.safeReleaseRunner(clientState, reason);
      }
    }

    this.remove(ws);
    this.broadcastWorkerTotal();
  }
}
