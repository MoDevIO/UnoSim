# Capacity validation plan and operating model

This is the authoritative description of UnoSim's simulation capacity model,
its timeout boundaries, and the validation evidence. Validation profiles are
test inputs; they do not silently change production sizing.

## Operator model

The request lifecycle is:

    admission
        |
        v
    simulation queue -------------------- SIMULATION_QUEUE_TIMEOUT_MS
        |
        v
    simulation slot acquired
        |
        v
    sandbox-start-slot wait ------------- SANDBOX_START_SLOT_TIMEOUT_MS
        |
        v
    sandbox startup / compile ----------- internal startup watchdog
        |
        v
    RUNTIME_START
        |
        v
    simulation runtime ------------------ timeoutSec
        |
        v
    completion / cleanup

    Docker control health checks -------- DOCKER_CONTROL_TIMEOUT_MS

The settings have separate responsibilities:

- SIMULATION_MAX_CONCURRENT is the maximum number of simulations holding an
  active simulation slot. It is steady-state execution capacity.
- SIMULATION_ADMISSION_MAX is the maximum total admitted demand, including
  active and waiting simulations.
- SIMULATION_QUEUE_TIMEOUT_MS is the maximum time an admitted request may wait
  for a simulation slot. It is a queue policy, not physical capacity.
- SANDBOX_START_MAX_CONCURRENT limits Docker sandbox startup/compile operations
  in flight. The slot is acquired before docker run and released at the first
  valid RUNTIME_START or on an error. It is startup pressure, not steady-state
  simulation capacity and not a Docker container maximum.
- SANDBOX_START_SLOT_TIMEOUT_MS limits how long an already admitted request may
  wait for a sandbox-start slot. It is separate from the simulation queue,
  startup watchdog, and runtime timeout.
- The internal sandbox startup watchdog protects compilation/startup until
  RUNTIME_START. It is derived from the sandbox execution limit
  (SANDBOX_CONFIG.maxExecutionTimeSec, 60 seconds by default) and is not an
  operator-facing capacity setting.
- timeoutSec is the simulation runtime limit. It starts once, at the first
  valid RUNTIME_START marker, and does not include compile/startup time. The
  current input default is 60 seconds and the accepted range is 1–300 seconds.
- DOCKER_CONTROL_TIMEOUT_MS is a short wall-clock timeout for Docker
  availability/control probes used by SandboxRunner.checkDockerAsync():
  docker --version, docker info, and docker image inspect. It does not control
  simulation admission, sandbox startup, or simulation runtime.
- COMPILE_MAX_CONCURRENT limits the normal source-code compilation subsystem.
  It is independent of Docker sandbox startup. WORKER_COUNT is the worker-thread
  implementation setting behind that subsystem.

SandboxRunner objects are logical implementation details. Physical Docker
overlap is measured from container lifecycle events and corroborated with
polling; it must not be inferred from runner-object counts.

The runtime status endpoint exposes the semantic groups
capacity.simulation, capacity.sandboxStart, capacity.admission, capacity.queue,
and capacity.compile. Startup output uses the same grouped labels, and
capacity receipts record the effective simulation, sandbox-start, admission,
queue, and compile values plus the test run ID. Legacy runner and compile-slot
fields remain diagnostic compatibility fields; they are not the operator
capacity model.

## Production defaults from the implementation

The defaults below are used when the corresponding environment variable is
absent:

| Setting | Default | Meaning |
| --- | ---: | --- |
| SIMULATION_MAX_CONCURRENT | 5 | Active simulation slots |
| SANDBOX_START_MAX_CONCURRENT | 8 | Concurrent sandbox starts |
| SIMULATION_ADMISSION_MAX | 25 | Active plus waiting admissions |
| SIMULATION_QUEUE_TIMEOUT_MS | 60000 | Wait for a simulation slot |
| SANDBOX_START_SLOT_TIMEOUT_MS | 30000 | Wait for a startup slot |
| DOCKER_CONTROL_TIMEOUT_MS | 2000 | Docker control/availability probes |
| COMPILE_MAX_CONCURRENT | max(1, CPU count - 1) | Source compilation gate |
| WORKER_COUNT | min(8, max(2, floor(CPU count / 2))) | Compile worker threads |
| sandbox startup watchdog | 60000 ms | Internal protection before RUNTIME_START |
| timeoutSec | 60 s | Runtime after RUNTIME_START |

The application defaults above come from server/config.ts. The Compose files
may supply explicit deployment values: the current production compose file
sets SIMULATION_MAX_CONCURRENT=200, while the deployment fixture uses 1 for
isolated deployment tests. Those are deployment policies, not application
defaults, and this documentation does not change them. A target host should
use an explicitly reviewed operating point rather than inheriting a test or
legacy override blindly. Obsolete topology names (SANDBOX_POOL_MIN_RUNNERS,
SANDBOX_POOL_MAX_RUNNERS, and DOCKER_COMPILE_CONCURRENT) are rejected rather
than silently accepted; they may appear only in migration or historical
documentation.

## Test-only physical profiles

