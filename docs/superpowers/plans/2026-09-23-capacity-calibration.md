# Host Capacity Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible `npm run capacity:calibrate` command that measures the current UnoSim host, evaluates directly measured capacity, and emits review-only recommendations without changing production configuration.

**Architecture:** Extract the existing real-Docker scenario measurement mechanics into a shared runner that returns raw observations without deciding pass/fail. Add a pure policy module for candidate planning and recommendations, a host/Docker probe module, a CLI orchestrator with bounded phases and cleanup, and report writers that serialize one versioned result object to JSON, Markdown, and an unapplied env fragment.

**Tech Stack:** TypeScript, Node.js 24, Vitest, WebSocket client, Docker CLI, existing UnoSim status/receipt APIs, existing `tsx` scripts, and existing Capacity lifecycle tracking.

**Spec:** `docs/superpowers/specs/2026-09-23-capacity-calibration-design.md`

## Global Constraints

- Run the implementation only on `feature/capacity-calibration`, based on merged `main`.
- Do not modify production Capacity defaults or application behavior.
- Do not modify the Tutor Registry SSOT.
- No recommendation may exceed a directly measured stable active or startup candidate.
- Classroom simulations use a fixed 60-second duration in version 1.
- `COMPILE_MAX_CONCURRENT` is reported as not calibrated unless a separate compile phase is actually run.
- Every non-dry-run load phase requires Docker health and usable CPU and memory safety signals.
- All owned processes and containers are cleaned in `finally`; unrelated containers are never stopped or removed.
- Calibration output is written below ignored `capacity-test-results/` and never applied automatically.

## Review Focus

1. **Direct-measurement boundary:** `capacity.env` must never contain an active or startup value that was not directly measured and stable; tests cover first-candidate-over-target downward refinement and no extrapolated recommendation.
2. **Validation independence:** the existing Capacity test retains its own assertions for status, lifecycle peak, polling peak, completion, and cleanup after using shared measurement helpers; a test mutating the shared aggregator cannot make assertions disappear.
3. **Timeout phase separation:** Docker-control, simulation queue, startup-slot wait, startup watchdog, and runtime timeout values remain separate in the effective output; tests assert each recommendation uses only its own measurements.
4. **Safety/deadline cleanup:** sustained CPU/memory/iowait violations, OOM, backend exit, Docker failure, and deadline truncation produce cleanup before returning partial output; tests use fake clocks/samples to exercise each branch.
5. **Reproducibility and environment gaps:** output includes Git SHA/dirty state, Docker/image fingerprints, effective settings, policy version, and explicit `null`/reduced-confidence values for optional host probes; tests assert missing optional probes do not become guessed values.

---

### Task 1: Create the isolated branch baseline

**Files:**
- Existing worktree: `/tmp/unosim-capacity-calibration`
- No product files changed in this task.

**Interfaces:**
- Consumes: merged `main` at `bf68148ff71cc87743405148c3ff9a3a968794d3` and spec commit `c474a225`.
- Produces: clean `feature/capacity-calibration` worktree with dependencies available for focused tests.

- [ ] **Step 1: Verify branch and clean state**

```bash
git -C /tmp/unosim-capacity-calibration branch --show-current
git -C /tmp/unosim-capacity-calibration rev-parse HEAD
git -C /tmp/unosim-capacity-calibration status --short
```

Expected branch is `feature/capacity-calibration`, HEAD is `c474a225`, and status is clean.

- [ ] **Step 2: Install dependencies without changing package manifests**

```bash
npm ci
```

Run from `/tmp/unosim-capacity-calibration`; do not run `npm install` with manifest updates.

- [ ] **Step 3: Run the existing unit baseline**

```bash
npm run test:unit
```

Record the test count and confirm there are no pre-existing failures before adding implementation files.

---

### Task 2: Add pure calibration policy types and tests

**Files:**
- Create: `scripts/capacity-calibration-policy.ts`
- Test: `tests/server/capacity-calibration-policy.test.ts`

**Interfaces:**

