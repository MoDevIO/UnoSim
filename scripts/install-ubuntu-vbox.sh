#!/usr/bin/env bash
# Install the UnoSim Docker backend and an unauthenticated, IP-identified
# Nginx gateway on an Ubuntu Desktop host in a trusted private LAN.
set -Eeuo pipefail
umask 077

usage() {
  cat <<'USAGE'
Usage: ./scripts/install-ubuntu-vbox.sh --lan-ip IPv4

Run from an UnoSim checkout as a regular user with sudo access. The address
must already be assigned to this host's LAN-facing network interface.
USAGE
}

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

LAN_IP=''
while (($# > 0)); do
  case "$1" in
    --lan-ip)
      (($# >= 2)) || fail 'Nach --lan-ip fehlt die IPv4-Adresse.'
      LAN_IP="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "Unbekanntes Argument: $1"
      ;;
  esac
done

[[ -n "$LAN_IP" ]] || {
  usage >&2
  fail 'Bitte --lan-ip mit der LAN-IPv4-Adresse dieses Rechners angeben.'
}
is_valid_ipv4 "$LAN_IP" || fail '--lan-ip muss eine gültige IPv4-Adresse enthalten.'

[[ "$EUID" -ne 0 ]] || fail 'Bitte als normaler Benutzer starten; das Skript verwendet sudo für Systemänderungen.'
[[ -r /etc/os-release ]] || fail 'Diese Installation benötigt Ubuntu mit /etc/os-release.'
# shellcheck source=/etc/os-release
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == ubuntu ]] || fail 'Dieses Installationsskript unterstützt Ubuntu.'

command -v ip >/dev/null 2>&1 || fail 'Das Kommando ip fehlt; installiere zuerst das Ubuntu-Paket iproute2.'
LAN_INTERFACE="$(ip -o -4 addr show scope global | awk -v target="$LAN_IP" '
  {
    split($4, address, "/")
    if (address[1] == target) {
      print $2
      exit
    }
  }
')"
[[ -n "$LAN_INTERFACE" ]] || fail "Die Adresse $LAN_IP ist nicht als globale IPv4-Adresse auf diesem Rechner konfiguriert."
if [[ "$LAN_INTERFACE" =~ ^(docker0|docker_gwbridge|br-[[:xdigit:]]+|veth.*|virbr[0-9]*|cni[0-9]*|podman[0-9]*)$ ]]; then
  fail "$LAN_IP liegt auf der Container-/virtuellen Schnittstelle $LAN_INTERFACE, nicht auf der LAN-Schnittstelle."
fi

command -v sudo >/dev/null 2>&1 || fail 'sudo ist erforderlich.'
sudo -v

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)" || fail 'Das Skript muss aus einer UnoSim-Git-Arbeitskopie ausgeführt werden.'
[[ -f "$PROJECT_DIR/Dockerfile" ]] || fail 'Dockerfile fehlt in der UnoSim-Arbeitskopie.'
[[ -f "$PROJECT_DIR/Dockerfile.sandbox" ]] || fail 'Dockerfile.sandbox fehlt in der UnoSim-Arbeitskopie.'
[[ -f "$PROJECT_DIR/docker-compose.yml" ]] || fail 'docker-compose.yml fehlt in der UnoSim-Arbeitskopie.'

ENV_FILE="$PROJECT_DIR/.env"
NGINX_SITE="/etc/nginx/sites-available/unosim"
NGINX_ENABLED_SITE="/etc/nginx/sites-enabled/unosim"
NGINX_DEFAULT_SITE="/etc/nginx/sites-available/default"
NGINX_DEFAULT_LINK="/etc/nginx/sites-enabled/default"
NGINX_SECRET_SNIPPET="/etc/nginx/snippets/unosim-gateway-secret.conf"
TLS_DIR="/etc/nginx/unosim-tls"
TLS_CERT="$TLS_DIR/unosim-lan.crt"
TLS_KEY="$TLS_DIR/unosim-lan.key"

if [[ -e "$ENV_FILE" || -L "$ENV_FILE" ]]; then
  fail "$ENV_FILE existiert bereits; sichere oder entferne sie bewusst, bevor du das Skript erneut startest."
