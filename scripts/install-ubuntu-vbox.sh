#!/usr/bin/env bash
# Install the UnoSim Docker backend and an unauthenticated, IP-identified
# Nginx gateway on an Ubuntu Desktop host in a trusted private LAN.
set -Eeuo pipefail
umask 077

usage() {
  cat <<'USAGE'
Usage: ./scripts/install-ubuntu-vbox.sh --lan-ip IPv4

Run from an UnoSim checkout as a regular user with sudo access. The address
must already be assigned to this host's LAN-facing network interface. The
script cannot tell whether a VirtualBox adapter uses NAT or a network bridge;
the usual NAT address 10.0.2.15 is not reachable directly from the LAN.
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
printf 'Verwende LAN-Adresse %s auf %s. Prüfe bei VirtualBox, dass der Adapter als Netzwerkbrücke eingerichtet ist; die NAT-Adresse 10.0.2.15 ist normalerweise nicht aus dem LAN erreichbar.\n' \
  "$LAN_IP" "$LAN_INTERFACE"

command -v sudo >/dev/null 2>&1 || fail 'sudo ist erforderlich.'
sudo -v

command -v git >/dev/null 2>&1 || fail 'Git fehlt. Installiere es mit „sudo apt update && sudo apt install -y git“ und starte das Skript aus dem UnoSim-Verzeichnis erneut.'
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)" || fail 'Das Skript muss aus einer UnoSim-Git-Arbeitskopie ausgeführt werden.'
[[ -f "$PROJECT_DIR/Dockerfile" ]] || fail 'Dockerfile fehlt in der UnoSim-Arbeitskopie.'
[[ -f "$PROJECT_DIR/Dockerfile.sandbox" ]] || fail 'Dockerfile.sandbox fehlt in der UnoSim-Arbeitskopie.'
[[ -f "$PROJECT_DIR/docker-compose.yml" ]] || fail 'docker-compose.yml fehlt in der UnoSim-Arbeitskopie.'
RENDER="$SCRIPT_DIR/ubuntu-vbox-render.sh"
[[ -f "$RENDER" ]] || fail 'scripts/ubuntu-vbox-render.sh fehlt in der UnoSim-Arbeitskopie.'

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

# These directories are bind-mounted into the backend container at runtime.
mkdir -p "$PROJECT_DIR/server/arduino-cache" "$PROJECT_DIR/temp" "$PROJECT_DIR/storage"

cd "$PROJECT_DIR"
printf 'Baue das UnoSim-Sandbox-Image …\n'
sudo docker build -f Dockerfile.sandbox -t unosim-sandbox:latest .

# Generate the runtime environment only after the independent sandbox build
# succeeds. That avoids leaving a partial .env behind if that build fails.
DOCKER_GID="$(stat -c '%g' /var/run/docker.sock)"
GATEWAY_SECRET="$(openssl rand -hex 32)"

# Store secrets locally with owner-only access. noclobber also protects against
# a .env file appearing between the preflight check and this write. The secret
# goes over stdin so it never appears in a process listing.
(
  umask 077
  set -o noclobber
  printf '%s\n' "$GATEWAY_SECRET" \
    | bash "$RENDER" env --lan-ip "$LAN_IP" --docker-gid "$DOCKER_GID" > "$ENV_FILE"
)
chmod 600 "$ENV_FILE"

printf 'Baue das UnoSim-Backend-Image …\n'
if ! sudo env PWD="$PROJECT_DIR" docker compose --project-directory "$PROJECT_DIR" build unosim-backend; then
  printf 'Der Backend-Build mit Docker-Cache ist fehlgeschlagen. Wiederhole ihn einmal ohne Cache …\n' >&2
  if ! sudo env PWD="$PROJECT_DIR" docker compose --project-directory "$PROJECT_DIR" build --no-cache unosim-backend; then
    printf '\nDer automatische Build-Versuch ohne Cache ist ebenfalls fehlgeschlagen.\n' >&2
    printf 'Prüfe den Buildfehler. Ein erneuter manueller Versuch ist mit diesem Befehl möglich:\n' >&2
    printf '  sudo docker compose --project-directory %q build --no-cache unosim-backend\n' "$PROJECT_DIR" >&2
    printf 'Wenn er erfolgreich ist, verschiebe die vom fehlgeschlagenen Lauf angelegte .env root-geschützt und starte dieses Skript erneut.\n' >&2
    fail 'UnoSim-Backend konnte auch ohne Docker-Cache nicht gebaut werden.'
  fi
fi

printf 'Starte den UnoSim-Backenddienst …\n'
sudo env PWD="$PROJECT_DIR" docker compose --project-directory "$PROJECT_DIR" up -d --no-build unosim-backend

printf 'Warte auf die Backend-Readiness …\n'
BACKEND_READINESS="$(curl --retry 10 --retry-connrefused --retry-delay 2 --fail --silent --show-error \
  http://127.0.0.1:3000/api/readiness)" || {
  sudo env PWD="$PROJECT_DIR" docker compose --project-directory "$PROJECT_DIR" logs --tail 80 unosim-backend >&2 || true
  fail 'Der Backenddienst wurde gestartet, meldet aber keine Readiness. Prüfe die Compose-Logs.'
}
printf 'Backend-Readiness: %s\n' "$BACKEND_READINESS"

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
printf '%s\n' "$GATEWAY_SECRET" \
  | bash "$RENDER" nginx-secret-snippet \
  | sudo tee "$NGINX_SECRET_SNIPPET" >/dev/null
sudo chown root:root "$NGINX_SECRET_SNIPPET"
sudo chmod 600 "$NGINX_SECRET_SNIPPET"

# The site, the .env and the secret snippet come from one renderer that the
# automated deployment test uses as well.
bash "$RENDER" nginx-site --lan-ip "$LAN_IP" | sudo tee "$NGINX_SITE" >/dev/null
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

printf 'Prüfe HTTPS-Gateway und Proxy …\n'
GATEWAY_READINESS="$(curl --retry 10 --retry-connrefused --retry-delay 2 --fail --silent --show-error \
  --insecure --resolve 'unosim.vbox:443:127.0.0.1' \
  https://unosim.vbox/api/readiness)" || fail 'Nginx ist aktiv, aber die Readiness-Prüfung über HTTPS ist fehlgeschlagen.'
printf 'Gateway-Readiness: %s\n' "$GATEWAY_READINESS"

printf '\nUnoSim ist eingerichtet.\n'
printf 'URLs:             https://unosim.vbox/ und https://unosim.vbox:8443/\n'
printf 'LAN-IP:           %s\n' "$LAN_IP"
printf 'TLS-Zertifikat:   %s\n' "$TLS_CERT"
printf 'Backend:          127.0.0.1:3000 (nur Loopback)\n'
printf 'Nächste Schritte: DHCP-Reservierung, DNS/Hosts-Eintrag und Zertifikatsvertrauen auf jedem Client einrichten.\n'
printf 'Firewall-Regeln für TCP 443/8443 bei Bedarf selbst konfigurieren; das Skript hat UFW nicht verändert.\n'
printf 'Eine Gruppenänderung wird nach der nächsten Anmeldung am Ubuntu-Desktop wirksam.\n'
