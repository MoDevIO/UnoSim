# Capacity validation results

This document summarizes the measured reference results. The operating model,
timeout boundaries, production defaults, and acceptance procedure are
authoritative in CAPACITY_VALIDATION_PLAN.md.

## Historical harness baseline

The reproducible BASELINE is 5 simulation slots, 5 sandbox-start slots, and 25
admissions (5/5/25). It is a trusted harness baseline, not a production
recommendation. Receipts and raw host measurements remain in the ignored
capacity-test-results/ directory.

## Dell CPU-intensive scaling

The Dell OptiPlex 7080 reference host had an Intel Core i9-10900T, 10 cores /
20 threads, approximately 31 GiB RAM, NVMe/SSD, NixOS, systemd-nspawn, and
native Docker overlay storage.

| Active simulations | CPU p95 | Result |
| ---: | ---: | --- |
| 5 | 8.69% | clean |
| 10 | 13.68% | clean |
| 20 | 26.27% | clean |
| 40 | 52.97% | clean |
| 60 | 80.29% | clean |
| 80 | not retained in the summary | strict pass |

Strict N80 verification reached 80/80 RUNNING, an event-derived physical
Docker peak of 80, a polling peak of 80, and complete cleanup without
OOM, backend, Docker, or marker/parser errors. The CPU p95 value for N80 is
not stated because the retained result did not include it.

## Dell classroom validation

The successful classroom run used 70 active simulations, 20 sandbox-start
slots, 200 admissions, a 300000 ms test queue timeout, and a 90000 ms
test-only startup-slot wait timeout.

Results:

- 200 admitted, 200 completed, 0 failed.
- Peak active simulations: 70.
- Peak simulation queue: 130.
- Peak sandbox-start activity: 20.
- Physical Docker peak: 70 by lifecycle events and polling.
- Queue wait: p50 74.411 s, p95 135.707 s, max 136.963 s.
- Sandbox-start wait: p95 approximately 8.664 s, max approximately 12.856 s.
- No queue timeout, startup-slot timeout, runtime timeout, marker/parser error,
  backend/Docker failure, OOM, or cleanup leak.

The earlier start=8 experiment completed 194/200. Six requests timed out while
waiting for one of the eight sandbox-start slots. The later start=20 result
eliminated those failures. The normal production
SANDBOX_START_SLOT_TIMEOUT_MS default remains 30000 ms because the observed
maximum wait was below 30 seconds; 90000 ms was only a test override.

## Mac comparison

The MacBook Pro M2 Pro comparison used 10 Docker Desktop CPUs, approximately
25.4 GB Docker RAM, aarch64, and the same CPU-intensive workload and sandbox
resource limits. A 2-second Docker control probe was too short for a burst of
docker info calls (approximately 2.61 s p95 at 40 parallel calls). The
benchmark used DOCKER_CONTROL_TIMEOUT_MS=10000; production remains 2000 ms.

After the benchmark override, N40, N60, and N80 each reached full physical
overlap and all clients reached RUNNING. Plateau CPU p95 was 78.34% at N20 and
99.99% at N40, N60, and N80. Docker Desktop therefore saturated earlier for
this workload than the Dell Linux/Docker stack. This is secondary calibration,
not target-server sizing evidence.

## Candidate profiles

The profiles below remain test-only:

| Profile | Simulation max | Sandbox-start max | Admission max |
| --- | ---: | ---: | ---: |
| BASELINE | 5 | 5 | 25 |
| R20 | 20 | 20 | 100 |
| R40 | 40 | 40 | 100 |
| R60 | 60 | 60 | 100 |
| R80 | 80 | 80 | 100 |
| R80_BURST | 80 | 80 | 180 |

The 80-running-plus-100-waiting policy scenario is not proven compatible with
long simulation leases while the existing approximately 60-second runner
acquisition policy remains in place. Do not present R80_BURST as a production
guarantee.