The harness staging ladder is centralized in
scripts/capacity-validation-config.ts:

| Profile | Simulation max | Sandbox-start max | Admission max |
| --- | ---: | ---: | ---: |
| BASELINE | 5 | 5 | 25 |
| R20 | 20 | 20 | 100 |
| R40 | 40 | 40 | 100 |
| R60 | 60 | 60 | 100 |
| R80 | 80 | 80 | 100 |
| R80_BURST | 80 | 80 | 180 |

R20 through R80 form the 20 -> 40 -> 60 -> 80 staging ladder. Physical
profiles require sandbox-start concurrency at least as high as simulation
concurrency so startup throttling does not confound physical overlap
measurements. Queue timeout is supplied separately as a policy value.

R80_BURST represents 80 running plus up to 100 waiting/admitted requests. A
queued request currently receives SYSTEM_BUSY after the runner acquisition
policy expires at approximately 60 seconds, while a running simulation may
hold a runner until it stops or reaches its runtime timeout. Therefore the
80-running-plus-100-waiting policy scenario remains unproven under long
simulation leases; the profile is not a production recommendation.

## Historical baseline and validated Dell reference

The trusted harness baseline is 5/5/25 and remains a test baseline, not a
production recommendation.

The following measurements were made on a Dell OptiPlex 7080 with an Intel
Core i9-10900T (10 cores / 20 threads), approximately 31 GiB RAM, NVMe/SSD,
NixOS, systemd-nspawn, and native Docker overlay storage. They are reference
measurements for this workload and host, not universal guarantees.

### CPU-intensive physical scaling

| Active simulations | Host CPU p95 |
| ---: | ---: |
| 5 | 8.69% |
| 10 | 13.68% |
| 20 | 26.27% |
| 40 | 52.97% |
| 60 | 80.29% |

The measured regression through N=60 was approximately
CPU p95 = 0.934 + 1.313 × N with R² ≈ 0.999. N=80 then passed strict
verification with 80/80 clients running, an event-derived Docker peak of 80,
an independent polling peak of 80, no OOM/backend/Docker/parser failures, and
complete cleanup.

### Validated classroom operating point

The successful 200-student run used:

    SIMULATION_MAX_CONCURRENT=70
    SANDBOX_START_MAX_CONCURRENT=20
    SIMULATION_ADMISSION_MAX=200
    SANDBOX_START_SLOT_TIMEOUT_MS=90000   (test override only)
    SIMULATION_QUEUE_TIMEOUT_MS=300000    (test override only)

It admitted and completed 200/200 students with zero failures. Peak active
simulations were 70, peak simulation queue 130, peak sandbox-start activity
20, and physical Docker peak 70 by both lifecycle events and polling. There
were no queue, startup-slot, runtime, parser, backend, Docker, or OOM errors.
Queue wait was p50 74.411 s, p95 135.707 s, and max 136.963 s. Sandbox-start
slot wait was p95 approximately 8.664 s and max approximately 12.856 s.

The experiment used a 90-second startup-slot wait to measure the phase safely;
the observed maximum was below 30 seconds, so the normal production default of
SANDBOX_START_SLOT_TIMEOUT_MS=30000 is sufficient for this validated point.
The 90-second value must not be copied into production.

The earlier SANDBOX_START_MAX_CONCURRENT=8 classroom run completed 194/200;
six admitted requests timed out waiting for a startup slot. This explains why
startup-slot wait and simulation queue wait must be measured separately.

## Secondary Mac comparison

A short comparison used a MacBook Pro M2 Pro (10 CPU cores, 32 GiB RAM) with
Docker Desktop allocated 10 CPUs and approximately 25.4 GB RAM on aarch64.
The same CPU-intensive workload and 0.25 CPU / 256 MiB sandbox limits were
used. Docker Desktop docker info calls reached approximately 2.61 seconds p95
at 40 parallel calls, exceeding the 2-second production Docker-control probe
default. The benchmark used the explicit development override
DOCKER_CONTROL_TIMEOUT_MS=10000; production remained at 2000 ms.

After that override, N=40, N=60, and N=80 each reached full physical overlap
and all clients reached RUNNING. Comparable plateau CPU p95 values were:

| Active simulations | Mac Docker Desktop CPU p95 |
| ---: | ---: |
| 20 | 78.34% |
| 40 | 99.99% |
| 60 | 99.99% |
| 80 | 99.99% |

The Mac/Docker Desktop stack saturated materially earlier for this workload
than the Dell Linux/Docker stack. These percentages are not a CPU
microbenchmark: Docker Desktop virtualization, different CPU topology, and
background workloads affect them. The Mac data is secondary calibration and
does not replace Dell evidence.

## Preliminary target-server sizing

The current evidence supports a cautious starting range rather than a final
capacity guarantee:

- 16 modern server/cloud vCPUs is a lower acceptance candidate.
- 24 vCPUs is the preferred initial production candidate.
- 32 vCPUs is a comfortable option when the cost difference is acceptable.
- Use 64 GiB RAM, fast local NVMe/SSD, and at least 100 GiB free storage.
- Preserve approximately 20–30% CPU headroom during normal operation.

