# UnoSim

[![Supported OS](https://img.shields.io/badge/Supported%20OS-Linux%20%26%20macOS-blue?logo=refinedgithub&logoColor=white)](https://github.com/MoDevIO/UnoSim)
[![GitHub commit activity](https://img.shields.io/github/commit-activity/w/modevio/UnoSim?color=lightgreen&logo=git)](https://github.com/MoDevIO/UnoSim/commits)
<br>
[![Tests](https://img.shields.io/github/actions/workflow/status/MoDevIO/UnoSim/ci.yml?label=Tests)](https://github.com/MoDevIO/UnoSim/actions/workflows/ci.yml)
[![Test Coverage](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FMoDevIO%2FUnoSim%2Frefs%2Fheads%2Fgh-pages%2Fcoverage-summary.json&query=%24.total.statements.pct&suffix=%25&label=Test%20Coverage&color=purple)](https://modevio.github.io/UnoSim/)
<br>
[![Issues](https://img.shields.io/github/issues-raw/MoDevIO/UnoSim?color=orange)](https://github.com/MoDevIO/UnoSim/issues)
[![Pull Requests](https://img.shields.io/github/issues-pr-raw/MoDevIO/UnoSim?color=cyan)](https://github.com/MoDevIO/UnoSim/pulls)

A web-based Arduino simulator with a browser UI, server-side Arduino compilation
and an interactive Arduino Preview for sketches.

> **Administration:** For local and server installation, see [`docs/INSTALL_LOCAL.md`](docs/INSTALL_LOCAL.md) and [`docs/INSTALL_SERVER.md`](docs/INSTALL_SERVER.md). Security requirements are in [`docs/SECURITY.md`](docs/SECURITY.md).

## Preview

<p align="center">
   <img src="./screenshots/screen1.png" alt="UnoSim Interface" width="48%" style="display:inline-block; margin-right:2%;" />
   <img src="./screenshots/screen2.png" alt="UnoSim with Example loaded" width="48%" style="display:inline-block;" />
</p>
<p align="center">
   <img src="./screenshots/screen3.png" alt="UnoSim Arduino Preview" width="48%" style="display:inline-block;" />
</p>

## Features

- **Code Editor**: Monaco editor integration for writing Arduino sketches with syntax highlighting
- **Compilation**: Compile Arduino code through the UnoSim backend
- **Serial Monitor**: Real-time output display from simulated Arduino execution
- **Pause/Resume Simulation**: Pause running sketches to inspect state, change pin values, and resume execution
- **Arduino Preview**: A preview of analog/digital inputs and outputs directly in the Arduino SVG
- **Web-based UI**: Use the simulator in a browser; local/server installation runs the backend
- **Modern UI**: Built with React and TailwindCSS for a responsive, professional interface
- **I/O Registry**: You can see what Pins are used in your Program!

## Tech Stack

- **Frontend**: React, TypeScript, Vite, TailwindCSS, Radix UI
- **Backend**: Node.js (TypeScript), Express, WebSocket support
- **Editor**: Monaco Editor
- **Testing**: Vitest with React Testing Library
- **Build Tools**: Vite, esbuild

## Installation (only for Linux/MacOS)

### Prerequisites

- Node.js 24.20.0 LTS (see `.nvmrc`)
- npm or yarn

### Setup

1. Clone the repository:

```bash
git clone https://github.com/MoDevIO/UnoSim.git
cd UnoSim
```

2. Install dependencies:

```bash
    npm ci
```

3. Start the dev-server:

```bash
npm run dev:full
```

This will start both the backend server and the frontend development server.

## Usage

UnoSim can be run in several modes depending on your use case.

### Development Mode

```bash
npm run dev:full
```

Starts the backend (Express + WebSocket) and the Vite dev server with hot-reload.
The backend runs via `tsx` (TypeScript execution) and the client is served by Vite on a separate port with HMR.
Compilation uses `arduino-cli` directly on the host — Docker is **not** required.

`npm run dev` starts only the backend on the local listener (`127.0.0.1`).
`npm run dev:lan` starts the same development configuration but explicitly
listens on `0.0.0.0`, so another device can reach the development server over
the LAN. LAN mode is an explicit local-development convenience and is not a
production deployment mode. Both commands use the configured external-example
source, ref, and host allowlist from the development script.

| Component | Details |
|-----------|---------|
| Backend | `tsx server/index.ts` on configured `PORT` (default 3000) |
| Client | Vite HMR dev server (proxied) |
| Compiler | Direct `arduino-cli` calls on host |
| Worker Pool | Disabled (`CompilerWithFallback.usePool = false` outside production) |

### Production Mode

```bash
npm run build
npm run start
```

Builds the full stack (client + server + worker) into `dist/` and runs the production server.
The Vite-built client is served as static files from `dist/public/`.

| Component | Details |
|-----------|---------|
| Backend | `node dist/index.js` on configured `PORT` (default 3000) |
| Client | Static files from `dist/public/` |
| Compiler | Configured Worker Pool (Compose reference: 8 parallel workers) |
| Docker | Required for the documented production `docker-sandbox` simulation mode |

> **Note:** The development/local mode can compile directly with `arduino-cli`.
> A production deployment using `UNOSIM_SIMULATION_MODE=docker-sandbox` requires
> a working Docker daemon and the sandbox image; it does not silently downgrade
> to host-native simulation.

### Docker Mode

```bash
docker build -t unosim-sandbox:latest -f Dockerfile.sandbox .
docker build -t unosim-server:latest .
```

For a manual production container, use the same gateway, sandbox and mount
requirements as Compose. At minimum, production requires Gateway mode,
`UNOSIM_GATEWAY_SECRET` (at least 32 characters), `UNOSIM_TRUSTED_PROXY`, and
`UNOSIM_ALLOWED_WS_ORIGINS`; the backend also needs the Docker socket and the
`unosim-sandbox:latest` image available to the configured Docker daemon:

```bash
docker run --rm -p 3000:3000 \
   -e NODE_ENV=production \
   -e UNOSIM_SERVER_MODE=docker \
   -e UNOSIM_SIMULATION_MODE=docker-sandbox \
   -e UNOSIM_TRUST_MODE=gateway \
   -e UNOSIM_GATEWAY_SECRET='<secret-from-secret-store>' \
   -e UNOSIM_TRUSTED_PROXY='<gateway-ip-or-cidr>' \
   -e UNOSIM_ALLOWED_WS_ORIGINS='https://classroom.example.edu' \
   -e DOCKER_HOST=unix:///var/run/docker.sock \
   -e DOCKER_SANDBOX_IMAGE=unosim-sandbox:latest \
   -e ARDUINO_CACHE_DIR=${PWD}/server/arduino-cache \
   -e UNOSIM_SHARED_TEMP_DIR=${PWD}/temp \
   -v /var/run/docker.sock:/var/run/docker.sock \
   -v ${PWD}/server/arduino-cache:${PWD}/server/arduino-cache \
   -v ${PWD}/temp:${PWD}/temp \
   -v ${PWD}/storage:/app/storage \
   unosim-server:latest
```

Or with Docker Compose (backend only):

```bash
docker compose up --build
```
This will start the UnoSim backend only. Sandbox execution remains dynamic and uses the Docker socket at runtime.

If you need SonarQube, run it separately in its own stack or service; the UnoSim compose file does not include SonarQube or MCP.

The application runs inside a container and is available at `http://localhost:3000`.

For sandboxed sketch execution, the server container must use a temp directory that is bind-mounted from the host at the same absolute path. The provided Compose file does this via `UNOSIM_SHARED_TEMP_DIR=${PWD}/temp` and `${PWD}/temp:${PWD}/temp`.

On macOS, make sure your project directory is allowed under Docker Desktop file sharing, otherwise the inner sandbox container cannot see generated files such as `sketch.cpp`.

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev:full` | Start backend + client in development mode |
| `npm run dev` | Start backend only (no client) |
| `npm run dev:client` | Start Vite client only |
| `npm run build` | Build client, server, and worker for production |
| `npm run start` | Run the production build |
| `npm run check` | TypeScript type-check (`tsc --noEmit`) |
| `npm run test:fast` | Run deterministic unit tests |
| `npm run test:integration` | Run Arduino/toolchain integration tests |
| `npm run test:docker` | Run Docker sandbox integration tests |
| `npm run test:e2e` | Run Playwright browser tests |
| `npm run test:all` | Run unit, integration and Docker gates |
| `./run-tests.sh` | Full pipeline: lint, unit tests, Docker build, integration tests, E2E |
| `RUN_HEAVY_TESTS=1 ./run-tests.sh` | Full pipeline inklusive langsamem Parallel-Instanz-Stresstest |

### Architecture Overview

- **Sandbox Runner Pool** — Manages runner leases for sketch execution. In the documented production path, each simulation runs in a short-lived isolated Docker sandbox with stdout/stderr capture for serial output and pin state reporting.
- **Compilation Worker Pool** — In production mode, the configured Node.js Worker Thread pool handles compilations in parallel via `CompilerWithFallback`. The Compose reference uses 8 workers; capacity limits are documented in [`docs/SCALABILITY.md`](docs/SCALABILITY.md).
- **WebSocket Layer** — Real-time communication between client and server for serial output, pin state batches, and simulation control (start/stop/pause/resume).
- **SonarQube Integration** — Optional SonarQube scans are wired into the pre-push hook and `./run-tests.sh` when `SONAR_TOKEN` and a reachable SonarQube service are available. Release blocking is controlled by `REQUIRE_RELEASE_GATE=1`.

## Notes for running tests (optional)

The repository contains a **robust, fast test pipeline**:

1. **Unit tests** (Vitest + React Testing Library) cover business logic and UI
   components. `npm run test:unit` is the deterministic refactoring gate;
   toolchain, Docker, browser and load tests are separate gates.
2. **E2E smoke flow** comprises three Playwright tests in
   `e2e/smoke-and-flow.spec.ts` for startup, compile/run with serial output, and
   dialogs. The repository also contains separate responsive, board, visual,
   and scalability E2E suites; run `npm run test:e2e` for the configured suite.
3. Heavy stress tests are opt-in. Use `RUN_HEAVY_TESTS=1 ./run-tests.sh` when
   validating Docker sandbox isolation and cleanup. Load-test commands are
   listed in [`docs/RELEASE_RUNBOOK.md`](docs/RELEASE_RUNBOOK.md) and capacity
   conclusions belong in [`docs/SCALABILITY.md`](docs/SCALABILITY.md).

Local quick‑check example:

```bash
npm run test:unit
```

For release gates, follow [`docs/RELEASE_RUNBOOK.md`](docs/RELEASE_RUNBOOK.md).
Testing conventions and timing budgets are maintained in
[`docs/TESTING_STANDARDS.md`](docs/TESTING_STANDARDS.md).

## License

MIT License - See [LICENSE](LICENSE) for details

This project uses third-party open-source dependencies under their respective
licenses.

## Contact & Support

### Getting Help

- **Issues & Bugs**: Use the [GitHub Issues](https://github.com/modevio/UnoSim/issues) tracker
- **Feature Requests**: Create an [Pull Request](https://github.com/modevio/UnoSim/pulls)
- **Questions**: Open a discussion or check existing issues

### Project Maintainers

- **Mo Tiltmann** (MoDevIO) - Couven-Gymnasium, Aachen
- **Tom Tiltmann** (ttbombadil) - Technische Hochschule, Köln

### Additional Resources

- [Arduino Official Documentation](https://www.arduino.cc/reference/)
- [Monaco Editor Documentation](https://microsoft.github.io/monaco-editor/)
- [React Documentation](https://react.dev/)
