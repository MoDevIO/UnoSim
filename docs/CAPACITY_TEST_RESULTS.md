# Capacity Validation Results

## Historical validated baseline

The reproducible reference is `BASELINE`: simulation concurrency `5`,
sandbox-start concurrency `5`, and admission `25` (`5/5/25`). It is a harness
baseline, not a production recommendation.

The current harness must be run on the dedicated `UnoSim_Test` host for the
commit being measured. Receipts, logs, JSON results, and host measurements stay
under the ignored `capacity-test-results/` directory and are not committed.

## Candidate profiles

No measurements for these profiles are included in this document. They are
staging-only test profiles and must be run in order on the dedicated host.

| Profile | Simulation max | Sandbox-start max | Admission max | Status |
| --- | ---: | ---: | ---: | --- |
| `R20` | 20 | 20 | 100 | Not run |
| `R40` | 40 | 40 | 100 | Not run |
| `R60` | 60 | 60 | 100 | Not run |
| `R80` | 80 | 80 | 100 | Not run |
| `R80_BURST` | 80 | 80 | 180 | Not run |

## Queue policy limitation

Runner acquisition expires after approximately 60 seconds. A queued request
that expires receives `SYSTEM_BUSY`. A running simulation can hold its logical
runner until stopped or until its configured simulation runtime timeout; that
timeout has a 60-second default and can be configured up to 300 seconds.

Accordingly, the `80 running + 100 waiting` burst target is not yet proven
compatible with the current queue policy. Short-duration burst measurements
must not be presented as evidence that long-running classroom sessions will
keep all waiting requests admitted successfully. This validation branch does
not change that policy.
