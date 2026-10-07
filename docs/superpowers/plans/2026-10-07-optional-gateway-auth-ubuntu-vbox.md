# Optional Gateway Authentication and Ubuntu VBox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align UnoSim's deployment documentation and Ubuntu VBox installer with the policy that gateway trust is mandatory while user authentication is optional.

**Architecture:** Keep the application gateway contract unchanged. Update the current deployment summaries and add ADR 0008 to supersede only ADR 0001's user-authentication requirement. Add an Ubuntu guide and guarded bootstrap script that configure Nginx as a TLS and identity-header proxy, with IP-derived identity by default.

**Tech Stack:** Markdown, Bash, Docker Compose v2, Nginx, OpenSSL, Node.js project checks.

**Spec:** `docs/superpowers/specs/2026-10-07-optional-gateway-auth-ubuntu-vbox-design.md`

## Global Constraints

- Docker mode requires `UNOSIM_GATEWAY_SECRET`, `UNOSIM_TRUSTED_PROXY`, `UNOSIM_ALLOWED_WS_ORIGINS`, a subject, and the `user` role.
- User authentication before the gateway is optional; IP-derived identity uses the directly observed `$remote_addr` and is not authentication.
- The Ubuntu script requires an explicit LAN IPv4, validates it is assigned locally, binds the backend to `127.0.0.1:3000`, and does not modify firewall, router, client DNS, client trust stores, or SSH configuration.
- Do not print the generated gateway secret or overwrite an existing `.env` or UnoSim Nginx site.
- Preserve ADR 0001 as historical and leave unrelated working-tree changes untouched.
- Do not change application authorization, gateway validation, isolation, rate limits, or origin checks.

## Review Focus

- Same-IP users share the IP-derived subject and its admission/rate limits; document NAT, VPN and upstream-proxy implications.
- `UNOSIM_TRUSTED_PROXY` configures Express proxy trust but current authorization does not compare the socket peer to this CIDR; document the loopback backend binding as the actual Ubuntu topology boundary.
- Browser origins omit the default HTTPS port and include `:8443` explicitly for both hostname and address forms.
- Nginx must set/overwrite the gateway secret, subject and role for both HTTP and WebSocket requests.
- Existing `.env`, UnoSim site, secret snippet or TLS assets must cause a safe abort before replacing operator state.

---

### Task 1: Update gateway policy records and current summaries

**Files:**
- Modify: `README.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/INSTALL_SERVER.md`
- Modify: `docs/ARCHITECTURE.md`
- Create: `docs/adr/0008-optional-gateway-authentication.md`
- Modify: `docker-compose.yml` comments if they still imply authentication is mandatory

- [x] Update Docker deployment wording to state that the trusted gateway contract is mandatory while authenticating a person is optional.
- [x] Document authenticated and IP-identified gateway modes, including that IP mode grants access to every reachable client and shares identity for clients behind the same observed IP.
- [x] State precisely that `UNOSIM_TRUSTED_PROXY` configures Express proxy trust and is not itself an authorization check of the peer address.
- [x] Document exact WebSocket origin matching and proxy header overwrite requirements for both HTTP and WebSocket traffic.
- [x] Add ADR 0008 with status Accepted; explain that it supersedes ADR 0001 only on the user-authentication requirement and preserves the mandatory gateway trust contract.
- [x] Describe the Docker installation entry consistently in README, security, installation and architecture summaries.
- [x] Avoid hard-coding an admission count in deployment summaries; describe the effective limit as source-version/configuration dependent.
- [x] Review changed paragraphs against the code in `server/security/access-control.ts`, `server/index.ts`, and `server/services/simulation-admission-controller.ts`.

### Task 2: Add and index the Ubuntu VBox installation guide

**Files:**
- Create: `README_UbuntuServer.md`
- Modify: `docs/README.md`

- [x] Write the clean Ubuntu Desktop prerequisites and step-by-step invocation of `scripts/install-ubuntu-vbox.sh --lan-ip <IPv4>` from the intended checkout.
- [x] Explain the resulting URLs `https://unosim.vbox/` and `https://unosim.vbox:8443/`, the generated certificate location, and Docker readiness/simulation verification.
- [x] Cover DHCP reservation and hostname resolution using router-local DNS or a single-client hosts entry.
- [x] Explain client trust of the self-signed certificate; provide optional temporary SSH transfer instructions and the command to disable `ssh.socket` afterward.
- [x] Explain that TCP 443 and optional 8443 may need an operator firewall rule, without changing UFW in the script.
- [x] Clearly distinguish gateway secret/header trust from optional user authentication, and explain shared-IP identity consequences.
- [x] Explain that the effective per-identity simulation admission limit comes from the installed source/configuration, not a fixed README promise.

### Task 3: Add the guarded Ubuntu bootstrap script

**Files:**
- Create: `scripts/install-ubuntu-vbox.sh`
- Create: `scripts/test-install-ubuntu-vbox.sh`

- [x] Write a shell regression test that passes malformed `--lan-ip` input and asserts the installer rejects it before invoking system changes; run it to observe the expected failure before adding the installer.
- [x] Implement Bash argument parsing for required `--lan-ip IPv4`; reject non-Ubuntu hosts, malformed IPv4, and addresses not assigned to the host before making changes.
- [x] Require execution from the UnoSim checkout and verify required Dockerfile, Compose and Nginx paths exist.
- [x] Preflight `.env`, UnoSim Nginx site, gateway-secret snippet and TLS target paths; abort rather than overwrite existing operator files.
- [x] Install `docker.io`, `docker-compose-v2`, `docker-buildx`, `nginx`, `openssl` and `curl`; add the invoking user to the `docker` group.
- [x] Create runtime directories, then write `.env` with mode 0600, socket GID, a 64-hex-character generated secret, `UNOSIM_TRUSTED_PROXY=127.0.0.1/32`, and exact origins for hostname, LAN IPv4, localhost and loopback at default HTTPS and explicit 8443 ports. Do not echo the secret.
- [x] Build `unosim-sandbox:latest` from `Dockerfile.sandbox`, then build/start only `unosim-backend` with `UNOSIM_BIND_ADDRESS=127.0.0.1`.
- [x] Generate a self-signed certificate with SANs for `unosim.vbox`, `localhost`, `127.0.0.1`, and the supplied LAN IPv4.
- [x] Install a root-owned 0600 Nginx secret snippet and a site listening on loopback and LAN IPv4 at 443 and 8443, with no Basic Auth, `ip-$remote_addr` subject, `user` role, HTTP forwarding, and WebSocket upgrade/timeout headers.
- [x] Preserve the package default site file, disable only its standard enabled symlink, and abort if that link is custom or a listener already occupies ports 443 or 8443. Enable the new site, run `nginx -t`, and reload only after validation passes; remove the new enabled symlink if validation fails.
- [x] Print service URLs, certificate path and remaining client-side setup steps; never print secrets.

### Task 4: Verify documentation, script and repository checks

**Files:**
- Verify: all files above

- [x] Run `bash scripts/test-install-ubuntu-vbox.sh`, `bash -n scripts/install-ubuntu-vbox.sh` and `shellcheck scripts/install-ubuntu-vbox.sh` when ShellCheck is available.
- [x] Run `git diff --check`, `npm run check`, `npm run check:docs`, and `npm run test:deployment` if Docker is available.
- [x] Run relevant safe docs and shell checks, then inspect `git status --short` and ensure unrelated pre-existing changes are untouched.
- [x] Inspect `run-tests.sh`; run `./run-tests.sh` only if its cleanup and process/port effects cannot touch existing user state.
- [x] Do not push or merge.
