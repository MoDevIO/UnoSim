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
  simulation capacity and not a Docker container maximum. Waiting starts are
  served oldest first, but while other subjects wait one subject holds at most
  half of these slots; alone it may use all of them.
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

## Historical baseline and manually selected Dell reference

The trusted harness baseline is 5/5/25 and remains a test baseline, not a
production recommendation.

The following measurements were made on a Dell OptiPlex 7080 with an Intel
Core i9-10900T (10 cores / 20 threads), approximately 31 GiB RAM, NVMe/SSD,
NixOS, systemd-nspawn, and native Docker overlay storage. They are reference
measurements for this workload and host, not universal guarantees. The
70/20/200 classroom point below was selected manually during the earlier
validation campaign. It is historical comparison evidence, not the current
automatic calibration result, a universal production default, or a value to
copy to another host without measuring that host.

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

### Historical manually selected classroom operating point

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

### Final automatic calibration on the Dell reference host

The merged calibration tool was then run independently with
`--expected-users 200 --target-cpu 75 --max-cpu 85 --max-user-wait 240`.
This result is the current automatic recommendation for this specific host and
workload; it does not replace the historical 70/20/200 experiment.

Directly measured active-cap candidates were:

| Active simulations | CPU p95 |
| ---: | ---: |
| 20 | 28.91% |
| 40 | 56.89% |
| 50 | 74.02% |
| 60 | 83.33% |
| 80 | 84.68% |

N=50 was directly measured and selected because it remained below the 75% CPU
target. The classroom phase reported:

- requested/admitted/started/successful: **200/200/200/200**
- rejected/failed/incomplete: **0/0/0**
- lifecycle Docker peak: **50**; polling Docker peak: **50**
- simulation peak: **50**; simulation queue peak: **150**

Simulation queue waits were p50 **89.150 s**, p95 **211.290 s**, p99
**215.782 s**, and max **218.405 s**. Authoritative sandbox-start-slot
samples were complete (**200/200**): p50 **31 ms**, p95 **17.022 s**, p99
**21.259 s**, and max **24.657 s**. Startup duration was p50 **4.502 s**,
p95 **21.674 s**, p99 **25.755 s**, and max **29.201 s**.

The validated automatic recommendations were:

    SIMULATION_MAX_CONCURRENT=50
    SANDBOX_START_MAX_CONCURRENT=8
    SIMULATION_ADMISSION_MAX=200
    SANDBOX_START_SLOT_TIMEOUT_MS=43000
    DOCKER_CONTROL_TIMEOUT_MS=2000

`COMPILE_MAX_CONCURRENT` remained not calibrated. No
`SIMULATION_QUEUE_TIMEOUT_MS` value was recommended: the technical minimum was
approximately **317 s**, which exceeds the configured **240 s** UX ceiling.
The queue result is therefore **infeasible**, not a failed calibration; it
records that this UX ceiling and workload do not fit together on this host
under the selected policy.

### Re-analysis of the Dell raw data (2026-10-09)

The retained calibration artifacts (commit `743f3d22`) change how the numbers
above must be read; the results themselves stand.

- The active-cap CPU p95 values measure the **startup storm**, not running
  simulations. Each candidate started N clients at once with N sandbox-start
  slots, so the p95 falls in the first 5–8 s of concurrent `g++` builds. Once
  all containers ran, host CPU (median) was about 4% at 20, 6% at 40, 7% at
  50, 9% at 60 and 11% at 80 running simulations (`delay()` sketch), with at
  least 14.8 GiB available. N=50 was therefore selected by startup pressure,
  not by steady-state capacity; the CPU-bound regression above
  (about 1.3% per simulation) remains the steady-state bound for sketches that
  use their full 0.25 CPU.
- The classroom phase was effectively a **burst**: its 200 requests were sent
  within 56 ms because of the arrival bug fixed in the scenario runner. A burst
  is the worse case, so the 200/200 result and the admission value remain
  valid; queue waits are slightly pessimistic.
- With 8 start slots the Dell started about 1.6–2 sandboxes per second
  (startup p50 about 4.5 s, host CPU at most 25%), slower than the about 2.7
  per second of the Ubuntu/VBox reference VM below. Each build runs inside a
  0.25-CPU sandbox, so single-thread speed sets the start rate; the 1.9 GHz
  i9-10900T gains start throughput from more start slots instead (wait p95
  20.5 s at 8 slots, 8.8 s at 16, 4.3 s at 32 for a 50-burst).

The historical measurements predate the current `main` (fair start-slot
sharing, read-only sandbox root, hard container lifetime). A delta check on
current `main` could not run on 2026-10-09 because Docker inside the Dell's
systemd-nspawn container could not start containers
(`bpf_prog_query(BPF_CGROUP_DEVICE)` denied); the temporary
`--system-call-filter=bpf` setting used for the campaign was no longer active.

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

## Reference Ubuntu/VBox VM (installer default)

