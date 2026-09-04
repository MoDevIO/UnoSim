# UnoSim Administration & Configuration Guide

This guide explains how to configure the UnoSim server instance and sandbox environments using environment variables.

For the security controls and residual risks, see [`README_SECURITY.md`](README_SECURITY.md).

## 🎯 Target Audience
This guide is intended for **system administrators** and **DevOps engineers** who deploy UnoSim in development, test, or production environments.

## ⚙️ Configuration Principles
UnoSim follows the "Twelve-Factor App" principle: configuration is strictly separated from code.

* **Central definition:** `server/config.ts` defines all available parameters and their default values.
* **No hardcoding:** Values are not stored in that file; they are read from the runtime environment.
* **Precedence:** Explicitly set environment variables always override internal defaults.

---

## 🚀 Deployment Scenarios

### 1. Local Development
Optimized for speed and minimal resource usage without requiring Docker.

* **Mode:** Both server and simulation run locally in the same process.
* **Start:**
    ```bash
    export UNOSIM_SERVER_MODE=local
    export UNOSIM_SIMULATION_MODE=local
    npm ci
    npm run dev:full
    ```

### 2. Standard Docker Operation (Shared Container)
Suitable for performance testing or environments with limited resources where isolation is secondary.

* **Behavior:** Simulations (sketches) are executed directly inside the backend container.
* **Configuration (`docker-compose.yml`):**
    ```yaml
    services:
      unosim-backend:
        environment:
          - UNOSIM_SERVER_MODE=docker
          - UNOSIM_SIMULATION_MODE=local
          - WORKER_COUNT=8
    ```

### 3. Production Docker Operation (Single Stateful Node)
Recommended for public deployments or multi-user systems to maximize security and resource control.

* **Behavior:** Each sketch runs in its own short-lived Docker sandbox. This
  deployment is a single stateful backend node; horizontal high availability
  is not provided.
* **Configuration (`docker-compose.yml`):**
    ```yaml
    services:
      unosim-backend:
        environment:
          - NODE_ENV=production
          - UNOSIM_SIMULATION_MODE=docker-sandbox
          - SANDBOX_POOL_MIN_RUNNERS=10
          - SANDBOX_POOL_MAX_RUNNERS=100
          - SANDBOX_MEMORY_MB=256
          - SANDBOX_CPU_LIMIT=0.5
    ```

---

## 🛠️ Environment Variable Reference

### Reproducible builds

The supported runtime is Node 24.20.0 LTS (see `.nvmrc`). Use `npm ci` for clean
installs; the CI clean-room job runs typecheck, unit tests and the production
build from a fresh checkout. Update the pinned Node version in `.nvmrc`,
`package.json`, Dockerfiles and CI together.

### Core Settings
| Variable | Default / Fallback | Description |
| :--- | :--- | :--- |
| `UNOSIM_SERVER_MODE` | `local` (or `docker` in production) | `local` or `docker`. Affects paths and defaults. |
| `UNOSIM_SIMULATION_MODE` | `local` | `local` or `docker-sandbox`. Defines the simulation runtime. |
| `PORT` | `3000` | HTTP/WebSocket listener port (1–65535). |
| `DISABLE_RATE_LIMIT` | `false` | Disables API rate limiting (recommended only for internal tests). |

### Sandbox Resources (only for `docker-sandbox`)
| Variable | Default | Description |
| :--- | :--- | :--- |
| `SANDBOX_POOL_MIN_RUNNERS` | `5` | **Sandbox Runners** — number of always-on ("warm") containers. |
| `SANDBOX_POOL_MAX_RUNNERS` | `minRunners` | **Sandbox Runners** — upper limit for concurrent simulations. |
| `SANDBOX_MEMORY_MB` | `256` | RAM limit per sandbox instance. |
| `SANDBOX_CPU_LIMIT` | `0.25` | CPU share per instance (e.g. `0.5` for half a core). |
| `DOCKER_SANDBOX_IMAGE` | `unosim-sandbox:latest` | Sandbox image used for simulation. |

