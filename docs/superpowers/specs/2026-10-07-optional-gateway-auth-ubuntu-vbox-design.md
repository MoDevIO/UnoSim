# Optional Gateway Authentication and Ubuntu VBox Setup

- Status: Proposed
- Date: 2026-10-07
- Scope: deployment documentation and a commented Ubuntu bootstrap script

## Goal

Document and automate the tested UnoSim Docker setup on an Ubuntu Desktop VM:
Nginx provides TLS and the UnoSim gateway headers, user login is optional, and
the no-login configuration identifies clients by source IP. The browser uses
`https://unosim.vbox/` on port 443, with port 8443 retained as an alternate.

## Current contract

Docker mode continues to require a trusted reverse proxy. The backend still
requires the gateway secret, a trusted proxy address, a subject and the `user`
role for requests. The proxy may authenticate users, or it may grant access to
every client that can reach it.

In the no-login configuration, the proxy sets the subject from the connection's
source IP (`ip-$remote_addr`). Clients reaching the proxy from the same source
IP share an UnoSim identity and therefore share identity-based rate limits and
simulation admission limits. The current feature branch allows up to five
active or waiting simulations per identity. Network reachability is the access
boundary in this mode. A client that can reach the proxy can use UnoSim.

This policy does not make origin validation or the gateway secret optional.
The backend remains bound to loopback, and Nginx supplies the gateway headers
for both HTTP and WebSocket traffic. The documented no-login setup is intended
for a trusted private network. Authentication remains available for deployments
that need individual accounts or a stronger identity boundary.

## Decision record approach

Add a new ADR that supersedes the authentication-required statement in ADR
0001 while retaining ADR 0001 as the historical gateway contract. Update the
current summary documents to say that the reverse proxy and gateway headers
remain required in Docker mode while user authentication is optional.

## Documentation changes

Update these files consistently:

- `README.md` — explain the required gateway variables and distinguish gateway
  identity from optional user authentication.
- `docs/SECURITY.md` — describe authenticated and IP-identified gateway
  configurations, their identity boundaries and access implications.
- `docs/INSTALL_SERVER.md` — document the proxy contract, optional login, and
  exact-origin allowlist without presenting the IP mode as an authentication
  mechanism.
- `docs/ARCHITECTURE.md` — align the runtime and WebSocket summaries.
- `docs/README.md` — index the Ubuntu guide and clarify the Docker installation
  entry.
- Add `docs/adr/0008-optional-gateway-authentication.md` to amend the relevant
  decision in ADR 0001 while preserving its history.
- Add root-level `README_UbuntuServer.md` for a clean Ubuntu Desktop install.
- Add `scripts/install-ubuntu-vbox.sh`, the commented Bash bootstrap script.

## Ubuntu bootstrap script

Add a commented Bash script under `scripts/` that runs from an existing UnoSim
checkout. It must:

1. Require Ubuntu and an explicit LAN IPv4 address so it does not accidentally
   select a NAT or Docker interface.
2. Install Ubuntu packages for Docker Engine, Compose v2, Buildx, Nginx and
   OpenSSL; add the invoking user to the Docker group.
3. Create the runtime directories and a mode-0600 `.env` with a generated
   gateway secret, Docker socket group ID, loopback trusted proxy, and exact
   WebSocket origins for `unosim.vbox`, the LAN IP, localhost, ports 443 and
   8443.
4. Build the sandbox image, build/start the backend Compose service, and keep
   the backend bound to `127.0.0.1:3000`.
5. Generate a self-signed TLS certificate whose SANs include `unosim.vbox`,
   localhost, `127.0.0.1`, and the supplied LAN IPv4.
6. Configure Nginx on loopback and the supplied LAN IPv4 at ports 443 and 8443.
   Nginx must pass the gateway secret and role, derive the subject from
   `$remote_addr`, forward HTTP and WebSocket traffic, and omit HTTP Basic Auth.
7. Validate Nginx configuration before reload and report the URLs, certificate
   path, and client-side steps still required.

The script must not change UFW policy, router settings, client DNS, client trust
stores, or install/enable an SSH server. It must avoid printing generated
secrets and must preserve or stop safely when an existing `.env` or Nginx site
would be overwritten.

## Client and network steps in the README

The README will cover:

- reserving the VM's LAN IPv4 in the router;
- resolving `unosim.vbox` through router-local DNS for the whole LAN or a hosts
  entry on a single client;
- trusting the generated self-signed certificate on each client;
- optional temporary certificate transfer over SSH and disabling the SSH
  socket afterward;
- allowing TCP 443 (and optionally 8443) if a host firewall is active;
- verifying Docker readiness and testing a simulation from the client.

The guide will use the UnoSim checkout containing these files; the installation
must build the same source revision that provides the documented five-per-IP
simulation limit.

## Out of scope

- Changing application authorization code or removing the gateway secret,
  proxy-header validation, Docker isolation, rate limits, or origin checks.
- Automatically configuring a router, DHCP reservation, or client operating
  system.
- Recommending an unauthenticated service for an untrusted or public network.

## Acceptance criteria

- No current summary document says that user authentication is mandatory for
  every Docker deployment.
- The documentation clearly distinguishes the mandatory gateway trust contract
  from optional user authentication.
- The IP-based configuration accurately explains shared-IP identity and its
  access consequences, including the current five-simulation limit per IP.
- The Ubuntu README and script describe the same hostname, ports, certificate,
  identity headers and WebSocket origins as the tested VBox setup.
- Existing unrelated working-tree changes remain untouched.