```ts
export const CALIBRATION_POLICY_VERSION = "1" as const;

export type CalibrationOptions = {
  expectedUsers: number;
  targetCpuPercent: number;
  maxCpuPercent: number;
  maxUserWaitSec: number;
  maxDurationMin: number;
  classroomDurationSec: 60;
};

export type ActiveMeasurement = {
  requested: number;
  stable: boolean;
  cpuP95Percent: number | null;
  cpuMaxPercent: number | null;
  minAvailableMemoryBytes: number | null;
  lifecycleDockerPeak: number;
  pollingDockerPeak: number;
  errors: string[];
  elapsedMs: number;
};

export type StartupMeasurement = {
  requested: number;
  stable: boolean;
  startupSlotWaitP95Ms: number | null;
  startupSlotWaitMaxMs: number | null;
  startupDurationP95Ms: number | null;
  cpuP95Percent: number | null;
  iowaitP95Percent: number | null;
  minAvailableMemoryBytes: number | null;
  failures: number;
  timeouts: number;
};

export type Recommendation<T> = {
  value: T | null;
  status: "recommended" | "not-calibrated" | "infeasible" | "out-of-range";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  measuredBasis: string[];
  warnings: string[];
};

export function validateCalibrationOptions(input: Partial<CalibrationOptions>): CalibrationOptions;
export function planActiveCandidates(options: CalibrationOptions, logicalCpus: number): number[];
export function planDownwardRefinement(firstExceeded: number, options: CalibrationOptions, logicalCpus: number): number[];
export function selectActiveRecommendation(measurements: ActiveMeasurement[], options: CalibrationOptions): Recommendation<number>;
export function selectStartupRecommendation(measurements: StartupMeasurement[], productionDefault: number, maxActive: number): Recommendation<number>;
export function recommendDockerControlTimeout(p99Ms: number | null, productionDefault: number, range: { min: number; max: number }): Recommendation<number>;
export function recommendSandboxStartSlotTimeout(p99Ms: number | null, maxObservedMs: number | null, productionDefault: number, range: { min: number; max: number }): Recommendation<number>;
export function recommendQueueTimeout(queueP95Ms: number | null, queueP99Ms: number | null, queueMaxMs: number | null, maxUserWaitSec: number): Recommendation<number>;
export function scoreCalibrationConfidence(measuredPhases: number, complete: boolean, safetyEvents: number): "HIGH" | "MEDIUM" | "LOW";
```

- [ ] **Step 1: Write failing option-validation tests**

Add tests for defaults (`expectedUsers=200`, CPU 75/85, wait 240 seconds, duration 30 minutes, classroom duration 60 seconds), rejection of zero/negative/non-finite values, rejection of `targetCpu >= maxCpu`, rejection of `maxCpu > 95`, and acceptance of decimal CPU thresholds.

- [ ] **Step 2: Run the policy test file and verify the expected missing-export failures**

```bash
npx vitest run --project=unit-node tests/server/capacity-calibration-policy.test.ts
```

The test must fail because the policy module and exports do not exist yet.

- [ ] **Step 3: Add failing candidate-planning and active-selection tests**

Cover host-sized bounded coarse candidates, expected-user and 128 caps, downward refinement when the first candidate exceeds target CPU, refinement only between measured bounds, stable lifecycle/polling requirements, target-CPU selection, and no recommendation when every candidate is unsafe.

- [ ] **Step 4: Add failing startup and timeout-policy tests**

Cover the smallest startup candidate within 10% of best p95, baseline-relative CPU/iowait/memory/error regressions, Docker-control recommendation below default, in-range recommendation, out-of-range recommendation without clamping, startup-slot formula, no-startup-data `not-calibrated`, queue technical minimum, and `technical > maxUserWait` producing `infeasible` with no value.

- [ ] **Step 5: Implement the minimal pure policy functions**

Implement validation, candidate planning, direct-measurement selection, downward refinement, startup baseline comparisons, timeout formulas, range status, and confidence without importing Docker, filesystem, process, or server modules.

- [ ] **Step 6: Run policy tests to verify green**

```bash
npx vitest run --project=unit-node tests/server/capacity-calibration-policy.test.ts
```

- [ ] **Step 7: Commit the policy unit**

```bash
git add scripts/capacity-calibration-policy.ts tests/server/capacity-calibration-policy.test.ts
git commit -m "feat: add capacity calibration policy"
```

---

### Task 3: Add host and Docker probes

