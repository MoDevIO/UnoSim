import { describe, expect, it } from "vitest";
import {
  CapacityScenarioConfigurationError,
  classifyClientOutcome,
  countClientOutcomes,
  summarizeCapacityScenario,
  applyClientCapacityTiming,
  validateScenarioRuntimeConfiguration,
  type ClientResult,
  type EffectiveCapacityConfiguration,
  type HostSample,
  type StatusSnapshot,
} from "../../scripts/capacity-scenario-runner";

function client(overrides: Partial<ClientResult>): ClientResult {
  return {
    clientId: 1,
    connected: true,
    started: true,
    requestedAtMs: 1_000,
    connectedAtMs: 1_005,
    admittedAtMs: null,
    queueEnteredAtMs: 1_020,
    simulationSlotAcquiredAtMs: 2_020,
    startupSlotWaitBeganAtMs: 2_030,
    startupSlotAcquiredAtMs: 2_230,
    startupBeganAtMs: 2_240,
    runtimeStartedAtMs: 2_740,
    completedAtMs: 4_740,
    terminalAtMs: 4_740,
    disconnectedAtMs: 4_750,
    startLatencyMs: 1_740,
    queueWaitMs: 1_000,
    startupSlotWaitMs: 200,
    startupDurationMs: 500,
    runtimeDurationMs: 2_000,
    operationErrorCodes: [],
    errors: [],
    outcome: "success",
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
  it("does not treat SYSTEM_BUSY followed by stopped as successful completion", () => {
    const rejected = {
      started: false,
      runtimeStartedAtMs: null,
      completedAtMs: null,
      terminalAtMs: 2_000,
      operationErrorCodes: ["SYSTEM_BUSY"],
      errors: [],
    };

    expect(classifyClientOutcome(rejected)).toBe("rejected");
    expect(rejected.completedAtMs).toBeNull();
    expect(countClientOutcomes([rejected as never])).toMatchObject({ successful: 0, rejected: 1, failed: 0, incomplete: 0 });
  });

  it("requires RUNNING and rejects any operation error for successful completion", () => {
    expect(classifyClientOutcome({
      started: true,
      runtimeStartedAtMs: 1_000,
      completedAtMs: 2_000,
      operationErrorCodes: [],
      errors: [],
    })).toBe("success");
    expect(classifyClientOutcome({
      started: true,
      runtimeStartedAtMs: 1_000,
      completedAtMs: 2_000,
      operationErrorCodes: ["OTHER_ERROR"],
      errors: [],
    })).toBe("failed");
  });

  it("keeps WebSocket connection separate from application admission", () => {
    const connected = client({ admittedAtMs: null });
    expect(connected.admittedAtMs).toBeNull();
  });

  it("rejects a runtime configuration that cannot represent the requested load", () => {
    const actual: EffectiveCapacityConfiguration = {
      simulationMaxConcurrent: 40,
      sandboxStartMaxConcurrent: 40,
      simulationAdmissionMax: 25,
      simulationQueueTimeoutMs: 60_000,
      sandboxStartSlotTimeoutMs: 30_000,
      dockerControlTimeoutMs: 2_000,
      compileMaxConcurrent: 19,
    };

    expect(() => validateScenarioRuntimeConfiguration({
      expectedSimulationMaxConcurrent: 40,
      expectedSandboxStartMaxConcurrent: 40,
      requiredAdmissionMax: 40,
      expectedSimulationQueueTimeoutMs: 330_000,
    }, actual)).toThrow(CapacityScenarioConfigurationError);
    expect(() => validateScenarioRuntimeConfiguration({
      expectedSimulationMaxConcurrent: 40,
      expectedSandboxStartMaxConcurrent: 40,
      requiredAdmissionMax: 40,
      expectedSimulationQueueTimeoutMs: 60_000,
    }, { ...actual, simulationAdmissionMax: 40 })).not.toThrow();
  });

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
        status({ capacityTest: { sandboxStartWaitSamplesMs: [0, 8_000] }, capacity: {
          simulation: { maxConcurrent: 40, active: 3 },
          sandboxStart: { maxConcurrent: 20, active: 2, waiting: 4, slotTimeoutMs: 30_000 },
          admission: { max: 100, current: 8 },
          queue: { waiting: 5, timeoutMs: 60_000 },
          compile: { maxConcurrent: 19, active: 2 },
        } }),
        status({ capacityTest: { sandboxStartWaitSamplesMs: [0, 8_000] }, capacity: {
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
    expect(result.startupSlotWaitMs).toEqual([0, 8_000]);
    expect(result.startupDurationMs).toEqual([500, 800]);
    expect(result.hostSamples).toEqual(hostSamples);
    expect(result.errors).toEqual(["diagnostic warning"]);
    expect(result.cleanup.remainingCapacityContainers).toBe(0);
  });

  it("keeps simulation queue timing independent from authoritative sandbox-start samples", () => {
    const first = client({
      clientId: 1,
      queueWaitMs: 120_000,
      startupSlotWaitMs: null,
      startupSlotWaitBeganAtMs: null,
      startupSlotAcquiredAtMs: null,
    });
    const result = summarizeCapacityScenario({
      scenario: "classroom",
      holdDurationMs: 60_000,
      arrivalWindowMs: 5_000,
      clients: [first],
      statusHistory: [status({ capacityTest: { sandboxStartWaitSamplesMs: [8_000] } })],
      lifecycleDockerPeak: 1,
      pollingDockerPeak: 1,
      hostSamples: [],
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
      runtimeConfiguration: {
        simulationMaxConcurrent: 1,
        sandboxStartMaxConcurrent: 1,
        simulationAdmissionMax: 1,
        simulationQueueTimeoutMs: 330_000,
        sandboxStartSlotTimeoutMs: 30_000,
        dockerControlTimeoutMs: 2_000,
        compileMaxConcurrent: 19,
      },
    });

    expect(result.queueWaitMs).toEqual([120_000]);
    expect(result.startupSlotWaitMs).toEqual([8_000]);
  });

  it("does not assign sandbox-start timing to queued or compilation protocol messages", () => {
    const result = client({
      started: false,
      runtimeStartedAtMs: null,
      completedAtMs: null,
      queueEnteredAtMs: null,
      simulationSlotAcquiredAtMs: null,
      queueWaitMs: null,
      startupSlotWaitBeganAtMs: null,
      startupSlotAcquiredAtMs: null,
      startupSlotWaitMs: null,
    });

    applyClientCapacityTiming(result, { type: "simulation_status", status: "queued" }, 10_000);
    applyClientCapacityTiming(result, { type: "compilation_status" }, 130_000);

    expect(result.queueEnteredAtMs).toBe(10_000);
    expect(result.simulationSlotAcquiredAtMs).toBe(130_000);
    expect(result.queueWaitMs).toBe(120_000);
    expect(result.startupSlotWaitBeganAtMs).toBeNull();
    expect(result.startupSlotAcquiredAtMs).toBeNull();
    expect(result.startupSlotWaitMs).toBeNull();
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
