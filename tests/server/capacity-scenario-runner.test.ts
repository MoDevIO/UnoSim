import { describe, expect, it } from "vitest";
import {
  summarizeCapacityScenario,
  type ClientResult,
  type HostSample,
  type StatusSnapshot,
} from "../../scripts/capacity-scenario-runner";

function client(overrides: Partial<ClientResult>): ClientResult {
  return {
    clientId: 1,
    connected: true,
    started: true,
    requestedAtMs: 1_000,
    admittedAtMs: 1_010,
    queueEnteredAtMs: 1_020,
    simulationSlotAcquiredAtMs: 2_020,
    startupSlotWaitBeganAtMs: 2_030,
    startupSlotAcquiredAtMs: 2_230,
    startupBeganAtMs: 2_240,
    runtimeStartedAtMs: 2_740,
    completedAtMs: 4_740,
    disconnectedAtMs: 4_750,
    startLatencyMs: 1_740,
    queueWaitMs: 1_000,
    startupSlotWaitMs: 200,
    startupDurationMs: 500,
    runtimeDurationMs: 2_000,
    operationErrorCodes: [],
    errors: [],
    ...overrides,
  };
}

function status(overrides: Partial<StatusSnapshot>): StatusSnapshot {
  return {
    capacity: {
      simulation: { maxConcurrent: 40, active: 0 },
      sandboxStart: { maxConcurrent: 20, active: 0, waiting: 0, slotTimeoutMs: 30_000 },
      admission: { max: 100, current: 0 },
      queue: { waiting: 0, timeoutMs: 60_000 },
      compile: { maxConcurrent: 19, active: 0 },
    },
    ...overrides,
  };
}

describe("capacity scenario measurement aggregation", () => {
  it("keeps lifecycle and polling peaks separate and aggregates phase waits", () => {
    const clients = [
      client({ clientId: 1 }),
      client({
        clientId: 2,
        queueWaitMs: 3_000,
        startupSlotWaitMs: 700,
        startupDurationMs: 800,
        runtimeDurationMs: 2_500,
      }),
    ];
    const hostSamples: HostSample[] = [
      {
        atMs: 2_000,
        cpuPercent: 50,
        loadAverage: 4,
        availableMemoryBytes: 8_000,
        swapUsedBytes: 0,
        iowaitPercent: 1,
        runningDockerContainers: 3,
        capacityDockerContainers: 1,
      },
      {
        atMs: 3_000,
        cpuPercent: 70,
        loadAverage: 6,
        availableMemoryBytes: 7_000,
        swapUsedBytes: 0,
        iowaitPercent: 2,
        runningDockerContainers: 8,
        capacityDockerContainers: 2,
      },
    ];

    const result = summarizeCapacityScenario({
      scenario: "classroom",
      holdDurationMs: 60_000,
      arrivalWindowMs: 8_000,
      clients,
      statusHistory: [
        status({ capacity: {
          simulation: { maxConcurrent: 40, active: 3 },
          sandboxStart: { maxConcurrent: 20, active: 2, waiting: 4, slotTimeoutMs: 30_000 },
          admission: { max: 100, current: 8 },
          queue: { waiting: 5, timeoutMs: 60_000 },
          compile: { maxConcurrent: 19, active: 2 },
        } }),
        status({ capacity: {
          simulation: { maxConcurrent: 40, active: 7 },
          sandboxStart: { maxConcurrent: 20, active: 6, waiting: 9, slotTimeoutMs: 30_000 },
          admission: { max: 100, current: 14 },
          queue: { waiting: 10, timeoutMs: 60_000 },
          compile: { maxConcurrent: 19, active: 4 },
        } }),
      ],
      lifecycleDockerPeak: 8,
      pollingDockerPeak: 6,
      hostSamples,
      runtimeConfiguration: {
        simulationMaxConcurrent: 40,
        sandboxStartMaxConcurrent: 20,
        simulationAdmissionMax: 100,
        simulationQueueTimeoutMs: 60_000,
        sandboxStartSlotTimeoutMs: 30_000,
        dockerControlTimeoutMs: 2_000,
        compileMaxConcurrent: 19,
      },
      errors: ["diagnostic warning"],
      cleanup: {
        backendExited: true,
        remainingCapacityContainers: 0,
        activeSimulationCount: 0,
        queueWaiting: 0,
        admissionCurrent: 0,
        sandboxStartActive: 0,
        sandboxStartWaiting: 0,
      },
    });

    expect(result.scenario).toBe("classroom");
    expect(result.holdDurationMs).toBe(60_000);
    expect(result.arrivalWindowMs).toBe(8_000);
    expect(result.lifecycleDockerPeak).toBe(8);
    expect(result.pollingDockerPeak).toBe(6);
    expect(result.activePeak).toBe(7);
    expect(result.queuePeak).toBe(10);
    expect(result.admissionPeak).toBe(14);
    expect(result.sandboxStartPeak).toBe(6);
    expect(result.sandboxStartWaitingPeak).toBe(9);
    expect(result.queueWaitMs).toEqual([1_000, 3_000]);
    expect(result.startupSlotWaitMs).toEqual([200, 700]);
    expect(result.startupDurationMs).toEqual([500, 800]);
    expect(result.hostSamples).toEqual(hostSamples);
    expect(result.errors).toEqual(["diagnostic warning"]);
    expect(result.cleanup.remainingCapacityContainers).toBe(0);
  });

  it("preserves client phase timestamps and records missing phases as absent", () => {
    const waiting = client({
      clientId: 3,
      started: false,
      admittedAtMs: 1_100,
      queueEnteredAtMs: 1_200,
      simulationSlotAcquiredAtMs: null,
      startupSlotWaitBeganAtMs: null,
      startupSlotAcquiredAtMs: null,
      startupBeganAtMs: null,
      runtimeStartedAtMs: null,
      completedAtMs: null,
      disconnectedAtMs: 5_000,
      startLatencyMs: null,
      queueWaitMs: null,
      startupSlotWaitMs: null,
      startupDurationMs: null,
      runtimeDurationMs: null,
      operationErrorCodes: ["SYSTEM_BUSY"],
      errors: [],
    });
    const result = summarizeCapacityScenario({
      scenario: "burst",
      holdDurationMs: 5_000,
      clients: [waiting],
      statusHistory: [],
      lifecycleDockerPeak: 0,
      pollingDockerPeak: 0,
      hostSamples: [],
      runtimeConfiguration: {
        simulationMaxConcurrent: 5,
        sandboxStartMaxConcurrent: 5,
        simulationAdmissionMax: 25,
        simulationQueueTimeoutMs: 60_000,
        sandboxStartSlotTimeoutMs: 30_000,
        dockerControlTimeoutMs: 2_000,
        compileMaxConcurrent: 19,
      },
      errors: [],
      cleanup: {
        backendExited: true,
        remainingCapacityContainers: 0,
        activeSimulationCount: 0,
        queueWaiting: 0,
        admissionCurrent: 0,
        sandboxStartActive: 0,
        sandboxStartWaiting: 0,
      },
    });

    expect(result.clients[0]).toEqual(waiting);
    expect(result.queueWaitMs).toEqual([]);
    expect(result.startupSlotWaitMs).toEqual([]);
    expect(result.startupDurationMs).toEqual([]);
  });
});