**Files:**
- Create: `scripts/capacity-calibration-host.ts`
- Test: `tests/server/capacity-calibration-host.test.ts`

**Interfaces:**

```ts
export type HostProbe = {
  required: { gitSha: string; gitDirty: boolean; nodeVersion: string; architecture: string; logicalCpus: number };
  optional: { physicalMemoryBytes: number | null; loadAverage: number[] | null; availableMemoryBytes: number | null; swapUsedBytes: number | null; iowaitPercent: number | null; thermalPressure: string | null };
  safetySignals: { cpuAvailable: boolean; memoryAvailable: boolean };
};

export type DockerProbe = {
  clientVersion: string;
  serverVersion: string;
  architecture: string;
  cpus: number;
  memoryBytes: number;
  storageDriver: string;
  daemonHealthy: boolean;
  image: { reference: string; id: string; digest: string | null };
  runningContainers: Array<{ id: string; name: string; image: string; status: string; labels: Record<string, string> }>;
};

export type ControlLatencySample = { command: string; condition: "idle" | "parallel"; durationsMs: number[]; error: string | null };

export async function collectHostProbe(deps?: HostProbeDependencies): Promise<HostProbe>;
export async function collectDockerProbe(image: string, deps?: DockerProbeDependencies): Promise<DockerProbe>;
export async function measureDockerControlLatency(image: string, parallelism: number, samples: number, deps?: ControlDependencies): Promise<ControlLatencySample[]>;
```

- [ ] **Step 1: Write failing required/optional probe tests**

Use injected command results to assert required Git/Node/architecture/CPU/Docker/image probes fail fast on missing data, while physical memory, load, swap, iowait, thermal, and process metrics become `null` without invented values.

- [ ] **Step 2: Write failing Docker and control-latency tests**

Cover Docker health failure, image ID/digest capture, unrelated container listing, idle versus parallel samples, per-command p50 input preservation, and command error capture.

- [ ] **Step 3: Implement probe dependencies and platform adapters**

Use `execFile`/`execFileSync` wrappers for Git and Docker. Use portable Node APIs first; use `sysctl`/`vm_stat` on macOS and `/proc`/`free`/`uptime` on Linux only for optional enrichment. Require at least one CPU and memory safety signal before non-dry-run load.

- [ ] **Step 4: Run host-probe tests**

```bash
npx vitest run --project=unit-node tests/server/capacity-calibration-host.test.ts
```

- [ ] **Step 5: Commit the probe unit**

```bash
git add scripts/capacity-calibration-host.ts tests/server/capacity-calibration-host.test.ts
git commit -m "feat: collect reproducible calibration host probes"
```

---

### Task 4: Extract shared real-Docker measurement mechanics

**Files:**
- Create: `scripts/capacity-scenario-runner.ts`
- Modify: `tests/server/capacity-validation.test.ts`
- Test: `tests/server/capacity-scenario-runner.test.ts`

**Interfaces:**

