# Docker Capacity Validation Plan

## Operator model

Capacity validation keeps the operator model small and separates steady-state
simulation capacity from startup pressure:

```yaml
SIMULATION_ADMISSION_MAX
          |
          v
   admitted demand
      +---+----------------+
      |                    |
      v                    v
SIMULATION_MAX_       waiting demand
CONCURRENT                  |
      |           SIMULATION_QUEUE_TIMEOUT_MS
      v
SANDBOX_START_MAX_CONCURRENT
      |
      v
Docker sandbox -> RUNNING

COMPILE_MAX_CONCURRENT  # normal source-code compilation is separate
```

- `SIMULATION_MAX_CONCURRENT` is the maximum number of active simulation
  sessions. It is the steady-state execution limit.
- `SANDBOX_START_MAX_CONCURRENT` limits Docker sandbox startup operations. It is
  acquired before `docker run` and released at `RUNTIME_START`; it is a ramp
  throttle, not compile capacity or a Docker-container maximum.
- `SIMULATION_ADMISSION_MAX` counts admitted active and waiting demands.
- `SIMULATION_QUEUE_TIMEOUT_MS` is the waiting policy for an admitted demand.
- `COMPILE_MAX_CONCURRENT` belongs to the normal source-code compilation
  subsystem and is independent of sandbox startup.
- `SandboxRunner` objects are logical implementation details. Physical Docker
  overlap must be measured from container lifecycle events.

## Targets to validate

These are validation targets, not production settings or recommendations.

**Normal classroom target**

- About 100 active students.
- Up to 80 concurrently running real Docker simulations.

**Burst target**

- Up to 80 running simulations.
- Up to 100 additional waiting requests.
- Up to 180 admitted demands in total.

The historical validated harness baseline is `5/5/25`:
`SIMULATION_MAX_CONCURRENT=5`, `SANDBOX_START_MAX_CONCURRENT=5`, and
`SIMULATION_ADMISSION_MAX=25`. Candidate values belong only to the validation
harness until measured. Production defaults are not changed by this work.

## Test-only staging profile ladder

| Profile | Simulation max | Sandbox-start max | Admission max | Purpose |
| --- | ---: | ---: | ---: | --- |
| `BASELINE` | 5 | 5 | 25 | Historical harness baseline |
| `R20` | 20 | 20 | 100 | First staging step |
| `R40` | 40 | 40 | 100 | Second staging step |
| `R60` | 60 | 60 | 100 | Third staging step |
| `R80` | 80 | 80 | 100 | Normal-classroom target |
| `R80_BURST` | 80 | 80 | 180 | Burst target |

`R20` through `R80` form the progressive `20 -> 40 -> 60 -> 80` ladder. These
profiles deliberately require `sandboxStartMaxConcurrent >=
simulationMaxConcurrent` so startup throttling does not confound physical
capacity measurements. Queue timeout is supplied as a separate policy value,
not baked into a physical profile.

## Confirmed queue limitation

- Runner acquisition currently times out after approximately 60 seconds.
- A queued request that reaches that timeout receives `SYSTEM_BUSY` and leaves
  the queue.
- A running simulation may hold its logical runner until it stops or reaches
  its configured runtime timeout (60 seconds by default, up to 300 seconds).
- Therefore, `80 running + 100 waiting` is not yet proven compatible with the
  current queue policy. Do not infer that policy result from short bursts.

This branch measures the existing policy; it does not change queue behavior.

## Harness and isolation

`scripts/run-capacity-tests.sh` starts and owns a backend on a random loopback
port. Before load, the harness checks `/api/readiness`, verifies the semantic
`capacity.*` status values and the unique capacity run ID, and refuses a
profile whose startup limit is below its simulation limit.

Every simulation container receives a run-specific Docker label. Teardown
stops the owned backend and removes only containers carrying that exact run ID.
The test reconstructs physical overlap from `docker events` and records the
independent polling sample as corroboration.

The default command runs only the historical baseline: bursts of 5, 25, and
40 clients followed by the six-client queue-timeout check. Candidate profiles
require that baseline receipt and the explicit `--dedicated-host` flag.

## Measurements and artifacts

Receipts contain the effective simulation, sandbox-start, admission, queue
policy, and compile values. Metrics include logical active simulations,
startup active/waiting, admission and queue peaks, lifecycle-event Docker
peak, sampled Docker peak, start latency, simulation leases, errors, dropped
serial/pin messages, and leaks.

Receipts, logs, JSON results, and host-specific measurements are written under
`capacity-test-results/`, which is ignored by Git. Do not commit generated
artifacts.
