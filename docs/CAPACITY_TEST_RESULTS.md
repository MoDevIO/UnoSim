# Capacity Validation Results

## Historical validated baseline

The historical harness baseline is `BASELINE` with `MIN_RUNNERS=5`,
`MAX_RUNNERS=5`, and `ADMISSION=25` (`5/5/25`). It is retained as the
reproducible reference baseline, not as a recommendation for future production
capacity.

The current harness must be run on `UnoSim_Test` after checkout to create a
receipt for the current commit. Run-specific receipts, logs, JSON results, and
host measurements stay under the ignored `capacity-test-results/` directory
and are not committed.

## Candidate profiles

No measurements for these profiles are included in this document. They are
staging-only test profiles and must be run in order on the dedicated host.

| Profile | Min / max runners | Admission max | Status |
| --- | ---: | ---: | --- |
| `R20` | 5 / 20 | 100 | Not run |
| `R40` | 5 / 40 | 100 | Not run |
| `R60` | 10 / 60 | 100 | Not run |
| `R80` | 10 / 80 | 100 | Not run |
| `R80_BURST` | 10 / 80 | 180 | Not run |

## Queue policy limitation

Runner acquisition expires after approximately 60 seconds. A queued request
that expires receives `SYSTEM_BUSY`. A running simulation can hold its runner
until stopped or until its configured simulation runtime timeout; that timeout
has a 60-second default and can be configured up to 300 seconds.

Accordingly, the `80 running + 100 waiting` burst target is not yet proven
compatible with the current queue policy. Short-duration burst measurements
must not be presented as evidence that long-running classroom sessions will
keep all waiting requests admitted successfully. This validation branch does
not change that policy.
