# ADR 0003: Scalability and HA model

- Status: Accepted
- Date: 2026-09-06
- Owners: UnoSim maintainers and platform operators
- Records: accepted scalability / HA decision based on the Phase 3.4 measurements

## Context

Phase 3.4 measured UnoSim capacity with real Docker compile and simulation load.
The measurement profile intentionally kept the existing production-like runner
and resource configuration unchanged:

- one stateful backend node
- WebSocket simulation sessions held in process memory
- fixed SandboxRunnerPool of 5 runners
- runner acquire timeout of 60 seconds
- Docker compile worker pool of 8 workers
- Docker compile concurrency of 8
- sandbox memory limit of 256 MB
- sandbox CPU limit of 0.25
- real Docker simulation mode, no mocks or stubs

Measured results:

| Area | Result | Assessment |
|---|---:|---|
| Compile 50 clients | 50/50 successful | PASS |
| Compile 100 clients | 100/100 successful | PASS |
| Compile 200 clients | 200/200 successful | PASS |
| Simulation/WS/Runner 50 clients | 50/50 successful | PASS |
| Simulation/WS/Runner 100 clients | 100/100 successful | PASS |
| Simulation/WS/Runner 200 clients | 126/200 successful, 74 timeouts/errors | FAIL |

The failed 200-client simulation still established 200 WebSocket connections and
received 200 first outputs. The failure happened because 74 sessions did not
acquire a sandbox runner before the 60-second acquire timeout. The bottleneck is
the combination of the fixed 5-runner SandboxRunnerPool and the 60-second
acquire timeout. The run did not show serial or telemetry drops, and cleanup was
clean after follow-up verification: no active sessions, empty runner queue, all
5 runners available, and no `unosim-sandbox-*` Docker container leaks.

Phase 3.4 explicitly did not increase timeouts, pool sizes, CPU limits, memory
limits, or any other capacity parameter to make the 200-client simulation pass.
The measured limit is therefore the capacity of the current model, not an
optimized target.

## Decision

UnoSim accepts the current **single-stateful-node** architecture as the operating
model for the measured Phase 3.4 capacity envelope:

- Compile workload is accepted up to 200 concurrent clients under the measured
  Docker compile profile.
- Real Docker simulation/WebSocket/Runner workload is accepted up to 100
  concurrent simulation clients under the measured 5-runner profile.
- 200 concurrent real Docker simulation clients are **not** accepted under the
  current profile.

No HA implementation, runner-pool expansion, resource-limit change, or timeout
increase is part of Phase 3.8. Higher simulation parallelism requires a separate
architecture and capacity phase with its own design, tests, operational limits,
and release criteria.

## Consequences

- Operators may run the current model only within the documented measured
  envelope. The current 5-runner single-node deployment must not be advertised
  as supporting 200 concurrent real Docker simulations.
- The accepted capacity boundary is evidence-based: 100 concurrent real Docker
  simulations pass; 200 fail because queued sessions exceed the runner acquire
  timeout.
- Increasing the acquire timeout alone is not an acceptable Phase 3.4/3.8 fix,
  because it would hide queue pressure rather than change service capacity.
- Increasing runner count, splitting sessions across nodes, moving state out of
  process memory, or introducing HA/session affinity are follow-up architecture
  topics, not changes to this decision.
- Release and operations documentation must distinguish compile scalability from
  simulation concurrency.

## Follow-up work

If product requirements demand more than 100 concurrent real Docker simulation
clients, create a separate capacity/architecture work item covering at least:

1. target concurrency and service-level objectives for simulation start and
   first-output latency;
2. SandboxRunnerPool sizing model and Docker host resource budget;
3. queue timeout policy and overload/backpressure behavior;
4. state ownership for WebSocket sessions, runner leases, and cleanup;
5. single larger node versus horizontally scaled nodes with gateway routing or
   session affinity;
6. repeatable 50/100/200+ real Docker tests with unchanged documented profiles
   per candidate architecture;
7. release-gate updates and operator runbooks.

Until that follow-up is completed, the accepted operating model remains a single
stateful node with validated real Docker simulation capacity up to 100
concurrent clients.

## Rejected alternatives

- **Mark 200 simulations as passed by raising the 60-second acquire timeout:**
  rejected because it changes the measurement boundary and masks the 5-runner
  bottleneck without proving more processing capacity.
- **Increase SandboxRunnerPool size in Phase 3.8:** rejected because Phase 3.8 is
  an architecture decision step, not a capacity implementation step.
- **Claim horizontal scalability without redesign:** rejected because current
  WebSocket sessions, runner leases, and cleanup are stateful within one backend
  process.
- **Treat compile success at 200 as simulation success at 200:** rejected because
  compile and simulation exercise different bottlenecks.