```ts
export type ScenarioKind = "burst" | "classroom";

export type CapacityScenarioOptions = {
  baseUrl: string;
  runId: string;
  scenario: ScenarioKind;
  clientCount: number;
  holdDurationMs: number;
  simulationTimeoutSec: number;
  arrivalWindowMs?: number;
  outputDir?: string;
};

export type ClientResult = {
  clientId: number;
  connected: boolean;
  started: boolean;
  requestedAtMs: number;
  admittedAtMs: number | null;
  queueEnteredAtMs: number | null;
  simulationSlotAcquiredAtMs: number | null;
  startupSlotWaitBeganAtMs: number | null;
  startupSlotAcquiredAtMs: number | null;
  startupBeganAtMs: number | null;
  runtimeStartedAtMs: number | null;
  completedAtMs: number | null;
  disconnectedAtMs: number | null;
  startLatencyMs: number | null;
  queueWaitMs: number | null;
  startupSlotWaitMs: number | null;
  startupDurationMs: number | null;
  runtimeDurationMs: number | null;
  operationErrorCodes: string[];
  errors: string[];
};

export type StatusSnapshot = {
  capacityTestRunId?: string;
  capacity?: {
    simulation?: { maxConcurrent: number; active: number };
    sandboxStart?: { maxConcurrent: number; active: number; waiting: number; slotTimeoutMs: number };
    admission?: { max: number; current: number };
    queue?: { waiting: number; timeoutMs: number };
    compile?: { maxConcurrent: number; active: number };
  };
};

export type EffectiveCapacityConfiguration = {
  simulationMaxConcurrent: number;
  sandboxStartMaxConcurrent: number;
  simulationAdmissionMax: number;
  simulationQueueTimeoutMs: number;
  sandboxStartSlotTimeoutMs: number;
  dockerControlTimeoutMs: number;
  compileMaxConcurrent: number;
};

export type HostSample = {
  atMs: number;
  cpuPercent: number | null;
  loadAverage: number | null;
  availableMemoryBytes: number | null;
  swapUsedBytes: number | null;
  iowaitPercent: number | null;
  runningDockerContainers: number;
  capacityDockerContainers: number;
};

export type CleanupResult = {
  backendExited: boolean;
  remainingCapacityContainers: number;
  activeSimulationCount: number | null;
  queueWaiting: number | null;
  admissionCurrent: number | null;
  sandboxStartActive: number | null;
  sandboxStartWaiting: number | null;
};

export type ScenarioRunnerDependencies = {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  getStatus?: (baseUrl: string) => Promise<StatusSnapshot>;
  createSessionCookie?: (baseUrl: string) => Promise<string>;
  dockerContainerCount?: (runId: string, includeStopped?: boolean) => number;
  sampleHost?: () => Promise<HostSample>;
};

export type CapacityScenarioMeasurement = {
  clients: ClientResult[];
  statusHistory: StatusSnapshot[];
  runtimeConfiguration: EffectiveCapacityConfiguration;
  lifecycleDockerPeak: number;
  pollingDockerPeak: number;
  activePeak: number;
  queuePeak: number;
  admissionPeak: number;
  sandboxStartPeak: number;
  sandboxStartWaitingPeak: number;
  startupSlotWaitMs: number[];
  startupDurationMs: number[];
  queueWaitMs: number[];
  hostSamples: HostSample[];
  errors: string[];
  cleanup: CleanupResult;
};

export async function runCapacityScenario(options: CapacityScenarioOptions, deps?: ScenarioRunnerDependencies): Promise<CapacityScenarioMeasurement>;
```

- [ ] **Step 1: Write failing aggregation tests**

Feed deterministic client/status/event/sample fixtures and assert separate lifecycle and polling peaks, simulation queue versus startup-slot waits, fixed classroom duration metadata, percentile inputs, client phase timestamps, and raw observations.

- [ ] **Step 2: Run the runner tests to verify the missing module failure**

```bash
npx vitest run --project=unit-node tests/server/capacity-scenario-runner.test.ts
```

- [ ] **Step 3: Extract HTTP/WebSocket clients, status polling, lifecycle tracking, and cleanup**

Move only reusable mechanics from `capacity-validation.test.ts` into the script module. Keep `capacity-validation.test.ts` responsible for `assertCapacityRuntimeMatches`, expected admission/rejection counts, exact success counts, peak assertions, timeout assertions, and leak assertions.

- [ ] **Step 4: Add classroom arrival and fixed-duration handling**

Use a 60-second simulation duration and spread client starts across the requested arrival window. Record admission, queue, slot, startup, runtime, completion, and error timestamps for every client.

- [ ] **Step 5: Run shared-runner and existing Capacity validation tests**

```bash
npx vitest run --project=unit-node tests/server/capacity-scenario-runner.test.ts tests/server/capacity-validation-config.test.ts
git diff --check
```

- [ ] **Step 6: Commit the measurement layer**

```bash
git add scripts/capacity-scenario-runner.ts tests/server/capacity-scenario-runner.test.ts tests/server/capacity-validation.test.ts
git commit -m "refactor: share capacity scenario measurements"
```

---

### Task 5: Implement the calibration orchestration and owned backend lifecycle

**Files:**
- Create: `scripts/calibrate-capacity.ts`
- Test: `tests/server/calibrate-capacity-cli.test.ts`

**Interfaces:**

