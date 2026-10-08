# UnoSim Security

UnoSim compiles and executes untrusted sketch code. The supported topology
keeps the development trust boundary small and requires isolation plus a
trusted gateway contract for Docker deployments. User authentication at that
gateway is optional.

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
- a trusted gateway and valid gateway identity are mandatory; authenticating a
  person before the gateway is optional
- Docker availability and the sandbox image are startup/readiness requirements
- there is no local execution fallback

## Gateway boundary

The gateway terminates TLS, strips inbound `X-UnoSim-*` headers and supplies
trusted `X-UnoSim-Gateway-Secret`, `X-UnoSim-Subject` and `X-UnoSim-Roles`
headers to both HTTP and WebSocket requests. It may authenticate a person and
derive the subject from that account, or it may grant access to all clients
that can reach it and derive the subject from the source IP it directly
observes, such as Nginx's `$remote_addr`. Do not derive this identity from the
client-supplied `X-Forwarded-For` header. The latter is IP-identified gateway
mode, not user authentication.

In IP-identified mode, clients behind the same observed IP share one UnoSim
subject and its rate limits and simulation admission limits. NAT, VPNs and
upstream proxies can make different people share that identity. Network
reachability to the gateway is the access boundary: every client that can
reach an unauthenticated gateway can use UnoSim. Use this mode only on a
trusted private network.

UnoSim's gateway authorization validates the secret, subject and role but does
not compare the connection's source address with `UNOSIM_TRUSTED_PROXY`. That
setting configures Express proxy trust behavior; it is not an authorization
ACL. Restrict backend reachability at the deployment boundary. The Compose
default binds the backend to `127.0.0.1`, so a host-local gateway can reach it
without exposing the backend directly to LAN clients.

`UNOSIM_GATEWAY_SECRET` must contain at least 32 characters.
`UNOSIM_TRUSTED_PROXY` must be an explicit IP or CIDR.
`UNOSIM_ALLOWED_WS_ORIGINS` is an exact origin allowlist. Origin validation is
an additional browser boundary and does not authenticate a person or replace
the gateway contract.

ADR 0001 records the original gateway contract; [ADR
0008](adr/0008-optional-gateway-authentication.md) supersedes its requirement
for user authentication while retaining gateway identity, header and origin
requirements.

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

Every sandbox container carries the label `unosim.owner`: `instance.<id>` when
`UNOSIM_INSTANCE_ID` is set (Compose sets `unosim-server`), otherwise
`<host>:<pid>`. On startup and at the end of a graceful shutdown the backend
removes the containers of its owner, so a crashed or redeployed backend of the
same deployment cleans up its predecessor's sandboxes; containers of other
owners are not touched. Concurrently running backends must use distinct IDs.
Independently of the backend, every sandbox runs under
`timeout --signal=KILL` and ends after `SANDBOX_MAX_LIFETIME_SECONDS` (default
7200 s wall clock, including paused time).

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
- Compilers stop after 50 errors (`-fmax-errors`) and after 8 MiB of captured
  output. At most 256 KiB of compiler diagnostics reach the client; the rest is
  reported as omitted.
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
