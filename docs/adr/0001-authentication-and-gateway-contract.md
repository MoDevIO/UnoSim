# ADR 0001: Runtime profiles and gateway contract

- Status: Accepted
- Date: 2026-09-18
- Owners: UnoSim maintainers and platform operators

## Context

UnoSim compiles and executes user-provided code. Earlier configuration allowed
server location, simulation location and trust mode to be combined
independently. Those combinations created unsupported security and lifecycle
paths. Browser WebSocket clients also cannot attach arbitrary authentication
headers, so public HTTP and WebSocket traffic need one gateway identity.

## Decision

UnoSim supports exactly two runtime profiles selected by
`UNOSIM_SERVER_MODE`.

### Local development

`NODE_ENV=development` requires `UNOSIM_SERVER_MODE=local`.

- The server listens on loopback by default.
- A signed local session identifies the single developer.
- Compilation and simulation execute locally.
- Docker is not probed or used as a fallback.
- The profile is not a supported shared or public deployment.

### Docker deployment

`NODE_ENV=production` requires `UNOSIM_SERVER_MODE=docker`.

- The server runs in Docker.
- Every simulation uses an isolated Docker sandbox.
- Startup/readiness requires the Docker daemon, sandbox image and initialized
  runner pool.
- A trusted gateway is mandatory; there is no production bypass or native
  simulation fallback.

The gateway terminates TLS, authenticates the user, removes inbound
`X-UnoSim-*` headers and adds:

| Header | Required | Contract |
|---|---:|---|
| `X-UnoSim-Gateway-Secret` | yes | high-entropy shared secret |
| `X-UnoSim-Subject` | yes | stable opaque identifier, 1–128 URL-safe characters |
| `X-UnoSim-Roles` | yes | comma-separated allowlist; `user` is accepted |
| `X-Request-ID` | recommended | correlation only, never identity |

The backend is reachable only from `UNOSIM_TRUSTED_PROXY`. Browser origins are
checked against `UNOSIM_ALLOWED_WS_ORIGINS`. Cookies and bearer tokens are
validated by the gateway; UnoSim does not parse them.

### Docker integration tests

`NODE_ENV=test`, `UNOSIM_SERVER_MODE=docker` and
`UNOSIM_DOCKER_TEST_BYPASS_GATEWAY=1` permit automated Docker tests without an
external gateway. The bypass changes authentication only. Docker simulation,
startup verification and sandbox isolation remain active. No other environment
accepts the flag.

## Configuration contract

The following former independent selectors are rejected when present:

- `UNOSIM_SIMULATION_MODE`
- `UNOSIM_TRUST_MODE`
- `FORCE_DOCKER`
- `UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL`

Startup also rejects production/local, development/docker, unknown modes and an
incomplete gateway configuration.

## Authorization matrix

| Resource | Anonymous | authenticated `user` |
|---|---:|---:|
| `GET /api/health` | allow | allow |
| `GET /api/config` | allow | allow |
| public examples endpoints | allow | allow |
| `GET /api/status` | deny in Docker | allow |
| compile and sketch mutation | deny in Docker | allow |
| WebSocket `/ws` | deny in Docker | allow |
| test reset | deny outside enabled test environment | deny outside enabled test environment |

The WebSocket stores the validated subject at upgrade. Later messages cannot
replace it. Rate limits and queue ownership use that identity.

## Consequences

Topology, execution and trust can no longer drift apart. Local development
remains simple, while Docker deployments have one mandatory isolation and
identity boundary. Operators must provide the gateway, TLS, secret management,
network isolation and Docker capacity.

## Rejected alternatives

- Independent server/simulation/trust switches recreate unsupported mixed
  modes.
- A Docker deployment without a gateway exposes privileged compile and
  simulation APIs.
- Falling back to native execution after Docker failure silently removes the
  production isolation boundary.
- Passing bearer tokens in WebSocket query strings leaks credentials through
  logs and browser history.
- Origin checks alone do not authenticate non-browser clients.
