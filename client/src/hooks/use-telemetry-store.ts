import { useSyncExternalStore } from "react";

export interface TelemetryMetrics {
  timestamp: number;
  intendedPinChangesPerSecond: number;
  actualPinChangesPerSecond: number;
  droppedPinChangesPerSecond: number;
  batchesPerSecond: number;
  avgStatesPerBatch: number;
  serialOutputPerSecond: number;
  serialBytesPerSecond: number;
  serialBytesTotal: number;  // Cumulative bytes sent since simulation start
  serialIntendedBytesPerSecond?: number;  // Bytes that sketch tried to send (optional for backward compat)
  serialDroppedBytesPerSecond?: number;   // Bytes dropped due to baudrate limit (optional for backward compat)
}

interface TelemetrySnapshot {
  history: TelemetryMetrics[];
  last: TelemetryMetrics | null;
  lastHeartbeatAt: number | null;
}

const TELEMETRY_BUFFER_SIZE = 60;

const subscribers = new Set<() => void>();

let snapshot: TelemetrySnapshot = {
  history: [],
  last: null,
  lastHeartbeatAt: null,
};

let ringBuffer: TelemetryMetrics[] = new Array(TELEMETRY_BUFFER_SIZE);
let ringIndex = 0;
let ringCount = 0;

const notify = () => {
  subscribers.forEach((fn) => fn());
};

const getHistory = (): TelemetryMetrics[] => {
  if (ringCount === 0) return [];
  const ordered: TelemetryMetrics[] = [];
  for (let i = 0; i < ringCount; i += 1) {
    const idx =
      (ringIndex - ringCount + i + TELEMETRY_BUFFER_SIZE) %
      TELEMETRY_BUFFER_SIZE;
    const entry = ringBuffer[idx];
    if (entry) ordered.push(entry);
  }
  return ordered;
};

const pushTelemetry = (metrics: TelemetryMetrics) => {
  ringBuffer[ringIndex] = metrics;
  ringIndex = (ringIndex + 1) % TELEMETRY_BUFFER_SIZE;
  ringCount = Math.min(TELEMETRY_BUFFER_SIZE, ringCount + 1);

  snapshot = {
    history: getHistory(),
    last: metrics,
    lastHeartbeatAt: metrics.timestamp,
  };

  notify();
};

const resetTelemetry = () => {
  ringBuffer = new Array(TELEMETRY_BUFFER_SIZE);
  ringIndex = 0;
  ringCount = 0;
  snapshot = {
    history: [],
    last: null,
    lastHeartbeatAt: null,
  };
  notify();
};

const getSnapshot = (): TelemetrySnapshot => snapshot;

const subscribe = (callback: () => void) => {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
};

export const telemetryStore = {
  subscribe,
  getSnapshot,
  pushTelemetry,
  resetTelemetry,
  resetToInitial: () => {
    // Clear telemetry history  
    snapshot = {
      history: [],
      last: null,
      lastHeartbeatAt: null,
    };
    ringBuffer = new Array(TELEMETRY_BUFFER_SIZE);
    ringIndex = 0;
    ringCount = 0;
    notify();
  },
  /**
   * Hard reset for complete telemetry wipe
   */
  resetToEmpty: () => {
    snapshot = {
      history: [],
      last: null,
      lastHeartbeatAt: null,
    };
    ringBuffer = new Array(TELEMETRY_BUFFER_SIZE);
    ringIndex = 0;
    ringCount = 0;
    notify();
  },
};

export const useTelemetryStore = () => {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    history: state.history,
    last: state.last,
    lastHeartbeatAt: state.lastHeartbeatAt,
    pushTelemetry,
    resetTelemetry,
  };
};
