# Lokale Installation und Entwicklung

Die lokale Entwicklung ist eines von zwei unterstützten Runtime-Profilen. Der
Server, die Arduino-Kompilierung und die Simulation laufen auf derselben
Entwicklungsmaschine. Dieses Profil ist für einen vertrauenswürdigen einzelnen
Benutzer bestimmt und lauscht standardmäßig nur auf `127.0.0.1`.

## Voraussetzungen

- Linux oder macOS
- Node.js gemäß `.nvmrc`
- `npm`
- Arduino CLI mit `arduino:avr` Core und ATTinyCore (für den ATtiny85)

Docker ist für lokale Entwicklung nicht erforderlich.

## Installation

```bash
git clone https://github.com/MoDevIO/UnoSim.git
cd UnoSim
npm ci
sh scripts/install-arduino-avr-core.sh
sh scripts/install-attinycore.sh
```

Beide Skripte installieren die gepinnten Versionen (`scripts/arduino-avr-core-version`,
`scripts/attinycore-version`) und prüfen sie; sie lassen eine passende
Installation unverändert. ATTinyCore kommt nicht über den Board-Manager,
sondern als Release-Archiv mit geprüfter SHA-256 in das Sketchbook
(`<directories.user>/hardware/ATTinyCore/avr`, siehe
`arduino-cli config get directories.user`) und nutzt den avr-gcc von
`arduino:avr`. Eine `platform.local.txt` schaltet die Post-Build-Hooks des
Cores ab (Disassembler-Liste, Kopie in den Sketch-Ordner); das HEX ändert sich
dadurch nicht. Entfernen: diesen Ordner löschen.

Das Repository ist ein npm-Workspace: `npm ci` im Wurzelverzeichnis
installiert auch die Pakete unter `packages/` (derzeit der Emulationskern
`@unosim/avr-emulator`) und verlinkt sie unter `node_modules/@unosim/`. In
`packages/` selbst ist kein eigenes `npm install` nötig.

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

Weil Sketches nativ laufen, ist der Local-Modus nur vom eigenen Rechner aus
erreichbar: Vite lauscht auf `127.0.0.1:3001`, das Backend auf `127.0.0.1:3000`,
und das Backend nimmt nur Anfragen an `localhost` oder eine Loopback-Adresse an.
Aufruf über `http://localhost:3001`; LAN-Adressen und fremde Hostnamen werden
abgewiesen (siehe [SECURITY.md](SECURITY.md)).

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
| `UNOSIM_DEFAULT_BOARD` | `uno` | Standard-Board (`uno`, `nano`, `mega2560`, `attiny85`) |
| `UNOSIM_BOARDS` | alle Boards mit Status `preview` oder `available`, dazu das Standard-Board | angebotene Boards |
| `UNOSIM_RUNTIME_BACKENDS` | `browser,host-mock` | angebotene Laufzeiten (`browser` = Emulation, `host-mock` = Legacy); ohne `host-mock` startet kein Sandbox-Runner-Pool |
| `UNOSIM_DEFAULT_RUNTIME` | `browser` (lokal), `host-mock` (Docker) | Vorauswahl im Client; Nutzer wählen unter File → Settings → „Simulation engine“ selbst. Fehlt einem Build das Abbild der Emulation, startet der Host-Mock, sofern angeboten |
| `ARDUINO_FQBN` | – | veraltet, Alias für `UNOSIM_DEFAULT_BOARD`: nur die FQBN eines Katalogboards, und nur gemeinsam mit einem passenden `UNOSIM_DEFAULT_BOARD` |
| `ARDUINO_CACHE_DIR` | projektlokal | Arduino-Cache |
| `WORKER_COUNT` | CPU-abhängig | Compile-Worker |
| `COMPILE_MAX_CONCURRENT` | CPU-abhängig | maximale parallele Compiles |
| `UNOSIM_EXAMPLES_SOURCE` | `ttbombadil/unosim-examples` | öffentliches Examples-Repository |
| `UNOSIM_EXAMPLES_REF` | `main` | Examples-Ref; serverseitig zu einem Commit aufgelöst |
| `UNOSIM_EXAMPLES_ALLOWED_HOSTS` | GitHub-Hosts im Development | ausgehende Host-Allowlist |
| `UNOSIM_GITHUB_TOKEN` | leer | optionaler Read-only-Token nur für `api.github.com`; hebt das Ref-Kontingent von 60 auf 5000 Abfragen pro Stunde |

External-Examples-Details stehen in
[`ssot_function_definition_ExternalExamples.md`](../ssot/ssot_function_definition_ExternalExamples.md).

## Tests

```bash
npm run check
npm run test:unit
npm run test:integration
npm run test:e2e
```

`npm run test:unit` umfasst das Vitest-Projekt `unit-emulator` für
`packages/avr-emulator/tests/`; `npm run check` prüft das Paket mit seiner
eigenen, strengeren `tsconfig.json`.

Docker-Sandbox-Tests sind ein getrenntes Gate und werden unter
[`INSTALL_SERVER.md`](INSTALL_SERVER.md) beschrieben.

## Fehlerbehebung

- Arduino CLI fehlt: `arduino-cli version` und `arduino-cli core list` prüfen.
- Port belegt: `lsof -nP -iTCP:3000 -sTCP:LISTEN` prüfen.
- Docker-Fehler im lokalen Profil weisen auf eine falsche Konfiguration hin;
  lokale Entwicklung verwendet Docker nicht.

### Diagnose: Beispiele und GitHub-Commit-Auflösung

Die Ref-Auflösung fordert mit `Accept: application/vnd.github.sha` nur den
Commit-SHA an (eigenes Antwortlimit: 256 Bytes). Große Commit-Diffs beeinflussen
diesen Abruf nicht. `UNOSIM_EXAMPLES_MAX_MANIFEST_BYTES` begrenzt das eigentliche
Manifest, standardmäßig auf 262.144 Bytes. Eine nur wegen großer Commit-Antworten
gesetzte Erhöhung dieser Einstellung kann nach diesem Update entfernt werden;
eine für tatsächlich größere Manifeste benötigte Einstellung bleibt bestehen.
Konfigurationsänderungen erfordern einen Serverneustart bzw. die Neuerzeugung
des Backend-Containers. Bei Quellfehlern die sichere `resolve-ref`-Diagnose im
Backend-Log und die Erreichbarkeit von GitHub prüfen.

Der Diagnoseabruf `GET /api/examples/builtin/catalog` muss bei erreichbarem
Backend auch dann erfolgreich sein, wenn `/api/examples` wegen der externen
Quelle fehlschlägt. Er liest `public/examples` und akzeptiert keine Query-Parameter.
Das Menü lädt beide Gruppen getrennt und bietet bei Fehlern **Retry** an.
Das Hinzufügen eines Beispiel-Repositories zum IDE-Workspace stellt die Quelle
des laufenden Servers nicht um; maßgeblich bleiben Serverkonfiguration und
validierter Browser-Override.
