/**
 * E2E Test Utilities
 *
 * Provides a thin wrapper around SandboxRunner that offers a WebSocket-message-like
 * API (`captureMessages` / `waitForMessage`) for E2E-style integration tests.
 */

import { SandboxRunner } from '../../server/services/sandbox-runner';

export interface E2EMessage {
  type: string;
  [key: string]: unknown;
}

export interface E2ERunner {
  runSketch(options: {
    code: string;
    onOutput?: (line: string) => void;
    onTelemetry?: (metrics: any) => void;
    timeoutSec?: number;
  }): void;
  stop(): Promise<void>;
}

export interface TestEnvironment {
  runner: E2ERunner;
  /** Drain and return all messages collected since the last call. */
  captureMessages(): E2EMessage[];
  /** Wait until a message matching `type` and `predicate` appears in the queue. */
  waitForMessage(
    type: string,
    predicate: (msg: E2EMessage) => boolean,
    timeout?: number,
  ): Promise<E2EMessage>;
}

export async function setupTestEnvironment(): Promise<TestEnvironment> {
  const sandboxRunner = new SandboxRunner();
  const messageQueue: E2EMessage[] = [];

  const runner: E2ERunner = {
    runSketch(options) {
      const { onOutput, onTelemetry, ...rest } = options;

      sandboxRunner
        .runSketch({
          ...rest,
          onOutput: (line) => {
            onOutput?.(line);
          },
          onError: (_line) => {
            // errors are surfaced via compilation_status
          },
          onExit: (_code) => {
            // not needed for E2E assertions
          },
          onCompileSuccess: () => {
            messageQueue.push({ type: 'compilation_status', gccStatus: 'success' });
          },
          onCompileError: (error) => {
            messageQueue.push({ type: 'compilation_status', gccStatus: 'error', error });
          },
          onTelemetry: (metrics) => {
            messageQueue.push({ type: 'sim_telemetry', metrics });
            onTelemetry?.(metrics);
          },
        })
        .catch(() => {
          // swallow — test assertions on the message queue handle failures
        });
    },

    stop() {
      return sandboxRunner.stop();
    },
  };

  function captureMessages(): E2EMessage[] {
    return messageQueue.splice(0);
  }

  async function waitForMessage(
    type: string,
    predicate: (msg: E2EMessage) => boolean,
    timeout = 5000,
  ): Promise<E2EMessage> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const msg = messageQueue.find((m) => m.type === type && predicate(m));
      if (msg) return msg;
      await new Promise((r) => setTimeout(r, 50));
    }

    throw new Error(
      `Timeout waiting for message type "${type}" after ${timeout}ms`,
    );
  }

  return { runner, captureMessages, waitForMessage };
}
