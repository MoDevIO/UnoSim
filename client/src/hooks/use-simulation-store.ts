import { useSyncExternalStore } from "react";

type PinMode = "INPUT" | "OUTPUT" | "INPUT_PULLUP";
export type PinStateType = "mode" | "value" | "pwm";

export interface PinState {
  pin: number;
  mode: PinMode;
  value: number; // analog: 0-1023, pwm: 0-255, digital: 0 or 1
  type: "digital" | "analog" | "pwm";
}

export interface BatchStats {
  lastBatchMs: number;
  lastBatchSize: number;
  lastFrameAt: number;
}

interface SimulationStateSnapshot {
  pinStates: PinState[];
  batchStats: BatchStats;
}

interface PinEvent {
  pin: number;
  stateType: PinStateType;
  value: number;
}

const modeMap: Record<number, PinMode> = {
  0: "INPUT",
  1: "OUTPUT",
  2: "INPUT_PULLUP",
};

const initialSnapshot: SimulationStateSnapshot = {
  pinStates: [],
  batchStats: {
    lastBatchMs: 0,
    lastBatchSize: 0,
    lastFrameAt: 0,
  },
};

const subscribers = new Set<() => void>();
const pendingEvents = new Map<string, PinEvent>();
let snapshot: SimulationStateSnapshot = initialSnapshot;
let rafId: number | null = null;

const notify = () => {
  subscribers.forEach((fn) => fn());
};

const scheduleFlush = () => {
  if (rafId !== null) return;

  const flush = () => {
    rafId = null;
    if (pendingEvents.size === 0) return;

    const events = Array.from(pendingEvents.values());
    const start = performance.now();
    const nextStates = applyEvents(snapshot.pinStates, events);
    pendingEvents.clear();

    const end = performance.now();
    snapshot = {
      pinStates: nextStates,
      batchStats: {
        lastBatchMs: Math.max(0, end - start),
        lastBatchSize: events.length,
        lastFrameAt: Date.now(),
      },
    };

    notify();
  };

  if (typeof globalThis.window !== "undefined" && typeof globalThis.requestAnimationFrame === "function") {
    rafId = globalThis.requestAnimationFrame(flush);
  } else {
    rafId = globalThis.setTimeout(flush, 16) as unknown as number;
  }
};

const applyEvents = (current: PinState[], events: PinEvent[]): PinState[] => {
  const nextStates = current.slice();
  const indexByPin = new Map<number, number>();
  nextStates.forEach((state, index) => indexByPin.set(state.pin, index));

  for (const event of events) {
    applyEventToState(nextStates, indexByPin, event);
  }

  return nextStates;
};

const applyEventToState = (
  states: PinState[],
  indexByPin: Map<number, number>,
  event: PinEvent,
) => {
  const { pin, stateType, value } = event;
  const existingIndex = indexByPin.get(pin);

  if (existingIndex !== undefined) {
    const existing = states[existingIndex];
    if (!existing) return;

    if (stateType === "mode") {
      states[existingIndex] = {
        ...existing,
        mode: modeMap[value] || "INPUT",
        type: existing.type === "analog" ? "digital" : existing.type,
      };
    } else if (stateType === "value") {
      states[existingIndex] = {
        ...existing,
        value,
      };
    } else if (stateType === "pwm") {
      states[existingIndex] = {
        ...existing,
        value,
        type: "pwm",
      };
    }
    return;
  }

  states.push({
    pin,
    mode: stateType === "mode" ? modeMap[value] || "INPUT" : "OUTPUT",
    value: stateType === "value" || stateType === "pwm" ? value : 0,
    type:
      stateType === "pwm"
        ? "pwm"
        : pin >= 14 && pin <= 19
          ? "analog"
          : "digital",
  });
  indexByPin.set(pin, states.length - 1);
};

const setPinStates = (updater: PinState[] | ((prev: PinState[]) => PinState[])) => {
  const nextStates =
    typeof updater === "function" ? updater(snapshot.pinStates) : updater;
  snapshot = {
    pinStates: nextStates,
    batchStats: {
      ...snapshot.batchStats,
      lastBatchMs: 0,
      lastBatchSize: 0,
      lastFrameAt: Date.now(),
    },
  };
  notify();
};

const resetPinStates = () => {
  snapshot = {
    pinStates: [],
    batchStats: {
      ...snapshot.batchStats,
      lastBatchMs: 0,
      lastBatchSize: 0,
      lastFrameAt: Date.now(),
    },
  };
  notify();
};

const enqueuePinEvent = (pin: number, stateType: PinStateType, value: number) => {
  const key = `${pin}:${stateType}`;
  pendingEvents.set(key, { pin, stateType, value });
  scheduleFlush();
};

const getSnapshot = (): SimulationStateSnapshot => snapshot;

const subscribe = (callback: () => void) => {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
};

const simulationStore = {
  subscribe,
  getSnapshot,
  setPinStates,
  resetPinStates,
  enqueuePinEvent,
  resetToInitial: () => {
    // IMPORTANT: Only clear pending events and RAF, preserve loaded pin states
    // Pin states from WebSocket should persist between tests
    // Only pending/unprocessed events should be cleared
    pendingEvents.clear();
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    // DONT reset snapshot - preserve loaded pin states from WebSocket
    notify();
  },
  /**
   * Hard reset for complete state wipe (rarely needed)
   */
  resetToEmpty: () => {
    snapshot = JSON.parse(JSON.stringify(initialSnapshot));
    pendingEvents.clear();
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    notify();
  },
};

// DEBUG: Export for E2E tests to inspect and reset store state
if (typeof globalThis.window !== "undefined") {
  (globalThis as any).__SIM_DEBUG__ = {
    getState: () => snapshot,
    resetToInitial: () => {
      simulationStore.resetToInitial();
    },
    /**
     * Reset all stores to initial state (for test isolation)
     * Call this from E2E tests before each test to ensure clean state
     */
    resetAllStores: async () => {
      // Reset simulation store
      simulationStore.resetToInitial();
      
      // Reset telemetry store (lazy import to avoid circular dependencies)
      try {
        const { telemetryStore } = await import('./use-telemetry-store');
        telemetryStore.resetToInitial();
      } catch (err) {
        console.warn('[SIM_DEBUG] Could not reset telemetry store:', err);
      }
    },
  };
}

export const useSimulationStore = () => {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    pinStates: state.pinStates,
    batchStats: state.batchStats,
    setPinStates,
    resetPinStates,
    enqueuePinEvent,
  };
};