Dell hardware threads and Apple CPU cores are not directly equivalent to cloud
or server vCPUs. Final sizing must be confirmed on the actual target host.
Initial target-host settings should start conservatively near the validated
classroom point (70 active, 20 startup, 200 admissions, and a 30-second
startup-slot timeout). SIMULATION_QUEUE_TIMEOUT_MS remains a product and UX
decision pending target-host acceptance; the Dell classroom test used 300000 ms
conservatively.

## Target-server acceptance procedure

Do not repeat the full research campaign on a target host. Run this compact
acceptance sequence:

1. Install dependencies, build the application and sandbox, and verify the
   expected Node/Docker versions.
2. Run a small real-Docker smoke test, including networking, resource limits,
   and cleanup.
3. Run the intended CPU-stress active cap. Require every client to reach
   RUNNING, event-derived and polling-derived physical Docker peaks to match,
   CPU p95 ideally at or below 75–80%, no OOM/backend/Docker/parser errors, and
   complete cleanup.
4. Run the 200-student arrival test with active simulations capped at 70.
   Require 200 admitted, 200 completed, zero failures/timeouts, active and
   startup counts within their configured caps, and complete cleanup.
5. Verify zero active simulations, zero queue/admission reservations, zero
   startup waiters, zero labeled containers, and a healthy Docker daemon.

Receipts must record the effective simulation, startup, admission, queue,
compile, and timeout values. Generated receipts, logs, and host measurements
remain under the ignored capacity-test-results/ directory.

## Host-capacity calibration workflow

Use the calibration command when a host, Docker runtime, sandbox resource
limit, or CPU-intensive workload changes materially:

    npm run capacity:calibrate -- --expected-users 200

The command follows **Calibrate -> Review -> Apply**. It measures Docker
control latency, directly measured active-simulation candidates, startup
concurrency candidates, and (unless `--skip-classroom` is supplied) a
controlled expected-users arrival phase. Classroom simulations have a fixed
60-second active duration so results remain comparable between hosts. The
optional compile-concurrency phase is not run in version 1; its result is
reported as `not calibrated` and the existing derived value is preserved.

Before load, the tool records the Git SHA and dirty state, Node and host
architecture/CPU information, Docker health/version/architecture/visible
resources/storage driver, sandbox image ID/digest, effective capacity values,
and usable CPU and memory safety signals. Physical RAM, load, swap, iowait,
thermal pressure, and per-process measurements are enrichment probes. Missing
enrichment values are recorded as `null`; load is refused when no usable CPU
or memory safety signal exists. Existing unrelated containers are never
stopped.

Recommendations are policy output, not automatic configuration. Active and
startup values are emitted only when the corresponding candidate was directly
measured, stable, and clean. The policy never extrapolates a value into the
proposal. Queue timeout output shows measured p95/p99/max, a technical minimum,
and the UX ceiling (`--max-user-wait`); if the technical minimum exceeds the
ceiling, the result is marked infeasible and no insufficient timeout is
recommended. Docker-control and startup-slot timeout recommendations likewise
show their measured basis and omit out-of-range values rather than clamping
them silently.

The classroom phase uses a separate measurement-only queue timeout. It is
`max(production queue timeout, max-user-wait + fixed classroom duration +
30 seconds)` and is recorded in the report; it is never copied into
`capacity.env`. This prevents the production queue timeout from censoring the
wait distribution. A classroom result is valid only when every requested client
reaches `RUNNING` and completes successfully. `SYSTEM_BUSY` is a rejection,
terminal protocol states are retained separately from successful completion,
and WebSocket connection time is not reported as application admission. If any
client is rejected, failed, or incomplete, admission and queue recommendations
are diagnostic only. When coarse active candidates bracket the target CPU, the
policy measures bounded intermediate candidates before selecting a directly
measured value.

The default policy is bounded by `--max-duration 30` minutes and uses sustained
CPU, memory, and iowait safety observations. OOM, Docker/backend failure, host
probe failure, and cleanup leaks stop immediately. A deadline or safety stop
cleans the owned backend and exact run-ID containers, writes a partial report,
and lowers confidence. Production configuration is never modified.

Each run writes these review artifacts below the ignored output directory (by
default `capacity-test-results/calibration-<timestamp>/`):

- `capacity-calibration.json` — schema/policy versions, reproducibility
  fingerprint, raw phase measurements, safety events, cleanup state, and
  recommendations.
- `capacity-calibration.md` — human-readable summary with measured basis,
  technical/UX timeout values, warnings, and confidence.
- `capacity.env` — an unapplied proposal containing only directly measured
  recommendations. Review it and apply values through the normal deployment
  process only after an operator decision.

Re-run calibration after changing CPU/vCPU allocation, RAM, Docker platform or
runtime, sandbox CPU/memory limits, or the major simulation workload. The
calibration result is host-specific evidence and does not replace the
independent assertions in `capacity-validation.test.ts` or the target-server
acceptance procedure above.
