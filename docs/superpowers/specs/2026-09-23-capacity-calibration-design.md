# UnoSim Host-Capacity Calibration Design

## Goal

Provide a reproducible `npm run capacity:calibrate -- --expected-users 200`
command that measures the current host and Docker-backed UnoSim workload,
selects directly measured capacity settings, and emits reviewable
recommendations without changing production configuration.

## Scope and constraints

- The calibration tool runs only from the new `feature/capacity-calibration`
  branch.
- Production defaults and application behavior remain unchanged.
- The existing Capacity semantics are authoritative:
  `SIMULATION_MAX_CONCURRENT`, `SANDBOX_START_MAX_CONCURRENT`,
  `SIMULATION_ADMISSION_MAX`, `SIMULATION_QUEUE_TIMEOUT_MS`,
  `SANDBOX_START_SLOT_TIMEOUT_MS`, `DOCKER_CONTROL_TIMEOUT_MS`, and
  `COMPILE_MAX_CONCURRENT`.
- Existing run-ID isolation, Docker lifecycle events, polling, status snapshots,
  receipts, cleanup, and CPU-intensive workload remain the measurement basis.
- No recommendation may exceed a directly measured stable simulation level or
  startup-concurrency candidate. Interpolation is allowed only inside measured
  refinement bounds; extrapolated values are report-only and never written to
  `capacity.env`.
- `COMPILE_MAX_CONCURRENT` is optional in version 1. If it is not measured, the
  output records `not calibrated` and preserves the existing derived default.
- The Tutor Registry SSOT is outside this branch and is not touched.

## Architecture

The feature has four separable layers:

1. **Measurement collection** starts an owned backend with test-only environment
   overrides, drives the existing CPU-intensive client workload, collects raw
   host/Docker/status/lifecycle data, and performs label-scoped cleanup.
2. **Policy evaluation** is a pure module. It accepts recorded measurements and
   calibration policy, then returns recommendations, confidence, and reasons.
3. **Orchestration** validates CLI input, plans bounded phases, enforces the
   global deadline and safety guards, and coordinates collection/evaluation.
4. **Output formatting** writes versioned JSON, Markdown, and a review-only env
   fragment from the same result object.

The validation test keeps its own assertions. Shared measurement helpers expose
observations but do not decide whether a validation scenario passes, so a bug in
measurement cannot make both the test and calibration agree accidentally.

## CLI contract

Command:

```text
npm run capacity:calibrate -- [options]
```

Supported options and defaults:

| Option | Default | Meaning |
| --- | ---: | --- |
| `--expected-users <n>` | `200` | Classroom/admission envelope |
| `--target-cpu <percent>` | `75` | Desired steady-state CPU p95 |
| `--max-cpu <percent>` | `85` | Hard active-cap CPU p95 ceiling |
| `--max-user-wait <seconds>` | `240` | UX policy ceiling for queue waits |
| `--max-duration <minutes>` | `30` | End-to-end calibration budget |
| `--output-dir <path>` | `capacity-test-results/calibration-<timestamp>` | Artifact directory |
| `--skip-classroom` | false | Skip the expected-users arrival phase |
| `--skip-startup-tuning` | false | Keep the existing startup candidate/default |
| `--dry-run` | false | Validate, probe metadata, print the plan, run no load |
| `--verbose` | false | Print phase and sample detail |

Numeric values must be finite integers or decimals where applicable, positive,
and within safe bounds. `target-cpu < max-cpu <= 95`; expected users and duration
must be positive; user wait must be positive. Invalid or unknown arguments exit
with status 2 before any Docker workload starts. The effective policy is printed
before the first measurement.

## Measurement phases

### Pre-flight

Record:

- Git SHA and dirty-state indicator
- host architecture, logical CPUs, physical memory, load average, available
  memory, and swap where available
- Docker client/server versions, architecture, visible CPUs/RAM, storage driver,
  daemon health, and sandbox image ID/digest
- effective sandbox CPU/memory limits and relevant Capacity defaults
- unrelated running containers and their names/statuses

The tool aborts before load if Docker is unhealthy or the configured sandbox
image cannot be inspected. Existing workloads are never stopped automatically.

### Phase A: Docker control latency

Measure `docker --version`, `docker info`, and `docker image inspect` during an
idle sample and a bounded parallel burst. Store every duration and summarize
p50/p95/p99/max per command and condition.

The pure policy recommends:

```text
max(productionDefault, ceil(p99 * 1.5 / 100ms) * 100ms)
```

The recommendation is capped by the validated configuration range. The output
always shows measured p99/max, the technical recommendation, and the effective
production default. This phase never changes Docker configuration.

### Phase B: active simulation capacity

Plan a bounded ladder from host size and expected users. The initial maximum is
`min(expectedUsers, max(20, logicalCPUs * 4))`, and candidates are rounded to
host-sized increments. The plan cannot exceed 128 or any explicit safety bound.

Each candidate uses the existing CPU-intensive workload, requires all clients to
reach `RUNNING`, requires lifecycle-derived physical overlap equal to the
requested level, corroborates with polling, holds a stable all-running plateau,
and records host/Docker/status/error/cleanup data.

