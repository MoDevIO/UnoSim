# ADR 0008: Optional user authentication at the gateway

- Status: Accepted
- Date: 2026-10-07
- Supersedes: the user-authentication requirement in ADR 0001 only

## Context

ADR 0001 established the Docker gateway as UnoSim's trust boundary and required
the gateway to authenticate the user. A private deployment may instead grant
access to every client that can reach the gateway and identify a client by its
network source address. User authentication and the UnoSim gateway trust
contract are separate concerns.

## Decision

Docker mode continues to require a trusted reverse proxy and a complete gateway
identity for both HTTP and WebSocket requests. The proxy must remove
client-supplied `X-UnoSim-*` headers, then set:

| Header | Contract |
|---|---|
| `X-UnoSim-Gateway-Secret` | High-entropy shared secret configured by the operator |
| `X-UnoSim-Subject` | Stable identity, 1–128 URL-safe characters |
| `X-UnoSim-Roles` | Comma-separated allowlist containing the accepted `user` role |

The proxy may authenticate a person and derive the subject from their account.
It may also run without user authentication and derive the subject from the
directly observed client address, such as Nginx's `$remote_addr`, not from a
client-supplied `X-Forwarded-For` value. This IP-identified gateway mode is not
user authentication. Every client that can reach the gateway can use UnoSim,
and clients arriving from the same observed IP share one subject and its rate
limits and simulation admission limits.
NAT, VPNs and upstream proxies can make multiple people share an identity.
Use this mode only within a trusted private network.

`UNOSIM_GATEWAY_SECRET`, `UNOSIM_TRUSTED_PROXY` and
`UNOSIM_ALLOWED_WS_ORIGINS` remain required in Docker mode. Origins remain an
exact allowlist for WebSocket handshakes; they do not replace gateway identity
or user authentication.

`UNOSIM_TRUSTED_PROXY` configures Express proxy trust behavior. The current
authorization middleware does not enforce this CIDR as a source-address ACL.
Operators must restrict backend reachability through deployment networking.
The documented Ubuntu setup publishes the backend only on
`127.0.0.1:3000` and uses Nginx as the host-local gateway.

## Consequences

- User authentication is available when deployments need individual accounts
  or a stronger identity boundary, but is not mandatory for every Docker
  deployment.
- IP identity is shared by clients behind the same observed address. It grants
  access based on network reachability and does not establish a person's
  identity.
- The gateway secret, role, subject validation, exact WebSocket origin checks,
  Docker isolation and rate/admission controls remain in force.
- ADR 0001 remains the historical record of the original runtime and gateway
  decision. This ADR changes only its requirement that the gateway authenticate
  a user.

## Rejected alternatives

- Removing the gateway or its secret would expose privileged compile and
  simulation operations without the required trust boundary.
- Treating source-IP identity as user authentication would misrepresent shared
  NAT, VPN and proxy identities.
- Removing exact WebSocket origin checks would weaken browser-origin controls
  without changing the identity contract.
