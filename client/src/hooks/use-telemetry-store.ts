import { useSyncExternalStore } from "react";

export interface TelemetryMetrics {
  incomingEvents: number;
  sentBatches: number;
  eventsPerSecond: number;
  batchEfficiency: number;
  timestamp: number;
}

export interface TelemetryPeaks {
  maxEventsPerSecond: number;
  maxEventsAt: number | null;
  minBatchEfficiency: number;
  minEfficiencyAt: number | null;
}

interface TelemetrySnapshot {
  history: TelemetryMetrics[];
  last: TelemetryMetrics | null;
  peaks: TelemetryPeaks;
  lastHeartbeatAt: number | null;
}

const TELEMETRY_BUFFER_SIZE = 60;

const subscribers = new Set<() => void>();

const emptyPeaks: TelemetryPeaks = {
  maxEventsPerSecond: 0,
  maxEventsAt: null,
  minBatchEfficiency: Number.POSITIVE_INFINITY,
  minEfficiencyAt: null,
};

let snapshot: TelemetrySnapshot = {
  history: [],
  last: null,
  peaks: emptyPeaks,
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

  const nextPeaks: TelemetryPeaks = { ...snapshot.peaks };
  if (metrics.eventsPerSecond > nextPeaks.maxEventsPerSecond) {
    nextPeaks.maxEventsPerSecond = metrics.eventsPerSecond;
    nextPeaks.maxEventsAt = metrics.timestamp;
  }
  if (metrics.batchEfficiency < nextPeaks.minBatchEfficiency) {
    nextPeaks.minBatchEfficiency = metrics.batchEfficiency;
    nextPeaks.minEfficiencyAt = metrics.timestamp;
  }

  snapshot = {
    history: getHistory(),
    last: metrics,
    peaks: nextPeaks,
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
    peaks: { ...emptyPeaks },
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
    // Clear telemetry history but preserve peaks (accumulated stats)
    snapshot = {
      history: [],
      last: null,
      peaks: snapshot.peaks, // Keep accumulated peaks
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
      peaks: JSON.parse(JSON.stringify(emptyPeaks)),
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
    peaks: state.peaks,
    lastHeartbeatAt: state.lastHeartbeatAt,
    pushTelemetry,
    resetTelemetry,
  };
};