```ts
export type CalibrationRunResult = {
  schemaVersion: 1;
  policyVersion: string;
  policy: CalibrationOptions;
  fingerprint: { gitSha: string; gitDirty: boolean; host: HostProbe; docker: DockerProbe; effectiveCapacity: EffectiveCapacityConfiguration };
  plan: { activeCandidates: number[]; startupCandidates: number[]; classroomDurationSec: 60 };
  phases: { dockerControl: ControlLatencySample[]; active: ActiveMeasurement[]; startup: StartupMeasurement[]; classroom: ClassroomMeasurement | null };
  recommendations: CalibrationRecommendations;
  safetyEvents: SafetyEvent[];
  partial: boolean;
  stopReason: string | null;
  cleanup: CleanupResult;
};

export type SafetyEvent = {
  atMs: number;
  phase: "preflight" | "control" | "active" | "startup" | "classroom" | "cleanup";
  kind: "cpu" | "memory" | "iowait" | "oom" | "docker" | "backend" | "deadline" | "cleanup";
  message: string;
  immediate: boolean;
};

export type CalibrationCliConfig = CalibrationOptions & {
  outputDir: string;
  skipClassroom: boolean;
  skipStartupTuning: boolean;
  dryRun: boolean;
  verbose: boolean;
};

export type CalibrationRecommendations = {
  simulationMaxConcurrent: Recommendation<number>;
  sandboxStartMaxConcurrent: Recommendation<number>;
  simulationAdmissionMax: Recommendation<number>;
  simulationQueueTimeoutMs: Recommendation<number>;
  sandboxStartSlotTimeoutMs: Recommendation<number>;
  dockerControlTimeoutMs: Recommendation<number>;
  compileMaxConcurrent: Recommendation<number>;
};

export type ClassroomMeasurement = CapacityScenarioMeasurement & {
  queueP50Ms: number | null;
  queueP95Ms: number | null;
  queueP99Ms: number | null;
  queueMaxMs: number | null;
  startupSlotWaitP50Ms: number | null;
  startupSlotWaitP95Ms: number | null;
  startupSlotWaitP99Ms: number | null;
  startupSlotWaitMaxMs: number | null;
  completed: number;
  failed: number;
  fairness: { starvation: boolean; reorderPercentage: number | null; outliers: number };
};

export type CalibrationDependencies = {
  now?: () => number;
  collectHostProbe?: () => Promise<HostProbe>;
  collectDockerProbe?: (image: string) => Promise<DockerProbe>;
  measureDockerControlLatency?: (image: string, parallelism: number, samples: number) => Promise<ControlLatencySample[]>;
  runScenario?: (options: CapacityScenarioOptions) => Promise<CapacityScenarioMeasurement>;
  startBackend?: (capacity: EffectiveCapacityConfiguration, runId: string) => Promise<{ baseUrl: string; stop: () => Promise<void> }>;
};

export async function parseCalibrationArgs(argv: string[]): Promise<CalibrationCliConfig>;
export async function runCalibration(config: CalibrationCliConfig, deps?: CalibrationDependencies): Promise<CalibrationRunResult>;
```

- [ ] **Step 1: Write failing CLI parser tests**

Cover defaults, every supported flag, unknown/missing values, invalid ranges, `--dry-run`, and printing the effective policy before load.

- [ ] **Step 2: Write failing orchestration tests with fake probes and runner**

Cover phase ordering, deadline truncation, first-candidate-over-target downward probing, safe escalation stop, startup skip, classroom skip, backend cleanup on thrown errors, and no `capacity.env` application.

- [ ] **Step 3: Implement argument parsing and policy printing**

Use a strict parser with status 2 for invalid input. Set fixed classroom duration to 60 seconds in the configuration object and include it in the printed policy.

- [ ] **Step 4: Implement owned backend startup**

Start `tsx server/index.ts` on an allocated loopback port with `NODE_ENV=test`, Docker mode, `CAPACITY_TEST_RUN_ID`, semantic environment overrides, and the measured sandbox image. Poll `/api/readiness`, fetch `/api/status`, and abort if runtime settings do not match the requested phase.

- [ ] **Step 5: Implement phase orchestration and safety deadline**

Run control probes, active candidates, startup candidates, and classroom phase in order. Use an absolute deadline, sustained host samples, `AbortController` cancellation, and `finally` cleanup that terminates only the owned backend and exact run-ID containers.

