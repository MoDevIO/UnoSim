# Lokale Installation und Entwicklung

Die lokale Entwicklung ist eines von zwei unterstützten Runtime-Profilen. Der
Server, die Arduino-Kompilierung und die Simulation laufen auf derselben
Entwicklungsmaschine. Dieses Profil ist für einen vertrauenswürdigen einzelnen
Benutzer bestimmt und lauscht standardmäßig nur auf `127.0.0.1`.

## Voraussetzungen

- Linux oder macOS
- Node.js gemäß `.nvmrc`
- `npm`
- Arduino CLI mit `arduino:avr` Core

Docker ist für lokale Entwicklung nicht erforderlich.

## Installation

```bash
git clone https://github.com/MoDevIO/UnoSim.git
cd UnoSim
npm ci
arduino-cli core update-index
arduino-cli core install arduino:avr
```

## Start

Backend und Vite-Frontend mit Hot Reload:

```bash
npm run dev:full
```

Nur Backend:

```bash
npm run dev
```

Die Projektskripte setzen `NODE_ENV=development` und
`UNOSIM_SERVER_MODE=local`. Der Local-Modus verwendet lokale Sessions und führt
Sketches als lokale Prozesse aus. Docker wird weder geprüft noch als Fallback
verwendet.

## Konfiguration

`UNOSIM_SERVER_MODE` ist der einzige Topologie-Schalter. Für Entwicklung ist
nur `local` gültig. Folgende frühere Schalter sind ungültig und führen zu einem
Startfehler:

- `UNOSIM_SIMULATION_MODE`
- `UNOSIM_TRUST_MODE`
- `FORCE_DOCKER`
- `UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL`

Häufig verwendete optionale Werte:

| Variable | Default | Zweck |
|---|---:|---|
| `PORT` | `3000` | Backend-Port |
| `ARDUINO_FQBN` | `arduino:avr:uno` | Arduino-Zielplattform |
| `ARDUINO_CACHE_DIR` | projektlokal | Arduino-Cache |
| `WORKER_COUNT` | CPU-abhängig | Compile-Worker |
| `COMPILE_MAX_CONCURRENT` | CPU-abhängig | maximale parallele Compiles |
| `UNOSIM_EXAMPLES_SOURCE` | `ttbombadil/unosim-examples` | öffentliches Examples-Repository |
| `UNOSIM_EXAMPLES_REF` | `main` | Examples-Ref; serverseitig zu einem Commit aufgelöst |
| `UNOSIM_EXAMPLES_ALLOWED_HOSTS` | GitHub-Hosts im Development | ausgehende Host-Allowlist |

External-Examples-Details stehen in
[`ssot_function_definition_ExternalExamples.md`](../ssot/ssot_function_definition_ExternalExamples.md).

## Tests

```bash
npm run check
npm run test:unit
npm run test:integration
npm run test:e2e
```

Docker-Sandbox-Tests sind ein getrenntes Gate und werden unter
[`INSTALL_SERVER.md`](INSTALL_SERVER.md) beschrieben.

## Fehlerbehebung

- Arduino CLI fehlt: `arduino-cli version` und `arduino-cli core list` prüfen.
- Port belegt: `lsof -nP -iTCP:3000 -sTCP:LISTEN` prüfen.
- Docker-Fehler im lokalen Profil weisen auf eine falsche Konfiguration hin;
  lokale Entwicklung verwendet Docker nicht.