fi
for target in "$NGINX_SITE" "$NGINX_ENABLED_SITE" "$NGINX_SECRET_SNIPPET" "$TLS_CERT" "$TLS_KEY"; do
  if sudo test -e "$target" || sudo test -L "$target"; then
    fail "$target existiert bereits; das Skript überschreibt keine vorhandene Nginx- oder TLS-Datei."
  fi
done
if sudo test -e "$NGINX_DEFAULT_LINK" || sudo test -L "$NGINX_DEFAULT_LINK"; then
  sudo test -L "$NGINX_DEFAULT_LINK" || fail "$NGINX_DEFAULT_LINK ist keine Standard-Symlink-Datei; prüfe die vorhandene Nginx-Konfiguration."
  DEFAULT_SITE_TARGET="$(sudo readlink -f "$NGINX_DEFAULT_LINK")"
  [[ "$DEFAULT_SITE_TARGET" == "$NGINX_DEFAULT_SITE" ]] || fail "$NGINX_DEFAULT_LINK verweist auf eine eigene Site; das Skript entfernt keine benutzerdefinierte Konfiguration."
fi

if command -v ss >/dev/null 2>&1 && ss -H -ltn 'sport = :443 or sport = :8443' | grep -q .; then
  fail 'TCP-Port 443 oder 8443 wird bereits verwendet; prüfe den vorhandenen Dienst vor der Installation.'
fi

printf 'Installiere Docker, Compose, Buildx, Nginx, OpenSSL und curl …\n'
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 docker-buildx nginx openssl curl
sudo systemctl daemon-reload
sudo systemctl enable --now docker

for nginx_directory in /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/nginx/snippets; do
  sudo test -d "$nginx_directory" || fail "Nginx-Verzeichnis fehlt nach der Paketinstallation: $nginx_directory"
done

# The Ubuntu package enables a welcome page on HTTP port 80. Disable only its
# standard symlink, preserving the package's file; stop on a custom site.
if sudo test -e "$NGINX_DEFAULT_LINK" || sudo test -L "$NGINX_DEFAULT_LINK"; then
  sudo test -L "$NGINX_DEFAULT_LINK" || fail "$NGINX_DEFAULT_LINK ist keine Standard-Symlink-Datei; prüfe die vorhandene Nginx-Konfiguration."
  DEFAULT_SITE_TARGET="$(sudo readlink -f "$NGINX_DEFAULT_LINK")"
  [[ "$DEFAULT_SITE_TARGET" == "$NGINX_DEFAULT_SITE" ]] || fail "$NGINX_DEFAULT_LINK verweist auf eine eigene Site; das Skript entfernt keine benutzerdefinierte Konfiguration."
  sudo rm -- "$NGINX_DEFAULT_LINK"
fi

INSTALL_USER="$(id -un)"
getent passwd "$INSTALL_USER" >/dev/null || fail "Der aufrufende Benutzer $INSTALL_USER ist nicht bekannt."
getent group docker >/dev/null || fail 'Die Docker-Gruppe wurde vom Paket docker.io nicht angelegt.'
sudo usermod -aG docker "$INSTALL_USER"

sudo docker info >/dev/null || fail 'Der Docker-Daemon ist nicht erreichbar.'
DOCKER_GID="$(stat -c '%g' /var/run/docker.sock)"
GATEWAY_SECRET="$(openssl rand -hex 32)"
ALLOWED_ORIGINS="https://unosim.vbox,https://unosim.vbox:8443,https://${LAN_IP},https://${LAN_IP}:8443,https://localhost,https://localhost:8443,https://127.0.0.1,https://127.0.0.1:8443"

# Store secrets locally with owner-only access. noclobber also protects against
# a .env file appearing between the preflight check and this write.
(
  umask 077
  set -o noclobber
  printf 'DOCKER_GID=%s\nUNOSIM_GATEWAY_SECRET=%s\nUNOSIM_TRUSTED_PROXY=127.0.0.1/32\nUNOSIM_ALLOWED_WS_ORIGINS=%s\nUNOSIM_BIND_ADDRESS=127.0.0.1\n' \
    "$DOCKER_GID" "$GATEWAY_SECRET" "$ALLOWED_ORIGINS" > "$ENV_FILE"
)
chmod 600 "$ENV_FILE"

