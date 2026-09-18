# Runtime Mode Simplification Implementation Plan

> **Execution note:** Work through each task in order. Add a failing focused test before changing behavior, keep commits narrow, and run the listed verification before advancing.

**Goal:** Reduce UnoSim to a local development profile and a gateway-protected Docker profile, with one test-only Docker gateway bypass.

**Architecture:** Keep `UNOSIM_SERVER_MODE=local|docker` as the only topology selector. Derive authentication, simulation routing, readiness, and public status from it. Remove independent simulation/trust selectors, mixed-mode fallbacks, redundant protocol fields, obsolete documentation, and confirmed dead artifacts.

**Stack:** TypeScript, Node.js 24, Express, Vitest, Playwright, Docker Compose, GitHub Actions.

---

## Task 1: Establish the configuration contract

**Files:**

- Modify: `tests/server/config.test.ts`
- Modify: `tests/server/security/access-control.test.ts`
- Modify: `server/config.ts`
- Modify: `server/security/access-control.ts`

### Steps

1. Add tests for valid local development, Docker production, and Docker test-bypass configurations.
2. Add tests that reject production-local, development-Docker, invalid bypass placement, and each removed legacy selector.
3. Run the two focused test files and confirm the new tests fail for the expected reasons.
4. Replace independent simulation/trust parsing with profile validation and derived access configuration.
5. Retain the existing gateway header, secret, proxy, origin, and local-session behavior.
6. Re-run the focused tests and `npm run check`.

Expected command:

```bash
npx vitest run --project=unit-node tests/server/config.test.ts tests/server/security/access-control.test.ts
```

## Task 2: Make execution routing profile-driven and fail closed

**Files:**

- Modify: `tests/server/services/sandbox/router-phase.test.ts`
- Modify: `tests/server/services/sandbox-runner.test.ts`
- Modify: `tests/core/sandbox-stress.test.ts`
- Modify: `tests/server/services/sandbox-performance.test.ts`
- Modify: `server/services/sandbox/execution-manager.ts`
- Delete: `server/services/sandbox/execution-phases/router-phase.ts`
- Modify: `server/services/sandbox-runner.ts`
- Modify: `server/services/sandbox-runner-pool.ts`
- Modify: `server/index.ts`

### Steps

1. Rewrite routing tests around the two profiles: local always local; Docker always Docker; unavailable Docker in Docker mode fails.
2. Add a test showing local runners do not perform Docker availability checks.
3. Run the focused tests and confirm the old fallback behavior conflicts with them.
4. Remove `simulationMode`, the mixed-mode router, the local fallback, and the eager Docker probe in local mode.
5. Remove the timeout-based readiness override; mark Docker ready only after successful checks.
6. Update pool readiness and startup output to use only `serverMode`.
7. Run the focused sandbox tests and `npm run check`.

Expected command:

```bash
npx vitest run --project=unit-node tests/server/services/sandbox/router-phase.test.ts tests/server/services/sandbox-runner.test.ts tests/server/services/sandbox-performance.test.ts tests/core/sandbox-stress.test.ts
```

Delete the router test file if all of its remaining assertions move into the runner/execution-manager tests.

## Task 3: Remove redundant public mode fields

**Files:**

- Modify: `server/config.ts`
- Modify: `server/routes/status.routes.ts`
- Modify: `server/routes/simulation.ws.ts`
- Modify: `shared/schema.ts`
- Modify: `client/src/hooks/useWebSocketHandler.ts`
- Modify: `client/src/hooks/useArduinoSimulatorPage.tsx`
- Modify: `client/src/components/simulator/ArduinoSimulatorPageLayout.tsx`
- Modify: `client/src/components/features/sim-cockpit.tsx`
- Modify affected tests under `tests/client` and `tests/server/routes`

### Steps

1. Update API/schema/client tests to expect only `serverMode` and no per-message `sandboxMode`.
2. Run the focused tests and confirm failures.
3. Remove `simulationMode` from `/api/config` and `/api/status`.
4. Remove `sandboxMode` from the WebSocket schema, server message, hook state, layout props, cockpit rendering, and associated tests.
5. Run the focused client and route tests plus `npm run check`.

## Task 4: Align scripts, Compose, Docker tests, and CI

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json` only if npm changes it while editing scripts
- Modify: `docker-compose.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `tests/integration/docker-security-contract.test.ts`
- Modify: `run-tests.sh`
- Delete: `scripts/build-sandbox-image.sh`

### Steps

1. Add or update tests that prove Docker integration is enabled only through the Docker profile and test bypass.
2. Remove legacy mode variables from `dev`, `dev:e2e`, `test:docker`, Compose, and the full-test script.
3. Remove `dev:lan`.
4. Configure Docker integration with `NODE_ENV=test`, `UNOSIM_SERVER_MODE=docker`, and `UNOSIM_DOCKER_TEST_BYPASS_GATEWAY=1`.
5. Remove the unused sandbox build from the local Playwright CI job.
6. Delete the unused shell wrapper and validate Compose with `docker compose config`.
7. Run `npm run check`, relevant integration discovery, and JSON/YAML syntax checks.

## Task 5: Update current documentation without rewriting the root README

**Files:**

- Minimally modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/INSTALL_LOCAL.md`
- Modify: `docs/INSTALL_SERVER.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify as required: `docs/EXTERNAL_API.md`, `docs/RELEASE_RUNBOOK.md`, `docs/SCALABILITY.md`, `docs/TESTING_STANDARDS.md`
- Modify: `docs/adr/0001-authentication-and-gateway-contract.md`
- Delete: `docs/INSTALL_DOCKER_LOCAL.md`
- Delete: `docs/EXTERNAL_EXAMPLES_IMPLEMENTATION_PLAN.md`
- Delete: `docs/archive/`
- Delete: `docs/assessments/`

### Steps

1. Correct only inaccurate commands, links, variables, and mode statements in the root README.
2. Reduce installation docs to local development and gateway-protected Docker deployment.
3. Document the test-only bypass only in testing documentation.
4. Update architecture, security, release, scalability, API, and ADR references to the single profile axis.
5. Delete historical and superseded documentation.
6. Run `npm run check:docs` and search for removed terms.

## Task 6: Remove historical generated artifacts and confirmed dead code

**Files:**

- Delete: `.vercelignore`
- Delete: `load-test-results/`
- Delete: `scripts/capture-host-profile.mjs`
- Delete: `scripts/generate-load-summary.mjs`
- Delete: `scripts/run-and-capture-load-test.mjs`
- Delete if still unreferenced: `client/src/components/features/simulator/SimulatorSidebar.tsx`
- Modify only if confirmed unreferenced: files containing Knip-reported unused exports

### Steps

1. Re-run Knip after the mode cleanup.
2. Confirm each candidate has no static or documented entry point.
3. Delete only confirmed dead files and exports.
4. Re-run Knip, TypeScript, unit tests, and documentation checks.

## Task 7: Verify the complete repository

### Static and unit verification

```bash
npm run check:node-version
npm run check
npm run check:docs
npm run lint
npm run test:coverage
npm run build
docker compose config
npx knip --reporter compact
```

### Integration verification

```bash
npm run test:integration
npm run test:docker
npm run test:e2e -- --workers=2
```

### Repository invariants

1. Search the full tracked tree for removed environment variables and mode values.
2. Confirm the root README diff contains only factual corrections.
3. Confirm Docker always routes to a sandbox and local mode never probes Docker.
4. Run `git diff --check` and inspect the complete diff.
5. Remove these temporary design and plan documents from the final tree after implementation, because completed plans belong in Git history rather than current operational documentation.