A run is stable only when it has no functional errors, no OOM/Docker/backend
failure, no cleanup leak, lifecycle peak equal to the request, and polling peak
consistent with that peak. A sustained safety violation ends escalation and
cleanup immediately.

Coarse candidates use 20–30 second plateaus. If the coarse results straddle the
target CPU region, refinement tests only measured intermediate values between the
last passing and first exceeding candidate. Refinement uses a bounded step of
`max(5, ceil(logicalCPUs / 2))`, never extrapolates, and stops when the target
region is directly measured or the time budget is exhausted.

The recommended `SIMULATION_MAX_CONCURRENT` is the highest directly measured
stable candidate with CPU p95 at or below `target-cpu`. If no candidate meets
the target but a stable candidate is below `max-cpu`, the highest such candidate
is reported with reduced confidence and an explicit warning. No candidate above
`max-cpu`, with unsafe memory/iowait, or with functional failure is recommended.

### Phase C: sandbox-start concurrency

At or below the selected active cap, test a bounded startup candidate ladder
adapted to the host and existing default, such as 8, 12, 16, 20, 24, and 32,
without exceeding the measured active cap or safety budget.

For every candidate record startup-slot wait and slot-acquisition-to-runtime
latencies, CPU/load/iowait/memory, failures/timeouts, time to the active plateau,
and cleanup.

The policy chooses the smallest safe candidate whose startup p95 is within 10%
of the best observed safe startup p95, while also requiring all of the following against the selected candidate: CPU p95
may not increase by more than 5 percentage points or 10% relative, iowait may not
increase by more than 5 percentage points, available memory may not fall by more
than 10%, and the candidate must have zero failures/timeouts. The output lists all
candidates and explains why larger candidates were not selected. No startup candidate is recommended
unless it was directly measured.

### Phase D: expected-users classroom phase

Unless skipped, run `expected-users` clients over a controlled 5–10 second
arrival window using the selected measured active and startup values. Set
admission max to the requested expected-user count. Record simulation queue wait
separately from sandbox-start-slot wait, per-client phase timestamps, active and
waiting peaks, lifecycle/polling peaks, completion/failure counts, fairness, and
cleanup.

The output reports technical queue timing separately from UX policy:

```text
technical minimum = rounded max(queue p95 * 1.5, queue p99 * 1.25,
                               queue max * 1.10)
UX recommendation = min(technical minimum, max-user-wait)
```

When the technical minimum exceeds the UX ceiling, the report marks the
classroom policy as infeasible within the requested wait and does not hide that
fact by lowering admission or active capacity.

### Optional compilation phase

Version 1 does not run a separate compile-concurrency campaign unless a
representative compile workload is already available within the deadline. When
not run, `COMPILE_MAX_CONCURRENT` remains `not calibrated`, and the output
records the current derived/default value without recommending a new one.

## Safety and deadline handling

Safety observations use sustained windows rather than single samples:

- CPU p95 at or above `max-cpu` for a sustained phase window stops escalation.
- CPU at or above 95%, severe iowait, or available memory below
  `max(2 GiB, 10% of host RAM)` stops the current phase after the sample window.
- OOM, Docker daemon failure, backend exit, host probe failure, and cleanup leak
  stop immediately.

Every phase checks the global deadline. On deadline, the current run is cleaned
up, remaining phases are skipped, and the result is marked partial with reduced
confidence. Owned containers and backend processes are cleaned in `finally`;
unrelated containers are never removed.

## Result schema and artifacts

The root JSON object contains:

- `schemaVersion` and `policyVersion`
- `startedAt`, `completedAt`, elapsed duration, and `partial`/`stopReason`
- CLI policy and phase plan
- reproducibility fingerprint: Git SHA/dirty state, host architecture/CPU/RAM,
  Docker client/server/storage details, sandbox image ID/digest, sandbox CPU/RAM
  limits, and every effective Capacity value
- raw phase measurements and samples
- safety events and cleanup verification
- recommendations with value, confidence (`HIGH`, `MEDIUM`, `LOW`), measured
  basis, and warnings

The Markdown report summarizes the same result for review. `capacity.env` is a
commented, unapplied proposal containing only directly measured recommendations;
`COMPILE_MAX_CONCURRENT` is included only when calibrated. All artifacts remain
under the ignored `capacity-test-results/` tree.

## Testing

- Pure policy tests cover input validation, bounded candidate planning, active
  selection, refinement, startup diminishing returns, timeout formulas, safety
  margins, confidence, and deadline truncation.
- Measurement tests use deterministic fake status/event/sample sources and verify
  phase separation, run-ID filtering, cleanup, and raw-data preservation.
- The existing Capacity validation test retains independent assertions for
  runtime profile, lifecycle peak, polling peak, completion, and cleanup.
- CLI smoke tests cover `--dry-run`, invalid arguments, output generation, and
  non-application of `capacity.env`.

## Documentation

Extend the authoritative Capacity documentation with the calibration command,
phase meanings, safety behavior, direct-measurement restriction, report schema,
review/apply workflow, expected runtime, and rerun triggers:
CPU/RAM allocation, Docker platform/runtime, sandbox resource limits, or major
workload changes.
