# ADR 0001: Authentication and gateway contract

- Status: Accepted
- Date: 2026-09-02
- Owners: UnoSim maintainers and platform operators
- Implements: AP-01.2, AP-01.3, AP-01.4

## Context

UnoSim compiles and executes user-provided code. The compile API, sketch CRUD
API, and WebSocket simulation channel are therefore privileged resources. The
application currently has no login, session, tenant, or role implementation.
The Docker Compose setup also publishes the backend port directly.

Authentication cannot be added only as an Express middleware after the routes:
WebSocket upgrades must cross the same trust boundary. Browser WebSocket clients
also cannot attach arbitrary authentication headers. A public deployment needs
one consistent identity for HTTP requests, WebSocket upgrades, rate limits, and
audit logs.

## Decision

UnoSim supports exactly two trust modes.

### Local mode

Local mode is for one trusted user on one machine.

- The server listens on loopback only and is not reachable from another host.
- No application login is required.
- Reverse-proxy identity headers are ignored.
- Test endpoints remain independently protected by their test-only flags.
- Local mode is not an approved public or shared deployment mode.

### Gateway mode

Gateway mode is mandatory whenever the service is reachable by untrusted or
multiple users.

- A trusted reverse proxy or identity-aware gateway terminates TLS and
  authenticates the browser using its own secure session cookie.
- The backend is reachable only from that gateway on a private network. Its port
  must not be published directly to users.
- The gateway removes all incoming `X-UnoSim-*` headers before adding trusted
  values.
- The gateway attaches the following headers to both normal HTTP requests and
  WebSocket upgrade requests:

  | Header | Required | Contract |
  |---|---:|---|
  | `X-UnoSim-Gateway-Secret` | yes | Shared high-entropy secret, compared by UnoSim without timing leaks |
  | `X-UnoSim-Subject` | yes | Stable opaque user/session identifier; 1–128 URL-safe characters |
  | `X-UnoSim-Roles` | yes | Comma-separated allowlist; initially only `user` is accepted |
  | `X-Request-ID` | recommended | Gateway-generated correlation ID; never used as identity |

- The shared secret is supplied to UnoSim through a secret store, never through
  a browser, URL, repository file, or client-visible `/api/config` response.
- Cookies and bearer tokens are validated by the gateway. UnoSim does not parse
  them in this architecture.
- `trust proxy` is enabled only for the exact private proxy hop or subnet. It is
  never enabled as an unrestricted boolean in gateway mode.

The initial authorization matrix is:

| Resource | Anonymous | `user` |
|---|---:|---:|
| `GET /api/health` | allow | allow |
| `GET /api/config` | allow | allow |
| `GET /api/examples` and `/examples/*` | allow | allow |
| `GET /api/status` | deny | allow |
| `POST /api/compile` | deny | allow |
| `/api/sketches` CRUD | deny | allow |
| WebSocket `/ws` upgrade | deny | allow |
| `POST /api/test-reset` | deny | deny |

The WebSocket connection stores the validated subject when it is upgraded.
Later messages cannot change that identity. Rate limits and queue ownership use
the subject rather than the socket object or a client-supplied run ID, so a
reconnect does not reset limits.

An HTTP authentication failure returns `401` without revealing whether a
subject exists. An authenticated request without the required role returns
`403`. A rejected WebSocket upgrade returns an HTTP `401` or `403` before the
protocol switches; it is not accepted and closed afterward.

Origin validation is an additional browser boundary and is not authentication.
It will be implemented separately in AP-01.4. Non-browser clients still require
the gateway identity contract.

## Configuration contract

The implementation task AP-01.3 will introduce validated startup configuration:

- `UNOSIM_TRUST_MODE=local|gateway`, with no implicit production default.
- `UNOSIM_GATEWAY_SECRET`, required in gateway mode and rejected in local mode.
- `UNOSIM_TRUSTED_PROXY`, required in gateway mode and limited to an explicit IP
  address or CIDR.
- `UNOSIM_ALLOWED_WS_ORIGINS`, required by the deployment and interpreted as a
  comma-separated exact allowlist. Gateway WebSocket upgrades without an
  allowed browser `Origin` are rejected.

Startup fails when gateway mode is incomplete. A production/Docker process must
not start in local mode unless an explicit development override is present.

## Operational requirements

- Gateway mode requires TLS at the public edge.
- Network policy or container networking must prevent bypassing the gateway.
- Logs may contain the opaque subject and request ID, but never cookies, bearer
  tokens, the gateway secret, sketch source, or raw identity-provider claims.
- Secret rotation must allow a short two-secret overlap without restarting all
  active WebSocket sessions. Existing sessions keep their established identity
  until disconnect.
- Health probes use `/api/health`; they do not receive privileged identity
  headers.

## Rejected alternatives

- Trusting `X-UnoSim-Subject` without an authenticated private hop permits header
  spoofing and is rejected.
- Passing a bearer token in the WebSocket query string risks leakage through
  logs and browser history and is rejected.
- Implementing a separate UnoSim password database duplicates identity, session,
  password-reset, and MFA responsibilities and is outside the product scope.
- Relying only on `Origin` does not authenticate non-browser clients and is
  rejected.
- IP-only rate limiting groups classrooms behind NAT and does not survive proxy
  ambiguity; IP may be an additional abuse signal but is not the primary
  identity.

## Consequences

UnoSim remains simple in trusted local development while public deployments gain
one identity across HTTP and WebSocket. Gateway operators must provide identity,
TLS, header sanitization, secret management, and network isolation. AP-01.3 must
implement the contract before gateway mode is considered supported; until then,
UnoSim remains approved only for loopback/local use.
