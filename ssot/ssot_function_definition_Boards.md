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

Der Uno steht seit M1 mit `available` im Katalog (seine Proben haben Fälle der Klasse `hardware` im Korpus), der Nano seit P4.8 und der Mega 2560 seit P5.4 mit `preview` (Hardware und Proben im Paket, Korpus-Auszug, E2E), der ATtiny85 mit `planned`. Das Statuswort entscheidet über die Freischaltung: Der Standard-Board (`uno`) ist immer angeboten, weil Anfragen ohne Board ihn meinen.

## 3. Angebotene Boards und Laufzeiten

`enabledBoards(requested?, defaultBoard?, backends?)` liefert die Boards, die ein Betrieb anbietet: die angeforderten IDs, ohne Angabe alle Boards mit Status `preview` oder `available`, die ein angebotenes Backend ausführen kann (das Docker-Profil ohne Browser-Backend bietet so nur den Uno an), dazu immer das Standard-Board; Reihenfolge wie im Katalog. Eine ausdrückliche Liste wird nicht gefiltert: ein Board, das kein angebotenes Backend kann, verhindert den Start.

Der Betrieb stellt sie mit vier Variablen ein (`server/runtime-settings.ts`, geprüft beim Start; ungültige Werte verhindern den Start):

| Variable | Werte | Standard |
|---|---|---|
| `UNOSIM_RUNTIME_BACKENDS` | Liste aus `browser`, `host-mock` | lokal `browser,host-mock`; Docker `host-mock`. Im Docker-Profil ist `browser` ohne Compile-Sandbox (Plan P2.4) unzulässig |
| `UNOSIM_DEFAULT_RUNTIME` | eines der angebotenen Backends | lokal `browser` (seit M1), Docker `host-mock`; ohne Host-Mock `browser` |
| `UNOSIM_BOARDS` | Liste von Board-IDs | siehe oben |
| `UNOSIM_DEFAULT_BOARD` | Board-ID | `uno` |

`ARDUINO_FQBN` gilt als veralteter Alias für das Standard-Board: Sein Wert muss die FQBN eines Katalogboards sein und darf `UNOSIM_DEFAULT_BOARD` nicht widersprechen. Jedes angebotene Board (auch das Standard-Board) braucht mindestens eine angebotene Laufzeit, die es kann (`runtimes` im Katalog); sonst startet der Server nicht.

`GET /api/config` meldet `boards` (`id`, `displayName`, `status`, `runtimes`; keine FQBN), `defaultBoard` und `runtime` (`backends`, `default`).

## 4. FQBN-Allowlist

`fqbnAllowlist()` liefert genau die FQBNs der übergebenen Katalogeinträge. Der Prozess-Executor lässt `arduino-cli --fqbn <x>` nur zu, wenn `<x>` die FQBN eines Katalogboards ist; jede andere Angabe lehnt er ab, ohne einen Prozess zu starten. Ob ein Board angeboten wird, entscheidet die Route (Abschnitt 6).

## 5. Pin-Aliasse

`boardPinAliases(id)` liefert die Pin-Namen, die die Sketch-Parser auflösen (`A0` → 14, `LED_BUILTIN`), aus der Pinbelegung des Pakets. Der Mega 2560 hat `A0`–`A15` auf den Pins 54–69 und `LED_BUILTIN` 13 (seit P5.2), der ATtiny85 `A0`–`A3` auf den Pins 5, 2, 4, 3 und `LED_BUILTIN` 1 (seit P6.4). Eine ID ohne Hardwareprofil hat keine Aliasse.

### 5.1 Pin-Modell (`shared/board-pins.ts`, P4.1)

Die Pinlisten, Labels und Fähigkeiten eines Boards stammen aus der Pinbelegung des Pakets; es gibt keine zweite Liste.

| Funktion | Ergebnis |
|---|---|
| `boardPins(id)` | alle Pins in Nummernfolge (`pin`, `label`, `name`, `analogName`, `digital`, `analog`, `adcChannel`, `pwm`, `role`); `undefined` ohne Hardwareprofil |
| `findBoardPin`, `isBoardPin(id, pin)` | Pinprüfung je Board (Uno 0–19, Nano 0–21, Mega 0–69, ATtiny85 0–5) |
| `boardPwmPins`, `boardAnalogPins` | PWM-Pins (`~`) und Analogeingänge in Bauteilfolge |
| `boardPinLabel(id, pin)` | Name wie im Sketch (`14` → `A0`) |
| `resolveBoardPin(id, name)` | `13`, `A0`, `LED_BUILTIN` → Pinnummer; `A6` gibt es nur am Nano; am ATtiny85 `A1` → 2 |
| `maxBoardPin(id)` | höchste Pinnummer des Boards |

Am Nano sind A6 und A7 (Pins 20 und 21) reine Analogeingänge ohne digitale Funktion (`digital: false`).

Am ATtiny85 (ATTinyCore 1.5.2) sind die Pins 0–5 die Bits PB0–PB5 (`label` `PB0`…). Die Analognamen sind zweite Namen von Digitalpins (`analogName`: `A0` = 5, `A1` = 2, `A2` = 4, `A3` = 3); `name` bleibt die Nummer. Im Core ist `A<n>` der Wert `0x80 | n`, den jede Pinfunktion auf den Pin abbildet, und `analogRead(n)` nimmt den Kanal n; die Sketch-Parser rechnen ebenso (`pinContext(id).analogValue`, `callPin`). PB5 ist RESET (`role: "reset"`), PB0/PB1 tragen `Serial` als Software-UART (`role: "serial"`, Port der Art `software`). Regeln der Parser: Warnung bei digitaler Nutzung von PB5 (`analogRead(A0)` erlaubt) und bei anderer Nutzung von PB0/PB1, wenn der Sketch `Serial` verwendet; `Serial1`–`Serial3` gibt es nicht. Die WebSocket-Grenze `maxPin: 19` gilt weiter für den Host-Mock; die Eingabe an den Worker prüft den Pin gegen das Board (`isBoardPin`, siehe SimulationRuntime).

## 6. Board im Compile-Request

`POST /api/compile` nimmt das optionale Feld `board` (eine Katalog-ID). Das Feld `fqbn` ist veraltet:

- Mit `board` kompiliert die Route für die FQBN dieses Boards; ein zusätzlich angegebenes `fqbn` muss die FQBN desselben Boards sein.
- Ohne `board` bedeutet ein `fqbn` das Board, zu dem er gehört; ein `fqbn` außerhalb des Katalogs ist ungültig. Die Optionen an den Compiler bleiben dann wie bisher (`fqbn` wie angegeben, kein `board`).
- Ohne beides kompiliert der Server für sein Standard-Board.
- Ein Board, das der Betrieb nicht anbietet (Abschnitt 3), lehnt die Route mit 400 und „Board <id> is not available“ ab. Ein ungültiges Board oder ein unpassender `fqbn` ergibt 400 „Invalid compile request“.

Die Compile-Ausgabe nennt das Board mit dem Anzeigenamen des Katalogs („Board: Arduino UNO“); für eine FQBN außerhalb des Katalogs steht die FQBN selbst dort. Das Board läuft als `board` durch Compiler-Optionen und Worker-Auftrag; `CodeParser` bekommt es als letzten Konstruktorparameter (Standard `uno`), Grundlage für die boardabhängigen Regeln der Phase 4.

