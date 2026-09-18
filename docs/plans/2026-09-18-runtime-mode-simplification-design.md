# Runtime Mode Simplification Design

**Date:** 2026-09-18

## Goal

UnoSim supports exactly two operating profiles:

1. `local`: the server, compiler, and simulation run on the development host.
2. `docker`: the server runs in Docker and every simulation runs in a Docker sandbox behind the authenticated gateway.

Docker integration tests may bypass the gateway only when `NODE_ENV=test` and an explicit test-only flag is enabled. This is a test fixture, not a deployment profile.

## Configuration contract

`UNOSIM_SERVER_MODE=local|docker` is the single topology selector.

- `local` derives local session authentication and local simulation.
- `docker` derives gateway authentication and Docker sandbox simulation.
- `UNOSIM_DOCKER_TEST_BYPASS_GATEWAY=1` is accepted only with `NODE_ENV=test` and `UNOSIM_SERVER_MODE=docker`.

The following independent or legacy selectors are removed and rejected when present:

- `UNOSIM_SIMULATION_MODE`
- `UNOSIM_TRUST_MODE`
- `FORCE_DOCKER`
- `UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL`

Valid environment combinations are:

| `NODE_ENV` | `UNOSIM_SERVER_MODE` | Authentication | Simulation |
| --- | --- | --- | --- |
| development/test | local | local session | local process |
| production | docker | gateway | Docker sandbox |
| test | docker + explicit bypass | local test session | Docker sandbox |

Production local mode, development Docker mode, and test bypasses outside Docker tests fail during configuration.

## Runtime behavior

Local mode never probes Docker and always uses the local execution path.

Docker mode checks the daemon and sandbox image and always uses the Docker execution path. It never falls back to a native process. Readiness remains false when Docker is unavailable.

The independent simulation router and mixed-mode guards are removed. Compiler worker selection continues to follow the server profile; compilation fallback behavior is otherwise unchanged because it is fault handling rather than an operating mode.

## Public surface

`serverMode: "local" | "docker"` remains the only public operating-mode field.

The redundant `simulationMode` field is removed from `/api/config` and `/api/status`. The per-message `sandboxMode` field, its client state, and its debug display are removed because execution mode is fixed by the server profile.

## Scripts, Docker, and CI

Development and E2E scripts use the local profile. Docker Compose uses the Docker profile with gateway configuration. Docker integration tests use the Docker profile plus the test-only gateway bypass.

The public `dev:lan` variant and legacy Docker selector are removed. The Playwright CI job no longer builds an unused sandbox image; the Docker integration job remains responsible for real sandbox validation.

## Documentation and cleanup

The root README keeps its current structure and wording wherever possible. Only incorrect mode descriptions, variables, commands, and links are corrected.

Current operational documents are updated to describe the two profiles. Historical plans, reports, assessments, Docker-without-gateway instructions, committed load-test outputs, and unreferenced helper scripts are removed. Active ADRs remain; the authentication ADR is updated to the fixed profile contract.

Repository-wide static analysis is used to remove confirmed unreferenced files and exports without changing active behavior.

## Verification

Tests first establish the new configuration matrix, rejection of removed variables, Docker fail-closed routing, and the test-only bypass. Existing mixed-mode tests are removed or rewritten around the two profiles.

The final validation mirrors every current CI job:

- Node version, TypeScript, documentation, lint, and build checks
- unit tests and coverage
- Arduino toolchain integration
- Docker sandbox integration
- Chromium Playwright E2E
- Docker Compose validation
- dead-code and removed-symbol searches
- `git diff --check`
