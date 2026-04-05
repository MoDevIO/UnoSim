#!/usr/bin/env sh
set -eu

docker build -f Dockerfile.sandbox -t unosim-sandbox:latest .