- [ ] **Step 6: Run CLI/orchestration tests**

```bash
npx vitest run --project=unit-node tests/server/calibrate-capacity-cli.test.ts
```

- [ ] **Step 7: Commit the orchestrator**

```bash
git add scripts/calibrate-capacity.ts tests/server/calibrate-capacity-cli.test.ts
git commit -m "feat: add host capacity calibration command"
```

---

### Task 6: Add versioned report and env-fragment writers

**Files:**
- Create: `scripts/capacity-calibration-report.ts`
- Test: `tests/server/capacity-calibration-report.test.ts`
- Modify: `scripts/calibrate-capacity.ts`

**Interfaces:**

```ts
export function writeCalibrationArtifacts(result: CalibrationRunResult, outputDir: string): Promise<{ jsonPath: string; markdownPath: string; envPath: string }>;
export function renderCalibrationMarkdown(result: CalibrationRunResult): string;
export function renderCapacityEnv(result: CalibrationRunResult): string;
```

- [ ] **Step 1: Write failing report tests**

Assert schema/policy version, reproducibility fingerprints, raw phase measurements, confidence/reason fields, measured/technical/UX timeout columns, partial-run and safety sections, and omission of uncalibrated or out-of-range values from `capacity.env`.

- [ ] **Step 2: Implement JSON, Markdown, and review-only env rendering**

Serialize the exact result object without recomputing policy. Include comments in `capacity.env` explaining that it is unapplied and list only directly measured recommendations.

- [ ] **Step 3: Integrate artifact writing in success, partial, and failure paths**

Write reports after cleanup for normal completion, safety stop, deadline truncation, and pre-load dry runs. Preserve the original error in the report while returning a nonzero exit status for unsafe/preflight failures.

- [ ] **Step 4: Run report tests**

```bash
npx vitest run --project=unit-node tests/server/capacity-calibration-report.test.ts
```

- [ ] **Step 5: Commit report generation**

```bash
git add scripts/capacity-calibration-report.ts scripts/calibrate-capacity.ts tests/server/capacity-calibration-report.test.ts
git commit -m "feat: generate reviewable capacity calibration reports"
```

---

### Task 7: Add the npm command and authoritative documentation

**Files:**
- Modify: `package.json`
- Modify: `docs/CAPACITY_VALIDATION_PLAN.md`
- Test: `tests/server/calibrate-capacity-cli.test.ts`

**Interfaces:**
- `npm run capacity:calibrate -- --expected-users 200` invokes `tsx scripts/calibrate-capacity.ts`.
- Documentation describes Calibrate → Review → Apply and never instructs automatic application.

- [ ] **Step 1: Add the package script**

Add exactly:

```json
"capacity:calibrate": "tsx scripts/calibrate-capacity.ts"
```

Do not change production environment defaults or existing Capacity scripts.

- [ ] **Step 2: Add documentation tests/fixtures for command and output names**

Assert that the documented command, `capacity-calibration.json`, `capacity-calibration.md`, `capacity.env`, fixed 60-second classroom duration, and review-only workflow are present.

- [ ] **Step 3: Extend the authoritative Capacity plan**

Document measured versus inferred values, direct-measurement limits, policy versions, host/Docker probes, safety behavior, global duration, optional compile calibration, report review, and rerun triggers after hardware/runtime/resource/workload changes.

- [ ] **Step 4: Run documentation checks**

```bash
npm run check:docs
git diff --check
```

- [ ] **Step 5: Commit command and documentation**

```bash
git add package.json docs/CAPACITY_VALIDATION_PLAN.md tests/server/calibrate-capacity-cli.test.ts
git commit -m "docs: document capacity calibration workflow"
```

---

### Task 8: Run focused tests and a dry-run smoke test

**Files:**
- No new files; inspect all files created above.

- [ ] **Step 1: Run all calibration-focused tests**

```bash
npx vitest run --project=unit-node \
  tests/server/capacity-calibration-policy.test.ts \
  tests/server/capacity-calibration-host.test.ts \
  tests/server/capacity-scenario-runner.test.ts \
  tests/server/calibrate-capacity-cli.test.ts \
  tests/server/capacity-calibration-report.test.ts
```

