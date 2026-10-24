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
(`127.0.0.0/8` or `::1`). The Vite dev server of `npm run dev:full` listens on
`127.0.0.1:3001` only. In local mode the backend accepts only HTTP requests and
WebSocket upgrades whose `Host` is `localhost` or a numeric loopback address
(any port), so neither a LAN client nor a DNS rebinding page whose host name
resolves to `127.0.0.1` reaches it; WebSocket clients without an `Origin`
header must connect from a loopback address. Binding elsewhere requires the
explicit dangerous opt-in `UNOSIM_UNSAFE_ALLOW_EXTERNAL_LOCAL_BIND=true`, which
also lifts these host checks; it adds no authentication or sandboxing and
exposes local process execution to clients that can reach the listener.

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
Independently of the backend, every running sandbox runs under
`timeout --signal=KILL` and ends after `SANDBOX_MAX_LIFETIME_SECONDS` (default
7200 s wall clock). `docker pause` freezes that timer's process too, so a
paused sandbox is bounded by the backend instead: the paused time of a run is
limited to `SIMULATION_MAX_PAUSED_SECONDS` (default 600 s, always below the
hard lifetime); then the run ends and its runner, admission and container are
released. A paused container left by a crashed backend is removed by the next
start's owner sweep.

## Compile boundary

In the Docker profile `POST /api/compile` runs `arduino-cli` in a compile
sandbox ([ADR 0010](adr/0010-compile-sandbox-and-flash-artifact.md), plan
P2.4): one short-lived container of the image `unosim-compile-sandbox` per
compile, started by the backend over the Docker socket like the simulation
sandboxes.

- No network, read-only root filesystem, all capabilities dropped,
  `no-new-privileges`, memory without swap, CPU and PID limits
  (`COMPILE_SANDBOX_MEMORY_MB` 512, `COMPILE_SANDBOX_CPU_LIMIT` 1,
  `COMPILE_SANDBOX_PIDS_LIMIT` 128), one 256 MiB tmpfs without exec for the
  core cache copy, the build and its outputs.
- The sketch directory is the only bind mount, read-only. No other project,
  no backend file and no Docker socket is visible. HEX, ELF and the CLI's
  standard output leave the container framed on stdout; the container cannot
  write to the host.
- The environment is set explicitly (`HOME`, `PATH`); nothing of the
  backend's environment reaches the toolchain, also not through
  `.include "/proc/self/environ"`.
- A time limit of 60 s applies inside the container (`timeout --signal=KILL`)
  and at the backend; a container whose client was stopped is removed. Every
  compile container carries the owner label and is removed by the startup
  sweep like a simulation sandbox.
- The process executor refuses to start a container of the compile image
  without these isolation flags or with a writable mount.
- The backend does not start in the Docker profile without the image. The
  backend image itself contains no compiler (no `arduino-cli`, no `g++`); a
  sketch is compiled only in the compile sandbox and, for the host mock, in the
  simulation sandbox.

The contract test `tests/integration/compile-sandbox-contract.test.ts` (Docker
gate) checks isolation, the disclosure attempts below and the limits.

Includes that name a file outside the submitted project – absolute paths,
paths leaving the project, `..` in library includes, computed includes and
escaped directive names – are still rejected before `arduino-cli` runs, as an
additional layer in the Docker profile and as the boundary in the local
profile.

The compiled HEX (`binary`) is never returned to the browser. The response
carries the flash image as `artifact` (flash range, SHA-256, symbols; browser
emulation, plan P2.5): in the Docker profile because it was built where no
backend file was readable, in the local profile because that profile serves
one trusted developer.

Remaining risk in the local profile: `arduino-cli` runs in the backend process.
Inline-assembler directives such as `.include` can make the assembler report
the first characters of each line of a readable file, and `.include
"/proc/self/environ"` the first characters of environment entries (spike
P0.2); string concatenation defeats a textual filter. The local profile binds
to loopback and serves one developer; do not run it for others. In the
compile sandbox the same directives only reach the files of the public
image.

## Test-only gateway bypass

`UNOSIM_DOCKER_TEST_BYPASS_GATEWAY=1` is accepted only with `NODE_ENV=test` and
`UNOSIM_SERVER_MODE=docker`. It substitutes a local test session for gateway
identity while retaining real Docker sandbox execution. Production and
development startup reject the flag.

## Input and network controls

- HTTP and WebSocket payloads are schema-validated and size-limited.
- Mutating `/api` requests with a body must be `application/json` (else 415),
  so a foreign page cannot send them as a CORS-simple form or text request.
  Browsers that report `Sec-Fetch-Site: cross-site` or `same-site` are refused
  (403). There is no form-encoded body parser.
- Rate limits and simulation admission use the established request identity;
  the global API limit counts per gateway subject behind the gateway and per
  IP otherwise.
- Each WebSocket connection is limited to 500 messages per second (burst 1000);
  excess messages are dropped. At most 1 MiB of sketch input may wait in a
  sketch's stdin. Connections that miss a heartbeat pong are closed.
- Sketch code controls the simulation's stdout and stderr. Plain runtime text
  reaches the client at up to 50 lines per second after a burst of 200 lines
  per run; further lines are dropped and counted, the client is told once and
  the log reports drops aggregated (at most every 10 s), never per line. At
  most 4 I/O-registry cycles per run are processed; the generated program
  emits one. Compose rotates the backend log (`json-file`, 5 × 10 MB by
  default).
- Compilers stop after 50 errors (`-fmax-errors`) and after 8 MiB of captured
  output. At most 256 KiB of compiler diagnostics reach the client; the rest is
  reported as omitted.
- The code-less `start_simulation` fallback is scoped to the identity. The
  sketch API is read-only: it serves only the seeded start sketch and accepts
  no client-created or changed sketches.
- External examples are fetched only from configured allowed hosts, validated
  as a complete snapshot and bound to a resolved commit.
- GitHub ref lookups request only `application/vnd.github.sha`, enforce an
  independent 256-byte response limit and validate the complete lowercase
  40-character SHA. Manifest limits remain independent. DNS, allowlist,
  redirect, timeout and streaming-size checks apply to this representation too.
  Ref failures log only the request ID and safe error metadata, never bodies
  or upstream error messages.
- GitHub ref lookups respect the REST quota: after a 403/429 rate-limit answer
  no request is sent before the announced reset, and browser overrides leave a
  reserve of 10 lookups to the operator's default Course. The optional
  `UNOSIM_GITHUB_TOKEN` is sent to `api.github.com` only and never logged.
- Browser overrides cannot crowd out the operator's default Course: default and
  override loads use separate load slots, queues and load-start budgets of the
  configured size, override loads may hold only part of the outbound fetch cap
  (a quarter is reserved for the default), and the source cache never evicts
  the default source.
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

The read-only `/api/examples/builtin/catalog` endpoint serves only the local
BuiltInProvider catalog with the same anonymous default-read policy as
`/api/examples`. It accepts no selection parameters and does not start outbound
requests or spend source-load/GitHub quotas. External selection and revision
checks remain on their existing endpoints.
