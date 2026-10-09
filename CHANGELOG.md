# Changelog

All notable changes to UnoSim. Versions follow [Semantic Versioning](https://semver.org/).

## v1.0.0 – 2026-10-09

First versioned release of UnoSim. It covers everything merged since the last
release candidate `rc-2026-09-11-full-3` (#87–#237). The REST API and the
WebSocket protocol report version `1.0.0`; the embedding API (`postMessage`)
stays at `1.4.0`.

### Upgrade notes for operators

- **Docker is the only production profile.** `NODE_ENV=production` requires
  `UNOSIM_SERVER_MODE=docker`; every simulation runs in its own sandbox
  container and there is no local fallback. The former switches
  `UNOSIM_SIMULATION_MODE`, `UNOSIM_TRUST_MODE`, `FORCE_DOCKER` and
  `UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL` now stop the server at startup.
- **A trusted gateway is mandatory; user authentication at the gateway is
  optional** ([ADR 0008](docs/adr/0008-optional-gateway-authentication.md)).
  Set `UNOSIM_GATEWAY_SECRET` (at least 32 characters), `UNOSIM_TRUSTED_PROXY`
  (explicit IP or CIDR) and `UNOSIM_ALLOWED_WS_ORIGINS`. The Compose backend
  binds to `127.0.0.1` and uses a fixed network gateway; the Ubuntu/VBox
  installer writes all values together.
- **Capacity:** the application default admits 25 running plus waiting
  simulations, at most 5 per subject. The Ubuntu/VBox installer writes the
  value measured on its reference VM, `SIMULATION_ADMISSION_MAX=40`. Read
  [CAPACITY_VALIDATION_PLAN.md](docs/CAPACITY_VALIDATION_PLAN.md) before
  raising it on other hosts.
- **New lifetime limits:** a sandbox ends after `SANDBOX_MAX_LIFETIME_SECONDS`
  (default 7200 s) and a run after `SIMULATION_MAX_PAUSED_SECONDS` of total
  pause (default 600 s). Compose rotates the backend log (5 × 10 MB).
- **Set `UNOSIM_INSTANCE_ID`** to a unique value per backend on one Docker
  host (Compose: `unosim-server`); a restarted backend removes the sandboxes
  of its predecessor with that ID.
- **Toolchain is pinned:** Node.js 24.20.0, Arduino CLI 1.5.1, AVR core 1.8.8.
- **API changes:** mutating `/api` requests must be `application/json` (else
  415) and are refused from cross-site senders (403); the sketch mutation
  routes are removed and the sketch API is read-only; `POST /api/compile` no
  longer returns the compiled HEX.
- **Local development** (`npm run dev:full`) is reachable from this machine
  only: Vite listens on `127.0.0.1:3001` and the backend accepts only
  `localhost`/loopback hosts. Open `http://localhost:3001`.

### Security and isolation

- Compile includes that leave the sketch project are rejected before
  `arduino-cli` runs; compiler output is bounded (#160, #162, #223).
- Legacy code fallback, sketch writes, compile cache and rate limits are scoped
  to the request identity; each gateway subject has its own API budget (#161,
  #163).
- WebSocket connections: heartbeat, inbound rate limit, bounded stdin and one
  simulation lifecycle per connection (#167, #216).
- Complete Helmet CSP, JSON-only mutating API with cross-site refusal, sketch
  source redacted from logs (#175, #185, #186, #224).
- Local mode is loopback-only, including protection against LAN access and
  DNS rebinding (#177, #236).
- Dependency updates for npm audit findings (#202, #209).

### Sandbox lifecycle and resources

- Containers carry a deployment owner label; orphans of a crashed backend are
  removed, shutdown is bounded and every sandbox has a hard lifetime (#166,
  #191, #218).
- Runner reuse cannot leak a stopped run into the next one; execution
  ownership, process output and REST compile-to-start ownership are isolated
  and bounded (#164, #165, #187, #190).
- Bounded writable sandbox storage, runtime text output, I/O-registry cycles,
  pause time, compile build paths and shared temp directory (#183, #232, #233,
  #234).

### Capacity and compile

- Admission and sandbox start slots are shared fairly between subjects;
  capacity calibration and mixed-load reports are reproducible (#104, #105,
  #180, #226, #229).
- The compile worker queue is bounded and answers `SYSTEM_BUSY`; crashed
  workers restart; expired slots pass to the next compile; caches are bounded
  (#168, #169, #170, #192).
- Accurate CPU, queue and compile capacity metrics (#170, #188).

### Tutor and Course Content

- Course repository controls curriculum, strategy and learning objectives;
  mastery-driven progression; inline teacher focus in Example annotations
  with handover to the free Tutor (#108–#112, #194–#198).
- Better question quality: answers are rated only against the asked question,
  follow-up questions keep the sought answer out, off-topic replies are
  answered briefly (#135, #204, #206).
- Course Content sessions are subject-owned, bounded and committed only after
  success; the Course revision is derived on the server; request cancellation
  propagates to the provider (#150, #174, #182, #219–#221).
- Deterministic Tutor quality gate and an optional real-provider evaluation
  (manual dispatch only) (#113–#158, #205).

### Examples

- Dynamic external examples from an allowed GitHub repository, validated as a
  complete snapshot and bound to a resolved commit (#87).
- GitHub API quota is respected with a reserve for the default Course; the
  default Course stays loadable under browser override load (#227, #235).

### Simulator and client

- Project-wide multi-file static analysis; pin modes and the runtime I/O
  registry are preserved (#89–#91).
- Stable simulation, WebSocket and compile-slot lifecycle: the configured
  simulation mode is respected, external starts and the serial lifecycle are
  hardened, the Docker running state follows runtime readiness, active compile
  directories are not cleaned up early (#88, #93, #95, #98, #99, #101, #103).
- Embedding API reports operation errors and finds the embedding origin in
  every browser (#97, #228).
- The simulation returns to idle when the server connection drops (#225).
- Vite 8, Tailwind CSS 4 and a smaller initial load (#212–#214).

### Deployment, CI and documentation

- Ubuntu/VBox installer with optional gateway authentication; the CI verifies
  the containerised gateway and the installer topology (#208, #211, #217).
- The installer keeps retrying its readiness checks while Docker's published
  port still resets connections during backend startup; before, a fresh
  installation could abort with "meldet aber keine Readiness" (#237).
- CI runs a clean-room build, knip dead-code gate, zero ESLint warnings,
  Docker sandbox, toolchain and E2E gates (#189, #193, #200).
- Architecture, security, installation and capacity documentation describe the
  implemented system (#159, #176, #178, #230, #231).

### Release validation

- Hosted CI on `main` is green: clean-room build, lint and unit tests,
  toolchain integration, Docker sandbox, Playwright E2E and the production
  gateway deployment.
- The local release gate (`REQUIRE_RELEASE_GATE=1 ./run-tests.sh`) passes,
  including Docker, E2E and the SonarQube quality gate.
- Fresh-VM installation: on a fresh Ubuntu 26.04.1 LTS (aarch64) VirtualBox VM,
  `scripts/install-ubuntu-vbox.sh` from `main` at `c513ec859` completed on the
  first run.
  Backend and HTTPS gateway readiness, TLS on ports 443 and 8443, the gateway
  secret and origin checks, and a Blink simulation in the Docker sandbox were
  verified from a client on the host-only network.
- Ubuntu 26.04 uses sudo-rs: start the installer from an interactive terminal,
  where `sudo -v` asks for the password once.

### Known limitations

- `POST /api/compile` runs `arduino-cli` inside the backend container. An
  inline-assembler `.include` can reveal the first characters of each line of
  a file the backend can read. Do not place secrets as files in the backend
  container; a sandboxed REST compile is an open architecture decision
  ([SECURITY.md](docs/SECURITY.md), S1-ASM).
- In the IP-identified gateway mode of the Ubuntu/VBox installer, clients that
  reach Nginx from the same source IP share one UnoSim identity, its rate
  limits and its simulation admissions; network reachability is the access
  boundary. Use it only on a trusted private network or add gateway
  authentication ([ADR 0008](docs/adr/0008-optional-gateway-authentication.md)).