- [ ] **Step 2: Run the dry-run CLI**

```bash
npm run capacity:calibrate -- --expected-users 200 --dry-run --output-dir /tmp/unosim-capacity-calibration-dry-run
```

Verify it prints the policy, probes metadata, writes all three artifacts, starts no backend, creates no Docker containers, and does not modify any environment/configuration file.

- [ ] **Step 3: Run the existing Capacity unit/configuration tests**

```bash
npx vitest run --project=unit-node \
  tests/server/capacity-validation-config.test.ts \
  tests/server/capacity-docker-events.test.ts \
  tests/server/config.test.ts \
  tests/server/routes/server-status.test.ts
```

- [ ] **Step 4: Review generated output and cleanup**

Inspect the JSON/Markdown/env files, verify the env fragment is unapplied, remove only the temporary `/tmp` dry-run directory, and confirm no Docker resources remain.

---

### Task 9: Run the small real-Docker calibration smoke test

**Files:**
- No source changes; generated output stays under ignored `capacity-test-results/`.

- [ ] **Step 1: Verify Docker and image prerequisites**

```bash
docker info
docker image inspect unosim-sandbox:latest
```

If either prerequisite is unavailable, report the smoke test as blocked without changing code.

- [ ] **Step 2: Run a bounded calibration smoke**

```bash
npm run capacity:calibrate -- \
  --expected-users 20 \
  --target-cpu 75 \
  --max-cpu 85 \
  --max-user-wait 120 \
  --max-duration 5 \
  --skip-classroom \
  --output-dir capacity-test-results/calibration-smoke
```

Use the same workload and run-ID cleanup as the production command; do not run a 30-minute Dell campaign during development.

- [ ] **Step 3: Verify smoke output and cleanup**

Confirm JSON/Markdown/env artifacts contain fingerprints and measured-only recommendations, then run:

```bash
docker ps -a --filter label=unosim.capacity-test-run-id
git status --short
```

No owned containers or backend process may remain; generated results remain ignored.

---

### Task 10: Full validation and final audit

**Files:**
- All implementation files from Tasks 2–7.

- [ ] **Step 1: Run required repository checks**

```bash
npm run check
npm run test:unit
npm run build
npm run test:integration
npm run check:docs
git diff --check
```

- [ ] **Step 2: Run the calibration-focused tests again after the full suite**

```bash
npx vitest run --project=unit-node \
  tests/server/capacity-calibration-policy.test.ts \
  tests/server/capacity-calibration-host.test.ts \
  tests/server/capacity-scenario-runner.test.ts \
  tests/server/calibrate-capacity-cli.test.ts \
  tests/server/capacity-calibration-report.test.ts
```

- [ ] **Step 3: Audit changed and untracked files**

```bash
git status --short
git diff --stat bf68148ff71cc87743405148c3ff9a3a968794d3
git diff --check
rg -n "DELL|UnoSim_Test|192\\.168\\.|capacity.env.*apply|SIMULATION_MAX_CONCURRENT=70|SANDBOX_START_MAX_CONCURRENT=20" scripts tests docs package.json
```

Remove only accidental debug output, hostnames/IPs, credentials, or generated artifacts introduced by this feature. Do not touch the Tutor Registry SSOT.

- [ ] **Step 4: Verify production defaults remain unchanged**

```bash
rg -n "SIMULATION_MAX_CONCURRENT|SANDBOX_START_MAX_CONCURRENT|SIMULATION_ADMISSION_MAX|SIMULATION_QUEUE_TIMEOUT_MS|SANDBOX_START_SLOT_TIMEOUT_MS|DOCKER_CONTROL_TIMEOUT_MS" server/config.ts docker-compose.yml tests/deployment/docker-compose.gateway.yml
```

Compare values with the merged-main baseline and confirm calibration code uses test-only overrides rather than editing these files.

- [ ] **Step 5: Create the final implementation commits**

Keep the spec commits and implementation commits separate. Use the logical implementation messages already defined in Tasks 2–7; do not commit calibration result artifacts.

- [ ] **Step 6: Report readiness without merging**

Report branch HEAD, commits, files, CLI usage, policy rules, validation results, smoke result, and any blocked Dell validation. Do not merge to `main`.