Measured on 2026-10-08 on the reference VBox VM the Ubuntu/VBox installer
targets: aarch64 guest on Apple silicon, 8 vCPUs, 11 GiB RAM, **no swap**,
ext4, Docker 29.1.3 (overlayfs, cgroup v2), Ubuntu 26.04.1, kernel 7.0. The
measured commit was `main` at `d1ea0b7ab` with the production sandbox limits
(0.25 CPU / 256 MiB per sandbox), 8 sandbox-start slots, 8 compile workers and
`COMPILE_MAX_CONCURRENT=8`.

Method. A throwaway harness container built from the production image ran the
existing scenario runner against an owned test-mode backend on the VM, with the
same host paths as the production compose file and its own instance ID. Each
run started a fresh backend; 20 s idle separated runs. The production backend
stayed deployed and idle. Side samplers recorded backend RSS, sandbox cgroup
memory/CPU and `/api/health` latency every 0.5–2 s. 92 runs with 2,804 simulated learners and no harness errors: REST compile
cohorts (8/16/30 parallel), synchronous bursts (10–100), staggered arrivals
(30 over 60 s and 20 s, 40 over 20/60 s), mixed simulation plus 30 REST
compiles, several tabs per subject, and the same arrivals with a CPU-bound
sketch without `delay()`. Central scenarios ran 2–3 times; repeated runs
differed by less than about 10% in start latency and CPU.

| Scenario (8 start slots) | Success | Start p95 | Host CPU p95 / max | RAM available min | `/api/health` p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10 burst | 100% | 4.9–5.4 s | 28–31% / 32% | 6.6 GiB | 95–105 ms |
| 20 burst | 100% | 8.0–8.2 s | 38–41% / 45% | 6.3 GiB | 93–123 ms |
| 25 burst | 100% | 8.7–9.5 s | 39–42% / 48% | 6.4 GiB | 109–221 ms |
| 30 burst | 100% | 11.4–12.8 s | 46–47% / 50% | 6.1 GiB | 124–212 ms |
| 30 burst with admission 25 (old default) | 25/30, 5 × `SYSTEM_BUSY` | 8.4–8.5 s | 40–42% / 47% | 6.2 GiB | 115–214 ms |
| 30 staggered over 60 s | 100% | 2.8 s | 21–22% / 39% | 6.8 GiB | 114–117 ms |
| 30 staggered over 20 s | 100% | 2.8–2.9 s | 28–29% / 34% | 6.7 GiB | 117–169 ms |
| 30 staggered over 20 s, CPU-bound sketch | 100% | 3.1 s | 35–36% / 42% | 6.5 GiB | 196–286 ms |
| 30 staggered + 30 REST compiles | 100% | 2.9–3.2 s | 29–30% / 78% | 5.7 GiB | 117–200 ms |
| 40 staggered over 20 s | 100% | 3.0–3.1 s | 36–37% / 43% | 6.6 GiB | 161–173 ms |
| 40 staggered over 20 s, CPU-bound sketch | 100% | 3.2–3.3 s | 43% / 49% | 6.3 GiB | 387–396 ms |
| 40 staggered + 30 REST compiles | 100% | 3.0–3.1 s | 28% / 69% | 5.7 GiB | 247–282 ms |
| 30 burst, 10 subjects × 3 tabs | 100% | 10.8–11.1 s | 44–46% / 50% | 6.2 GiB | 119–210 ms |
| 30 burst + 30 REST compiles at once | 100% | 12.6 s | 83–86% / 93% | 5.6 GiB | 208–212 ms |
| 60 burst, held 90 s | 100% | 22.2–22.9 s | 52% / 57% | 5.8 GiB | 487–676 ms |
| 80 burst, held 90 s | 100% | 28.3–29.0 s | 56–58% / 64% | 5.5 GiB | 1184–1185 ms |
| 100 burst, held 90 s | 94–95% | 34.7–35.5 s | 59–60% / 73% | 5.4 GiB | 1437–1441 ms |

30 parallel REST compiles completed without `SYSTEM_BUSY` (p95 3.1–3.3 s,
host CPU p95 62–70%). A single sandbox start takes about 2.7 s; running
simulations are cheap (about 0.01 core each with `delay()`, about 0.05 core
each when CPU-bound, about 35 MiB each). Backend RSS grew with connected
simulations, from about 0.7 GiB at 10 to about 2.3 GiB at 80 (worker threads
during compile storms add up to about 1 GiB).

Saturation. The first limit is backend responsiveness, not CPU or RAM:
`/api/health` p95 grows from about 60 ms at 10 active simulations to about
0.5 s at 60 and 1.2 s at 80 while host CPU stays below 65% and at least
5.4 GiB RAM remain available. Functionally the start pipeline saturates next:
8 slots start about 2.7 simulations per second, so in a burst of 100 the last
starts exceed the 30 s start-slot timeout and fail (reproduced twice). Host CPU
only approaches saturation when a synchronous burst coincides with a REST
compile storm (max 93%).

