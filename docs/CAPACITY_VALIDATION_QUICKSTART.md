# Capacity Validation Quickstart

Run this procedure only on the dedicated `UnoSim_Test` staging host. Candidate
profile values are validation inputs and must not be copied into production.

## Prepare the host

```bash
npm ci
npm run build
npm run build:sandbox
docker info
docker image inspect unosim-sandbox:latest
```

Check that the working tree is on `feature/capacity-validation` at the commit
being measured, and record host CPU, memory, and available storage outside the
repository's generated results directory.

## Run the historical baseline first

```bash
./scripts/run-capacity-tests.sh
```

This runs `BASELINE` (`SIMULATION_MAX_CONCURRENT=5`,
`SANDBOX_START_MAX_CONCURRENT=5`, `SIMULATION_ADMISSION_MAX=25`) at bursts 5,
25, and 40, then performs the six-client queue-timeout check. It writes
receipts, logs, and metrics beneath the ignored `capacity-test-results/`
directory. The receipt is tied to the current Git commit and harness contents;
rerun the baseline after any commit that changes either.

## Candidate staging ladder

After a successful baseline, proceed one profile at a time on the dedicated
host:

```bash
./scripts/run-capacity-tests.sh --profile R20 --burst 100 --dedicated-host
./scripts/run-capacity-tests.sh --profile R40 --burst 100 --dedicated-host
./scripts/run-capacity-tests.sh --profile R60 --burst 100 --dedicated-host
./scripts/run-capacity-tests.sh --profile R80 --burst 100 --dedicated-host
```

The burst candidate is separate:

```bash
./scripts/run-capacity-tests.sh --profile R80_BURST --burst 180 --dedicated-host
```

`R80_BURST` represents 80 running plus up to 100 waiting/admitted requests.
Because queued runner acquisition expires after about 60 seconds with
`SYSTEM_BUSY`, a short-run pass does not establish compatibility with long
simulation leases. Queue timeout remains a separate policy test.

Do not run candidate loads on a developer machine. Preserve each run's output
outside Git and verify cleanup before advancing to the next profile.
