#!/usr/bin/env bash
# Renders the runtime configuration of the Ubuntu/VBox deployment. The
# installer writes this output to the host; the automated deployment test
# renders the same files, so both use one definition of the trust chain.
#
#   ubuntu-vbox-render.sh env --lan-ip IPv4 --docker-gid GID     (secret on stdin)
#   ubuntu-vbox-render.sh nginx-site --lan-ip IPv4
#   ubuntu-vbox-render.sh nginx-secret-snippet                   (secret on stdin)
set -Eeuo pipefail

# Host Nginx reaches the backend through the loopback-published port. Docker
# forwards that connection from the gateway of the Compose network, so the
# backend sees this gateway address, never 127.0.0.1, as its peer. A fixed
# subnet makes the address deterministic and lets it be the trusted proxy.
UNOSIM_DOCKER_SUBNET='172.31.253.0/24'
UNOSIM_DOCKER_GATEWAY='172.31.253.1'

NGINX_SECRET_SNIPPET='/etc/nginx/snippets/unosim-gateway-secret.conf'
TLS_CERT='/etc/nginx/unosim-tls/unosim-lan.crt'
TLS_KEY='/etc/nginx/unosim-tls/unosim-lan.key'

fail() {
  printf 'Fehler: %s\n' "$1" >&2
  exit 1
}

is_valid_ipv4() {
  local address="$1"
  local octet
  local -a octets

  [[ "$address" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  IFS='.' read -r -a octets <<< "$address"
  for octet in "${octets[@]}"; do
    # Avoid ambiguous octal-looking values such as 010.
    [[ "${#octet}" -gt 1 && "$octet" == 0* ]] && return 1
    ((10#$octet <= 255)) || return 1
  done
}

read_secret() {
  local secret
  IFS= read -r secret || true
  [[ "$secret" =~ ^[A-Za-z0-9._~-]{32,}$ ]] || fail 'Das Gateway-Secret muss mindestens 32 URL-sichere Zeichen enthalten.'
  printf '%s' "$secret"
}

render_env() {
  local lan_ip="$1" docker_gid="$2" secret origins
  [[ "$docker_gid" =~ ^[0-9]+$ ]] || fail '--docker-gid muss eine numerische Gruppen-ID sein.'
  secret="$(read_secret)"
  origins="https://unosim.vbox,https://unosim.vbox:8443,https://${lan_ip},https://${lan_ip}:8443,https://localhost,https://localhost:8443,https://127.0.0.1,https://127.0.0.1:8443"
  printf 'DOCKER_GID=%s\n' "$docker_gid"
  printf 'UNOSIM_GATEWAY_SECRET=%s\n' "$secret"
  printf 'UNOSIM_DOCKER_SUBNET=%s\n' "$UNOSIM_DOCKER_SUBNET"
  printf 'UNOSIM_DOCKER_GATEWAY=%s\n' "$UNOSIM_DOCKER_GATEWAY"
  printf 'UNOSIM_TRUSTED_PROXY=%s/32\n' "$UNOSIM_DOCKER_GATEWAY"
  printf 'UNOSIM_ALLOWED_WS_ORIGINS=%s\n' "$origins"
  printf 'UNOSIM_BIND_ADDRESS=127.0.0.1\n'
}

render_nginx_secret_snippet() {
  local secret
  secret="$(read_secret)"
  printf 'proxy_set_header X-UnoSim-Gateway-Secret "%s";\n' "$secret"
}

render_nginx_site() {
  local lan_ip="$1"
  # This site intentionally has no auth_basic directive. The gateway role is a
  # UnoSim role header; it is not a username or a claim of user authentication.
  cat <<NGINX
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 127.0.0.1:443 ssl;
    listen ${lan_ip}:443 ssl;
    listen 127.0.0.1:8443 ssl;
    listen ${lan_ip}:8443 ssl;
    server_name unosim.vbox localhost ${lan_ip};

    ssl_certificate     ${TLS_CERT};
    ssl_certificate_key ${TLS_KEY};

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Real-IP \$remote_addr;

        include ${NGINX_SECRET_SNIPPET};
        proxy_set_header X-UnoSim-Subject "ip-\$remote_addr";
        proxy_set_header X-UnoSim-Roles "user";

        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_read_timeout 120s;
    }
}
NGINX
}

command="${1:-}"
shift || true
lan_ip=''
docker_gid=''
while (($# > 0)); do
  case "$1" in
    --lan-ip)
      (($# >= 2)) || fail 'Nach --lan-ip fehlt die IPv4-Adresse.'
      lan_ip="$2"
      shift 2
      ;;
    --docker-gid)
      (($# >= 2)) || fail 'Nach --docker-gid fehlt die Gruppen-ID.'
      docker_gid="$2"
      shift 2
      ;;
    *)
      fail "Unbekanntes Argument: $1"
      ;;
  esac
done

case "$command" in
  env)
    is_valid_ipv4 "$lan_ip" || fail '--lan-ip muss eine gültige IPv4-Adresse enthalten.'
    render_env "$lan_ip" "$docker_gid"
    ;;
  nginx-site)
    is_valid_ipv4 "$lan_ip" || fail '--lan-ip muss eine gültige IPv4-Adresse enthalten.'
    render_nginx_site "$lan_ip"
    ;;
  nginx-secret-snippet)
    render_nginx_secret_snippet
    ;;
  *)
    fail 'Verwendung: ubuntu-vbox-render.sh env|nginx-site|nginx-secret-snippet [--lan-ip IPv4] [--docker-gid GID]'
    ;;
esac