Operating point. `SIMULATION_ADMISSION_MAX=40` keeps every measured scenario
at 100% success, including bursts, several tabs per subject, CPU-bound sketches
and concurrent compiles. It is half of the 80 simulations at which
responsiveness exceeds 1 s and two thirds of the 60 at which it reaches 0.5 s.
At 40, host CPU p95 stays at or below 43% (69–78% max during compile storms),
and at least 5.6 GiB of the 11 GiB remain available. That reserve covers Tutor
requests, browser and WebSocket traffic, garbage collection, the OS and
Docker, which is important because the VM has no swap. 40 serves about 30
learners with one simulation each plus room for extra tabs and restarts. The
Ubuntu/VBox installer writes this value; other hosts keep the application
default 25 unless calibrated.

Kept unchanged: 8 start slots (10 slots shorten a synchronous 30-burst from
about 12 s to about 8.7 s p95 at about 6 points more CPU, and 12 slots bring no
further gain; staggered arrivals never wait at 8, so 10 is a tuning option for
strictly synchronous classes, not a default), 5 admissions per subject, 8
compile workers and `COMPILE_MAX_CONCURRENT=8`, 0.25 CPU / 256 MiB per sandbox.
The compose value `SIMULATION_MAX_CONCURRENT=200` stays because admission caps
active simulations below it.

Limits of this measurement: the harness backend ran under `tsx` in test mode
without the Nginx/TLS hop, so absolute RSS is somewhat higher and gateway
overhead is not included. The VM shares its Apple host with macOS, which this
measurement cannot control. Classes noticeably above 40 simultaneous
simulations need a larger host or backend work on responsiveness rather than a
higher limit on this VM.

Earlier "classroom" scenarios of the scenario runner started every client
after one arrival interval instead of spreading them over the window, so they
were bursts; the runner now spreads arrivals evenly.

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
Do not prescribe the historical 70 active / 20 startup / 200 admission point
for a new host. Start with the host-calibration workflow below, then use the
reviewed values for acceptance. `SIMULATION_QUEUE_TIMEOUT_MS` remains a product
and UX decision; an infeasible calibration result must be resolved explicitly.

## Target-server acceptance procedure

Do not repeat the full research campaign on a target host. Run this compact
acceptance sequence:

1. Install dependencies, build the application and sandbox, and verify the
   expected Node/Docker versions.
2. Run a small real-Docker smoke test, including networking, resource limits,
   and cleanup.
3. Run `npm run capacity:calibrate -- --expected-users <expected users>`.
   Review the JSON, Markdown, and `capacity.env` output; resolve infeasible or
   omitted policy values explicitly, then apply only the reviewed values.
4. Run the intended CPU-stress active cap selected by calibration. Require
   every client to reach RUNNING, event-derived and polling-derived physical
   Docker peaks to match, CPU p95 ideally at or below 75–80%, no
   OOM/backend/Docker/parser errors, and complete cleanup.
5. Run the expected-users arrival test with the reviewed active, startup, and
   admission values. Require all expected users to be admitted, started, and
   successfully completed, zero failures/timeouts, counts within configured
   caps, and complete cleanup.
6. Verify zero active simulations, zero queue/admission reservations, zero
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

Queue waits and sandbox-start waits are measured from different sources. The
scenario runner's `queueWaitMs` is the client protocol interval from the
simulation-capacity queue to simulation-slot acquisition. Sandbox-start waits
are copied only from the test-only `capacityTest.sandboxStartWaitSamplesMs`
status field, which is populated directly from the backend
`SANDBOX_START_MAX_CONCURRENT` semaphore acquisition. A `queued` WebSocket
status or a `compilation_status` message is not a sandbox-start timing event.
Zero-wait semaphore acquisitions are retained. If the backend sample count does
not cover every startup in the scenario, sandbox-start-slot calibration is
marked invalid and `SANDBOX_START_SLOT_TIMEOUT_MS` is omitted from
`capacity.env`.

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
- `capacity.env` — an unapplied, review-only proposal containing only directly
  measured recommendations. It is intentionally allowed to be incomplete:
  omitted values can mean `not calibrated`, `infeasible`, `out of range`, or
  insufficient measurement evidence. It is not necessarily a complete
  deployment configuration and is never applied automatically.

If `SIMULATION_QUEUE_TIMEOUT_MS` is omitted because the queue result is
infeasible, do not blindly apply the remaining lines while leaving an old queue
timeout in place. Review the resulting user-wait policy and choose the queue
setting explicitly before deployment. The workflow is **Calibrate -> Review ->
Apply**.

Re-run calibration after changing CPU/vCPU allocation, RAM, Docker platform or
runtime, sandbox CPU/memory limits, or the major simulation workload. The
calibration result is host-specific evidence and does not replace the
independent assertions in `capacity-validation.test.ts` or the target-server
acceptance procedure above.
