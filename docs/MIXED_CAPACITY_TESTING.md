# Mixed Capacity Measurement

This procedure measures REST Arduino compiles, simulation starts, and active
simulations together. It records observations; it does not set production
limits or judge a run against assumed thresholds.

## Preconditions

- Run on the actual target Linux host, or a dedicated staging host whose CPU,
  RAM, storage, kernel, Docker Engine, and sandbox image match the target.
- Use a local Docker Engine Unix socket on the same host being sampled. Remote
  Docker contexts are rejected because they would sample the wrong machine.
- Build the sandbox image and install the project dependencies before the run:

  ```sh
  npm install
  npm run build:sandbox
  ```

- The host must have Arduino CLI 1.5.1 and the `arduino:avr` core installed.
  The runner checks the CLI version and includes both versions in its report.
  Install the pinned CLI with `sh scripts/install-arduino-cli.sh`; install the
  core with `arduino-cli core install arduino:avr` if it is missing.

- The harness starts and stops its own test-mode backend and only labels and
  cleans containers owned by its run ID. It disables rate limiting for the
  controlled workload and uses the test-only gateway bypass. It makes no Tutor
  or model-provider requests.

## Run

For example, on an isolated target or representative staging host:

```sh
scripts/run-mixed-capacity-test.sh \
  --target-label staging-linux-01 \
  --target-kind representative-staging \
  --profile BASELINE \
  --burst 5 \
  --rest-compiles 16 \
  --rest-compile-concurrency 8 \
  --hold-ms 60000 \
  --simulation-timeout-sec 120 \
  --dedicated-host
```

The two workloads start concurrently. The 60-second simulation hold keeps
simulations running while the compile batch is in flight. The run ID makes
every REST source unique to avoid treating a prior compile cache hit as fresh
work.

This harness starts the test-mode Node backend directly on the sampled host;
it runs simulations in real Docker sandboxes but does not put the backend in
the production server container or reproduce that container's cgroup limits.
The artifact reports host and Docker capacity. If production applies backend
container CPU or memory limits, those limits need a separate production-shaped
run before choosing a deployment limit.

The default artifact directory is `capacity-test-results/`; each run writes a
JSON report with a unique run ID. Set `CAPACITY_TEST_OUTPUT_DIR` to choose a
different directory. The report includes the Git state, OS/kernel and CPU
fingerprint, Docker fingerprint, effective runtime limits, every REST status
and latency, Arduino CLI/core versions, sampled CPU, Linux `MemAvailable` and swap, simulation start and
queue latencies, observed active parallelism, compiler queue depth/wait
metrics, errors, and cleanup state.

## Interpreting Results

Use the raw samples and workload parameters from the report. CPU, Linux
`MemAvailable`, and swap are sampled on the host once per second.
Status and queue counters are sampled every 250 ms, so brief peaks can fall
between samples. Docker lifecycle events and container polling provide two
parallelism observations. Compiler average and maximum queue wait cover tasks
that were dispatched to a worker; REST failures and 503 responses remain
separately visible in the per-request results.

No production capacity values were measured as part of adding this procedure.
The available development machine is macOS with Docker Desktop and has not been
confirmed as the target server. Do not use its theoretical resources or local
measurements to choose production concurrency. That decision requires a run on
the actual target hardware with a documented workload and reviewed report.
