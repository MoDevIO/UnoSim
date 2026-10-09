// Bounds for untrusted runtime output: sketch code controls stdout/stderr and can
// emit plain text and spoofed protocol markers at full speed.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ArduinoOutputParser } from "../../../server/services/arduino-output-parser";
import { RegistryManager } from "../../../server/services/registry-manager";
import { delegateParsedLineToStreamHandler } from "../../../server/services/sandbox/execution-phases/stream-phase";
import type { ExecutionState } from "../../../server/services/sandbox/execution-manager";
import {
  RUNTIME_TEXT_LIMIT_NOTICE,
  RUNTIME_TEXT_LINE_BURST,
  RUNTIME_TEXT_LINES_PER_SECOND,
  RuntimeTextLimiter,
} from "../../../server/services/sandbox/runtime-text-limiter";
import { StreamHandler } from "../../../server/services/sandbox/stream-handler";
import { Logger } from "../../../shared/logger";

afterEach(() => {
  vi.restoreAllMocks();
});

function spyOnLogs(): string[] {
  const messages: string[] = [];
  for (const level of ["debug", "info", "warn", "error"] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation((message: string) => {
      messages.push(message);
    });
  }
  return messages;
}

describe("RegistryManager bounds for spoofed registry markers", () => {
  it("sends a bounded number of registries when a sketch repeats registry cycles", () => {
    const onUpdate = vi.fn();
    const manager = new RegistryManager({ onUpdate });
    const logs = spyOnLogs();

    for (let cycle = 0; cycle < 1_000; cycle++) {
      manager.startCollection();
      manager.addPin({ pin: String(cycle % 2), defined: true, pinMode: 1, usedAt: [] });
      manager.finishCollection();
    }

    // Without a bound every cycle with changed content sent and logged a registry.
    expect(onUpdate.mock.calls.length).toBeGreaterThan(0);
    expect(onUpdate.mock.calls.length).toBeLessThanOrEqual(4);
    expect(logs.length).toBeLessThan(20);
    manager.destroy();
  });

  it("does not log every pin record received outside a collection", () => {
    const manager = new RegistryManager({ onUpdate: vi.fn() });
    const logs = spyOnLogs();

    for (let index = 0; index < 1_000; index++) {
      manager.addPin({ pin: "13", defined: true, pinMode: 1, usedAt: [] });
    }

    expect(manager.getRegistry()).toHaveLength(0);
    expect(logs.length).toBeLessThan(5);
    manager.destroy();
  });

  it("starts a fresh budget for the next run after reset", () => {
    const onUpdate = vi.fn();
    const manager = new RegistryManager({ onUpdate });
    spyOnLogs();
    for (let cycle = 0; cycle < 50; cycle++) {
      manager.startCollection();
      manager.addPin({ pin: String(cycle % 2), defined: true, pinMode: 1, usedAt: [] });
      manager.finishCollection();
    }
    manager.reset();
    onUpdate.mockClear();

    manager.startCollection();
    manager.addPin({ pin: "7", defined: true, pinMode: 1, usedAt: [] });
    manager.finishCollection();

    expect(onUpdate).toHaveBeenCalledTimes(1);
    manager.destroy();
  });
});

describe("RuntimeTextLimiter", () => {
  it("admits a burst and the sustained rate, then drops with one notice and aggregated logs", () => {
    let now = 0;
    const logger = { warn: vi.fn() };
    const limiter = new RuntimeTextLimiter({ now: () => now, logger });
    const decisions = Array.from({ length: 100_000 }, () => limiter.admit());

    expect(decisions.filter((decision) => decision === "forward")).toHaveLength(RUNTIME_TEXT_LINE_BURST);
    expect(decisions.filter((decision) => decision === "notice")).toHaveLength(1);
    expect(limiter.droppedLines).toBe(100_000 - RUNTIME_TEXT_LINE_BURST);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    now += 1_000;
    const nextSecond = Array.from({ length: 1_000 }, () => limiter.admit());
    expect(nextSecond.filter((decision) => decision === "forward")).toHaveLength(RUNTIME_TEXT_LINES_PER_SECOND);
    expect(nextSecond).not.toContain("notice");
    expect(logger.warn).toHaveBeenCalledTimes(1);

    now += 10_000;
    for (let index = 0; index < 1_000; index++) limiter.admit();
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn.mock.calls[1][0]).toContain("total");
  });
});

describe("runtime text storm through the shared stream path", () => {
  it("forwards a bounded number of lines and logs nothing per line", () => {
    const logs = spyOnLogs();
    const registryManager = new RegistryManager({ onUpdate: vi.fn() });
    const state = {
      pinStateBatcher: null,
      serialOutputBatcher: null,
      backpressurePaused: false,
      state: "running",
      baudrate: 9600,
      runtimeTextLimiter: new RuntimeTextLimiter({ now: () => 0 }),
    } as unknown as ExecutionState;
    const parser = new ArduinoOutputParser();
    const streamHandler = new StreamHandler({} as never);
    const onError = vi.fn();

    for (let index = 0; index < 100_000; index++) {
      delegateParsedLineToStreamHandler(parser.parseStderrLine("flood", 0), state, { onOutput: vi.fn(), onError, onPinState: vi.fn() }, {
        registryManager,
        streamHandler,
      });
    }

    expect(onError).toHaveBeenCalledTimes(RUNTIME_TEXT_LINE_BURST + 1);
    expect(onError).toHaveBeenLastCalledWith(RUNTIME_TEXT_LIMIT_NOTICE);
    expect(logs.length).toBeLessThan(5);
    registryManager.destroy();
  });
});