### Compilation & Performance
| Variable | Default | Description |
| :--- | :--- | :--- |
| `WORKER_COUNT` | CPU-dependent | **Compile Workers** — number of parallel background worker threads for compilation jobs. |
| `COMPILE_MAX_CONCURRENT` | CPU - 1 | **Compile Slots** — maximum number of concurrent `g++` processes. |
| `ARDUINO_FQBN` | `arduino:avr:uno` | Target board architecture for the compiler. |
| `BUILD_CACHE_MAX_BYTES` | `2 GiB` | Maximum on-disk build cache size. |

---

## 🔒 Fixed Parameters (Not configurable via env vars)
The following safety and stability limits are hardcoded to prevent system overload:

* **Execution timeout:** 60 seconds (maximum sketch runtime).
* **Output limit:** 100 MB (maximum simulation log output).
* **PIDs limit:** 50 (maximum processes inside a sandbox).
* **Queue size:** 500 (maximum queue length for pending simulations).

---

## � Canonical Terminology

The following terms are used consistently across the UI debug header, API responses (`/api/status`), the server startup banner, and this documentation:

| Canonical Term | Meaning | Where Visible |
| :--- | :--- | :--- |
| **Server Mode** | `local` or `docker` — how the server itself runs | Banner, API |
| **Simulation Mode** | `local` or `docker-sandbox` — how sketches are executed | Banner, API, Header |
| **HTTP** | REST endpoint reachability (connected / disconnected) | Header |
| **WS (WebSocket)** | Real-time channel state (connected / connecting / reconnecting / disconnected) | Header |
| **Compile Workers** | Parallel background worker threads (`WORKER_COUNT`) | Banner |
| **Compile Slots** | Max concurrent `g++` processes (`COMPILE_MAX_CONCURRENT`) | Banner, API, Header |
| **Sandbox Runners** | Docker container pool for `docker-sandbox` mode | Banner, API, Header |
| **Runner** | Individual sandbox container assigned to a client | Header |
| **Simulation** | Client-side state: idle / compiling / queued / running / paused / stopped | Header |

---

## �💡 Admin Best Practices

1. **Configuration source:** **Never** change values directly in `server/config.ts`. Those changes are overwritten on future updates.
2. **Validation:** After changing configuration, run the deterministic and
   relevant external gates:
    * `npm run check` (type safety)
    * `npm run test:unit` (baseline functionality)
    * `npm run test:integration` or `npm run test:docker` as applicable
    * `npm run build` (production build)
    * `npm run sonar` with a local SonarQube server; the Quality Gate must be green
3. **Monitoring:** In `docker-sandbox` mode, monitor Docker host CPU load because starting many containers can create short spikes.
4. **Security:** Use `SIMULATOR_ALLOWED_PARENT_ORIGINS` to allow iframe embedding only on trusted domains.

### Authentication gateway

Docker/production mode is fail-closed and requires an authenticating reverse
proxy. Set `UNOSIM_GATEWAY_SECRET` to a random value with at least 32 characters
and `UNOSIM_TRUSTED_PROXY` to the exact proxy IP or CIDR before running Compose.
`UNOSIM_ALLOWED_WS_ORIGINS` must contain the comma-separated, exact browser
origins allowed to open `/ws`, for example `https://classroom.example`. Paths,
wildcards and a missing `Origin` are rejected in gateway mode.
Compose publishes port 3000 on loopback by default; `UNOSIM_BIND_ADDRESS` may
override this only with a private address reachable by the gateway.
The proxy must remove incoming `X-UnoSim-*` headers and inject the authenticated
subject and `user` role on both HTTP requests and WebSocket upgrades. The UnoSim
backend port must not be reachable by end users without passing through that
proxy. The complete contract and route matrix are defined in
[`docs/adr/0001-authentication-and-gateway-contract.md`](docs/adr/0001-authentication-and-gateway-contract.md).

For a trusted single-user development process, `UNOSIM_TRUST_MODE=local` is the
default and the server binds only to `127.0.0.1`. Production refuses local mode
unless `UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL=true` is explicitly set; that
override is only suitable for an otherwise isolated development environment.
