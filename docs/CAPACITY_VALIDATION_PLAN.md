# Docker Capacity Validation Plan

## Targets to validate

These are validation targets, not production settings or recommendations.

**Normal classroom target**

- About 100 active students.
- Up to 80 concurrently running real Docker simulations.

**Burst target**

- Up to 80 running simulations.
- Up to 100 additional waiting requests.
- Up to 180 admitted demands in total.

The historical validated harness baseline is `5/5/25` (`MIN_RUNNERS=5`,
`MAX_RUNNERS=5`, `ADMISSION=25`). Candidate values belong only to the
validation harness until measured. Production defaults and deployment
configuration are not changed by this work.

## Staging profile ladder

| Profile | Min runners | Max runners | Admission max | Purpose |
| --- | ---: | ---: | ---: | --- |
| `BASELINE` | 5 | 5 | 25 | Historical harness baseline |
| `R20` | 5 | 20 | 100 | First staging step |
| `R40` | 5 | 40 | 100 | Second staging step |
| `R60` | 10 | 60 | 100 | Third staging step |
| `R80` | 10 | 80 | 100 | Normal-classroom target |
| `R80_BURST` | 10 | 80 | 180 | Burst target |

`R20` through `R80` form the progressive `20 -> 40 -> 60 -> 80` staging
ladder. Every candidate is a test profile only. Run candidates only on the
dedicated staging host, after the current commit's complete baseline receipt
has been written.

## Confirmed queue limitation

- Runner acquisition has an approximately 60-second timeout.
- A queued request that reaches that timeout receives `SYSTEM_BUSY` and leaves
the queue.
- A running simulation can hold its runner until it stops or reaches its
  configured simulation runtime timeout. The runtime timeout defaults to 60
  seconds and can be configured up to 300 seconds.
- Therefore, `80 running + 100 waiting` is not yet proven compatible with the
  current queue policy. Short burst results do not demonstrate that requests
  will wait successfully behind long-running simulations.

This branch measures the current policy; it does not change queue timeout,
queueing, or simulation behavior.

## Harness and isolation

`scripts/run-capacity-tests.sh` starts and owns a backend on a randomly chosen
loopback port. Before load, the harness checks `/api/readiness` and verifies
Docker mode, min/max runners, admission limit, and the unique capacity run ID
reported by `/api/status`. It does not accept a pre-existing backend URL.

Every simulation container receives a run-specific Docker label. Teardown
stops the owned backend and removes only containers carrying that exact run
ID. The test verifies that the backend has drained and that no run-owned
containers remain.

The default command runs only the historical baseline: bursts of 5, 25, and
40 clients followed by the six-client queue-timeout check. Candidate profiles
require that baseline receipt and the explicit `--dedicated-host` flag.

## Measurements and artifacts

The harness records profile values, start and queue latency, runner and
admission peaks, Docker container counts, simulation leases, errors, dropped
serial/pin messages, and leaked containers. Receipts, logs, and JSON results
are written under `capacity-test-results/`, which is ignored by Git. Do not
commit host-specific measurements or generated run artifacts.
