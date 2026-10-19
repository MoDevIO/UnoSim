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
| `displayName` | Anzeigename („Arduino UNO“, so steht es in der Compile-Ausgabe) |
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

## 3. Angebotene Boards und Laufzeiten

`enabledBoards(requested?, defaultBoard?)` liefert die Boards, die ein Betrieb anbietet: die angeforderten IDs, ohne Angabe alle Boards mit Status `preview` oder `available`, dazu immer das Standard-Board; Reihenfolge wie im Katalog.

Der Betrieb stellt sie mit vier Variablen ein (`server/runtime-settings.ts`, geprüft beim Start; ungültige Werte verhindern den Start):

| Variable | Werte | Standard |
|---|---|---|
| `UNOSIM_RUNTIME_BACKENDS` | Liste aus `browser`, `host-mock` | lokal `browser,host-mock`; Docker `host-mock`. Im Docker-Profil ist `browser` ohne Compile-Sandbox (Plan P2.4) unzulässig |
| `UNOSIM_DEFAULT_RUNTIME` | eines der angebotenen Backends | `host-mock`, sonst `browser`; wird mit P3.10 lokal `browser` |
| `UNOSIM_BOARDS` | Liste von Board-IDs | siehe oben |
| `UNOSIM_DEFAULT_BOARD` | Board-ID | `uno` |

`ARDUINO_FQBN` gilt als veralteter Alias für das Standard-Board: Sein Wert muss die FQBN eines Katalogboards sein und darf `UNOSIM_DEFAULT_BOARD` nicht widersprechen. Jedes angebotene Board (auch das Standard-Board) braucht mindestens eine angebotene Laufzeit, die es kann (`runtimes` im Katalog); sonst startet der Server nicht.

`GET /api/config` meldet `boards` (`id`, `displayName`, `status`, `runtimes`; keine FQBN), `defaultBoard` und `runtime` (`backends`, `default`).

## 4. FQBN-Allowlist

`fqbnAllowlist()` liefert genau die FQBNs der übergebenen Katalogeinträge. Der Prozess-Executor lässt `arduino-cli --fqbn <x>` nur zu, wenn `<x>` die FQBN eines Katalogboards ist; jede andere Angabe lehnt er ab, ohne einen Prozess zu starten. Ob ein Board angeboten wird, entscheidet die Route (Abschnitt 6).

## 5. Pin-Aliasse

`boardPinAliases(id)` liefert die Pin-Namen, die die Sketch-Parser auflösen (`A0` → 14, `LED_BUILTIN`), aus der Pinbelegung des Pakets. Boards ohne Hardwareprofil im Paket (Mega 2560 bis P5.1, ATtiny85 bis P6.2) haben keine Aliasse.

## 6. Board im Compile-Request

`POST /api/compile` nimmt das optionale Feld `board` (eine Katalog-ID). Das Feld `fqbn` ist veraltet:

- Mit `board` kompiliert die Route für die FQBN dieses Boards; ein zusätzlich angegebenes `fqbn` muss die FQBN desselben Boards sein.
- Ohne `board` bedeutet ein `fqbn` das Board, zu dem er gehört; ein `fqbn` außerhalb des Katalogs ist ungültig. Die Optionen an den Compiler bleiben dann wie bisher (`fqbn` wie angegeben, kein `board`).
- Ohne beides kompiliert der Server für sein Standard-Board.
- Ein Board, das der Betrieb nicht anbietet (Abschnitt 3), lehnt die Route mit 400 und „Board <id> is not available“ ab. Ein ungültiges Board oder ein unpassender `fqbn` ergibt 400 „Invalid compile request“.

Die Compile-Ausgabe nennt das Board mit dem Anzeigenamen des Katalogs („Board: Arduino UNO“); für eine FQBN außerhalb des Katalogs steht die FQBN selbst dort. Das Board läuft als `board` durch Compiler-Optionen und Worker-Auftrag; `CodeParser` bekommt es als letzten Konstruktorparameter (Standard `uno`), Grundlage für die boardabhängigen Regeln der Phase 4.

