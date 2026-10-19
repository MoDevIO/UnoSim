# Funktionsbeschreibung: Board-Katalog

Status: current  
Zielrolle: feature-contract  
Ziel-SSOT für den Board-Katalog von UnoSim: welche Boards es gibt, welche FQBN und welchen Core sie nutzen, welche Laufzeiten sie anbieten und wann sie freigegeben sind. Pins, MCU-Daten und Takt beschreibt das Paket `@unosim/avr-emulator`; Erweiterungen (Board in Compile-Request, Auswahl im Client) folgen mit den Paketen P2.2 und P4.x des [Umsetzungsplans](../docs/proposals/browser-emulation-plan.md).

## Governance-Grenzen

- Der Katalog liegt in `shared/boards.ts`; er ist die einzige Quelle für Board-IDs, Namen, FQBN, Core und Status. Das Paket importiert nichts aus UnoSim, `shared/` darf das Paket (über `@unosim/avr-emulator/boards`, ohne Emulationscode) importieren.
- Pins und Hardware eines Boards stehen ausschließlich im Paket (`packages/avr-emulator/src/boards/`). Der Katalog wiederholt sie nicht.
- Der externe `postMessage`-Vertrag liegt in `docs/EXTERNAL_API.md`, nicht hier.

## 1. Einträge

| Feld | Bedeutung |
|---|---|
| `id` | `uno`, `nano`, `mega2560`, `attiny85` (zugleich Board-ID des Pakets; ein Compile-Zeit-Test hält beide gleich) |
| `displayName` | Anzeigename („Arduino Uno“) |
| `fqbn` | FQBN für `arduino-cli`, einschließlich der Menüoptionen |
| `core` | gepinnte Core-ID und Version |
| `runtimes` | angebotene Laufzeiten: `browser` (Emulation), `host-mock` (Legacy) |
| `status` | `planned`, `preview`, `available` |

| Board | FQBN | Core | Laufzeiten |
|---|---|---|---|
| `uno` | `arduino:avr:uno` | `arduino:avr` 1.8.8 | `browser`, `host-mock` |
| `nano` | `arduino:avr:nano:cpu=atmega328` | `arduino:avr` 1.8.8 | `browser` |
| `mega2560` | `arduino:avr:mega:cpu=atmega2560` | `arduino:avr` 1.8.8 | `browser` |
| `attiny85` | `ATTinyCore:avr:attinyx5:chip=85,clock=8internal` | `ATTinyCore:avr` 1.5.2 | `browser` |

Der Host-Mock gilt nur für den Uno.

## 2. Freigabestatus

- `planned`: steht im Katalog und in den Typen, ist nicht wählbar.
- `preview`: wählbar mit Hinweis, sobald die Phase des Boards abgeschlossen ist.
- `available`: nach Review und Unterrichtseinsatz; ein Board wird erst `available`, wenn seine Proben Fälle der Klasse `hardware` im Korpus haben (TESTING_STANDARDS).

Alle vier Boards stehen mit `planned` im Katalog. Das Statuswort entscheidet über die Freischaltung, nicht über die Funktion des Uno: Der Standard-Board (`uno`) ist immer angeboten, weil Anfragen ohne Board ihn meinen.

## 3. Angebotene Boards

`enabledBoards(requested?, defaultBoard?)` liefert die Boards, die ein Betrieb anbietet: die angeforderten IDs, ohne Angabe alle Boards mit Status `preview` oder `available`, dazu immer das Standard-Board; Reihenfolge wie im Katalog. `GET /api/config` meldet sie als `boards` (`id`, `displayName`, `status`, `runtimes`; keine FQBN), außerdem `defaultBoard` und `runtime` (`backends`, `default`). Bis zum Browser-Backend (P3.2) und den Variablen aus Plan 4.11 (P2.6) ist `runtime` fest `host-mock`.

## 4. FQBN-Allowlist

`fqbnAllowlist()` liefert genau die FQBNs der übergebenen Katalogeinträge. `arduino-cli compile` darf keine andere FQBN erhalten; die Anbindung an die Argumentprüfung des Prozess-Executors folgt mit P2.2.

## 5. Pin-Aliasse

`boardPinAliases(id)` liefert die Pin-Namen, die die Sketch-Parser auflösen (`A0` → 14, `LED_BUILTIN`), aus der Pinbelegung des Pakets. Boards ohne Hardwareprofil im Paket (Mega 2560 bis P5.1, ATtiny85 bis P6.2) haben keine Aliasse.