# These directories are bind-mounted into the backend container at runtime.
mkdir -p "$PROJECT_DIR/server/arduino-cache" "$PROJECT_DIR/temp" "$PROJECT_DIR/storage"

cd "$PROJECT_DIR"
printf 'Baue das UnoSim-Sandbox-Image …\n'
sudo docker build -f Dockerfile.sandbox -t unosim-sandbox:latest .

printf 'Baue und starte den UnoSim-Backenddienst …\n'
sudo env PWD="$PROJECT_DIR" docker compose --project-directory "$PROJECT_DIR" up -d --build unosim-backend

# Keep the private key readable only by root and the public certificate
# readable by Nginx's workers and client transfer tools.
sudo install -d -o root -g root -m 700 "$TLS_DIR"
sudo openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout "$TLS_KEY" \
  -out "$TLS_CERT" \
  -subj "/CN=unosim.vbox" \
  -addext "subjectAltName=DNS:unosim.vbox,DNS:localhost,IP:127.0.0.1,IP:${LAN_IP}"
sudo chmod 600 "$TLS_KEY"
sudo chmod 644 "$TLS_CERT"

# The gateway secret is sent over stdin so it is not written to the terminal
# or exposed as an argument in a process listing.
printf 'proxy_set_header X-UnoSim-Gateway-Secret "%s";\n' "$GATEWAY_SECRET" \
  | sudo tee "$NGINX_SECRET_SNIPPET" >/dev/null
sudo chown root:root "$NGINX_SECRET_SNIPPET"
sudo chmod 600 "$NGINX_SECRET_SNIPPET"

# This site intentionally has no auth_basic directive. The gateway role is a
# UnoSim role header; it is not a username or a claim of user authentication.
sudo tee "$NGINX_SITE" >/dev/null <<NGINX
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 127.0.0.1:443 ssl;
    listen ${LAN_IP}:443 ssl;
    listen 127.0.0.1:8443 ssl;
    listen ${LAN_IP}:8443 ssl;
    server_name unosim.vbox localhost ${LAN_IP};

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
sudo chown root:root "$NGINX_SITE"
sudo chmod 644 "$NGINX_SITE"
sudo ln -s "$NGINX_SITE" "$NGINX_ENABLED_SITE"

if ! sudo nginx -t; then
  sudo rm -f "$NGINX_ENABLED_SITE"
  fail 'Nginx-Konfiguration ist ungültig; der neue Site-Link wurde entfernt und Nginx nicht neu geladen.'
fi

if sudo systemctl is-active --quiet nginx; then
  if ! sudo systemctl reload nginx; then
    sudo rm -f "$NGINX_ENABLED_SITE"
    fail 'Nginx konnte nicht neu geladen werden; der neue Site-Link wurde entfernt.'
  fi
else
  if ! sudo systemctl enable --now nginx; then
    sudo rm -f "$NGINX_ENABLED_SITE"
    fail 'Nginx konnte nicht gestartet werden; der neue Site-Link wurde entfernt.'
  fi
fi

printf '\nUnoSim ist eingerichtet.\n'
printf 'URLs:             https://unosim.vbox/ und https://unosim.vbox:8443/\n'
printf 'LAN-IP:           %s\n' "$LAN_IP"
printf 'TLS-Zertifikat:   %s\n' "$TLS_CERT"
printf 'Backend:          127.0.0.1:3000 (nur Loopback)\n'
printf 'Nächste Schritte: DHCP-Reservierung, DNS/Hosts-Eintrag und Zertifikatsvertrauen auf jedem Client einrichten.\n'
printf 'Firewall-Regeln für TCP 443/8443 bei Bedarf selbst konfigurieren; das Skript hat UFW nicht verändert.\n'
printf 'Eine Gruppenänderung wird nach der nächsten Anmeldung am Ubuntu-Desktop wirksam.\n'
