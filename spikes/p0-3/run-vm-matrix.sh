#!/bin/sh
# Synthetic low-end matrix for P0.3: the measuring page in Linux containers of the Docker Desktop VM,
# pinned to 1 or 2 CPUs and limited to 2 or 4 GB, with Chromium and Firefox. Not real school devices.
# Usage: spikes/p0-3/run-vm-matrix.sh [output dir]      (needs Docker and the Playwright image)
set -eu
cd "$(dirname "$0")/../.."
OUT="${1:-docs/proposals/results/p0-3}"
IMAGE="mcr.microsoft.com/playwright:v$(node -p "require('@playwright/test/package.json').version")-noble"
node spikes/p0-3/build.mjs
mkdir -p "$OUT"
for config in "1 2g" "2 4g"; do
  set -- $config
  cpus=$1; mem=$2
  cpuset=$(awk -v n="$cpus" 'BEGIN { s = "0"; for (i = 1; i < n; i++) s = s "," i; print s }')
  for browser in chromium firefox; do
    name="${cpus}vcpu-${mem}-${browser}"
    echo "== $name"
    docker run --rm --platform linux/arm64 --cpuset-cpus="$cpuset" --memory="$mem" --memory-swap="$mem" --ipc=host \
      -v "$PWD:/work:ro" -v "$PWD/$OUT:/out" -w /work "$IMAGE" \
      node spikes/p0-3/run-matrix.mjs --browser "$browser" --out "/out/$name.json" --repeat 3
  done
done
