# UnoSim Security

UnoSim compiles and executes untrusted sketch code. The supported topology
keeps the development trust boundary small and requires isolation plus an
authentication gateway for every deployment.

## Supported profiles

### Local development

- `NODE_ENV=development`, `UNOSIM_SERVER_MODE=local`
- loopback listener by default
- local signed session cookie; no external identity provider
- compilation and simulation run as local processes
- intended for one trusted developer on one machine

Local development is not approved for shared, LAN or public access.
`UNOSIM_LISTEN_HOST` in local mode accepts only numeric loopback addresses
(`127.0.0.0/8` or `::1`). Binding elsewhere requires the explicit dangerous
opt-in `UNOSIM_UNSAFE_ALLOW_EXTERNAL_LOCAL_BIND=true`; it adds no authentication
or sandboxing and exposes local process execution to clients that can reach the
listener.

### Docker deployment

- `NODE_ENV=production`, `UNOSIM_SERVER_MODE=docker`
- server runs in Docker
- every simulation runs in a separate Docker sandbox
- gateway authentication is mandatory
- Docker availability and the sandbox image are startup/readiness requirements
- there is no local execution fallback

## Gateway boundary

The public gateway terminates TLS, authenticates the browser, strips inbound
`X-UnoSim-*` headers and supplies trusted `X-UnoSim-Gateway-Secret`,
`X-UnoSim-Subject` and `X-UnoSim-Roles` headers to both HTTP and WebSocket
requests. The backend is reachable only from the configured proxy IP or CIDR.

UnoSim itself does not check the source address of a request; it trusts any
caller that presents the gateway secret. Restricting reachability to the
gateway is therefore a deployment duty (bind address, firewall, network). The
Compose default binds to `127.0.0.1`. Whether UnoSim should also enforce
`UNOSIM_TRUSTED_PROXY` itself is an open decision
([refactoring OPL](UNOSIM_REFACTORING_OPL.md), R10-PROXY).

`UNOSIM_GATEWAY_SECRET` must contain at least 32 characters.
`UNOSIM_TRUSTED_PROXY` must be an explicit IP or CIDR.
`UNOSIM_ALLOWED_WS_ORIGINS` is an exact origin allowlist. Origin validation is
an additional browser boundary and does not replace authentication.

The complete contract is recorded in
[`adr/0001-authentication-and-gateway-contract.md`](adr/0001-authentication-and-gateway-contract.md).

## Sandbox boundary

Docker simulations use a dedicated non-root container with:

- network disabled,
- read-only root filesystem,
- dropped Linux capabilities,
- `no-new-privileges`,
- PID, CPU and memory limits,
- a narrow sketch directory mount,
- bounded execution and output.

The Docker socket is a privileged host capability. Only the UnoSim backend may
access it. Operators must restrict host access, pin reviewed images and keep
the daemon patched.

Every sandbox container carries the label `unosim.owner=<host>:<pid>`. On
startup the backend removes containers left by its own previous incarnation;
containers of other UnoSim instances on the same Docker host are not touched.

## Compile boundary

`POST /api/compile` runs `arduino-cli` inside the backend container, not in a
sandbox (the simulation compiles again inside its sandbox). It therefore reads
files with the backend's permissions. To keep file contents out of compiler
diagnostics:

- includes that name a file outside the submitted project – absolute paths,
  paths leaving the project, `..` in library includes, computed includes and
  escaped directive names – are rejected before `arduino-cli` runs;
- the compiled HEX is never returned to the browser.

Remaining risk: inline-assembler directives such as `.include` can still make
the assembler report the first characters of each line of a readable file, and
string concatenation defeats a textual filter. Do not place secrets as files in
the backend container. A sandboxed REST compile is an open decision
([refactoring OPL](UNOSIM_REFACTORING_OPL.md), S1-ASM). The process environment
is not reachable this way: `/proc/*/environ` reads as empty for both compilers
in use.

## Test-only gateway bypass

`UNOSIM_DOCKER_TEST_BYPASS_GATEWAY=1` is accepted only with `NODE_ENV=test` and
`UNOSIM_SERVER_MODE=docker`. It substitutes a local test session for gateway
identity while retaining real Docker sandbox execution. Production and
development startup reject the flag.

## Input and network controls

- HTTP and WebSocket payloads are schema-validated and size-limited.
- Rate limits and simulation admission use the established request identity;
  the global API limit counts per gateway subject behind the gateway and per
  IP otherwise.
- Each WebSocket connection is limited to 500 messages per second (burst 1000);
  excess messages are dropped. At most 1 MiB of sketch input may wait in a
  sketch's stdin. Connections that miss a heartbeat pong are closed.
- The code-less `start_simulation` fallback and sketches created through the
  sketch API are scoped to the identity; the seeded start sketch is read-only.
- External examples are fetched only from configured allowed hosts, validated
  as a complete snapshot and bound to a resolved commit.
- Tutor credentials are request-scoped personal KI:connect keys held only in
  browser memory; local loopback HTTP is allowed and deployed traffic must use
  HTTPS through the gateway.
- Secrets, sketch source, cookies and raw identity-provider claims must not be
  logged.

## Production checklist

1. Use only the Docker profile and reviewed immutable images.
2. Keep the backend inaccessible except through the trusted gateway.
3. Configure TLS, gateway secret, trusted proxy and exact WebSocket origins.
4. Verify `/api/health` and `/api/readiness` before routing traffic.
5. Keep Docker sandbox resource limits, rate limits and admission enabled.
6. Run `npm run test:security:inputs`, `npm run test:docker`, the unit suite,
   E2E suite, build and security audit before release.

Report security vulnerabilities privately to the instance operators before
public disclosure.
