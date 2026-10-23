# M3-Abnahme: ATtiny85 im Browser (P6.5)

> **Nicht normativ.** Abnahmebericht zu Meilenstein M3 aus
> [browser-emulation-plan.md](browser-emulation-plan.md); wird mit dem Plan
> gelöscht. Muster: [report-m2-acceptance.md](report-m2-acceptance.md).

## Ergebnis

**Erfüllt, mit ausgewiesenen Ausnahmen.** Der ATtiny85 (ATTinyCore 1.5.2,
8 MHz intern) ist als `preview` freigegeben: Toolchain im Compile-Sandbox-Image,
MCU-Profil, Software-UART, Board-Hardware und Parserregeln, Boardansicht,
Korpus-Proben und E2E sind grün. **Keine Aufnahme an einem echten ATtiny85**:
alle ATtiny-Fälle sind `derived`.

## Kriterien aus Plan Phase 6

| Kriterium | Stand | Beleg |
|---|---|---|
| P6.1 Toolchain im Compile-Sandbox-Image | erfüllt | #333: ATTinyCore 1.5.2 mit gepinnter SHA-256 im Image, Core je FQBN vorkompiliert; Vertragstest kompiliert für den ATtiny85 in der Sandbox; Toolchain-Gate `toolchain-cores.test.ts` für alle vier Boards |
| P6.2 MCU-Profil | erfüllt | #334: Port B mit INT0/PCINT0, Timer 0 und 1, ADC mit REFS2 an Bit 4, EEPROM, Watchdog; `attiny85-profile.test.ts` (13 Fälle) |
| P6.3 Software-UART | erfüllt | #335 und dieser PR: TX-Dekodierung mit Baudraten-Erkennung, RX über das Komparatormodell; `software-uart.test.ts` (8 Fälle) |
| P6.4 Board-Hardware und Regeln | erfüllt | #336: `ATTINY85_BOARD`, Serial-Port der Art `software`, PWM-Beobachtung Timer 1, Parser rechnen `A<n>` wie ATTinyCore, Warnungen RESET-Pin und Serial-Pins; Pinbelegung im Toolchain-Gate gegen `variants/tinyX5` |
| P6.5 Freigabe `preview` | erfüllt | dieser PR: `shared/boards.ts` `attiny85` `preview`, Laufzeit `browser`; Boardansicht DIP-8 (`npm run generate:attiny85-svg`); Benutzerhandbuch „Board wählen“ mit den Grenzen des Boards |
| Proben grün | erfüllt | 5 Korpus-Proben (`attiny_basics`, `attiny_adc_read`, `attiny_pwm_duty`, `attiny_serial_echo`, `attiny_interrupts`), dazu die Paket-Tests von Profil, UART und Board |
| E2E grün | erfüllt | `e2e/attiny85.spec.ts`, 3 Szenarien (unten), 3 von 3 in 8,7 s; ganze Suite 54 von 54 |
| Bundle | erfüllt | `npm run check:bundle`: initialer Ladepfad 691,0 kB von 710 kB (die Boardansicht lädt seit #326 mit eigenem Chunk); avr8js nur im Worker-Chunk |

## End-to-End-Lauf im Browser (Playwright, echter Compile mit ATTinyCore)

| Szenario | Ergebnis |
|---|---|
| Tools → Board bietet den ATtiny85 mit Preview-Hinweis; die Boardansicht zeigt den DIP-8 mit den Pins 0–4 interaktiv, PB5 (RESET) nicht | grün |
| Compile für den ATtiny85, Lauf im Browser, Ausgabe über den Software-UART, A1 (Pin 2, Dialog „2 (A1)“) am Board auf 512 gesetzt und im Sketch gelesen | grün |
| Serielle Eingabe über den Komparator: „42“ → „got 42“ | grün |

## Leistung (Headless, `npm run emulate`, Median von 7 Läufen, 1500 ms simuliert)

Gemessen am 23.10.2026 auf Apple M2 Pro, Node 24.20.0:

| Fixture | Board | Geschwindigkeit |
|---|---|---|
| `attiny85-tiny_serial` (Serial über Software-UART) | ATtiny85 | 11,1 × Echtzeit |
| `attiny85-tiny_probe` | ATtiny85 | 11,2 × |
| `uno-blink` (Vergleich) | Uno | 4,4 × |

Befehl: `npm run emulate -- packages/avr-emulator/tests/fixtures/<fixture>.hex --board <board> --ms 1500 --repeat 7`.
Der ATtiny85 läuft mit 8 MHz, also mit halb so vielen Takten je Sekunde wie der Uno.

## Referenzen: was die Fälle beweisen

| Fälle | Klasse | Grundlage |
|---|---|---|
| 5 Korpus-Proben | `derived` | Datenblatt ATtiny25/45/85, `avr/iotnx5.h`, Quelltext von ATTinyCore 1.5.2 (`wiring.c`, `wiring_analog.c`, `TinySoftwareSerial.cpp`, `pins_arduino.h` von tinyX5) und Rechnung; Begründung je Fall in `case.json` |
| Paket-Fixtures `attiny85-*` | `derived` | wie oben; Ausgaben des Spikes P0.5 für die `Serial`-Probe |

Keine Aufnahme an einem echten ATtiny85. Die Klasse `hardware` braucht einen
Messaufbau (ATtiny85 mit Programmer und USB-Seriell-Adapter an PB0/PB1); das
ist Arbeit für einen Menschen, eine Anleitung dafür fehlt noch.

## Funde der Abnahme (alle behoben, mit Test)

| Fund | Behebung |
|---|---|
| ATTinyCore-Post-Build-Hooks schreiben in Core und Sketch; in der Compile-Sandbox (read-only) bricht der Compile ab | `platform.local.txt` schaltet die Hooks ab, das HEX bleibt byteweise gleich (#333) |
| Index und `micronucleus` des Board-Managers liefern abgelaufene TLS-Zertifikate | Installation aus dem Release-Archiv mit gepinnter SHA-256 (#333) |
| avr8js liest REFS2 an Bit 3 | eigener Getter im Profil (#334, aus Spike P0.5) |
| avr8js verdrahtet die gemeinsamen Register GIMSK/GIFR nur für INT0 bzw. PCINT | Hooks im Profil umhüllt (#334) |
| `analogRead(A1)` wurde im Parser zu Pin 4 (Pin- und Kanalnummer überlagern sich) | Parser rechnen `A<n>` = `0x80 \| n` wie ATTinyCore (#336) |
| LED „L“ und Analog-Beschriftungen der Boardansicht waren fest auf Pin 13 bzw. `A<k>`-Labels | `LED_BUILTIN` und Sketch-Namen des Boards (dieser PR) |
| Baudraten-Erkennung rastete auf ein Vielfaches ein (19200 statt 9600) | Entscheidung erst, wenn jede passende Rate genug Rahmen hat; die Rate ohne Rahmenfehler gewinnt (dieser PR, Probe `attiny_basics`) |
| `digitalWrite(0, LOW)` ohne `Serial` erzeugte ein Byte 0x00 | TX wird nur dekodiert, solange `Serial` aktiv ist (dieser PR, Probe `attiny_pwm_duty`) |
| Spanne für `delay(587)` aus dem Spike (586–588 ms) zu eng | abgeleitet 585–589 ms (#334) |

## Bekannte Restpunkte (nicht M3-blockierend)

- **Keine Aufnahme an echter ATtiny85-Hardware** (alle Fälle `derived`).
- **Timer-1-PWM-Signal:** avr8js 0.21.1 erzeugt in der PWM-Konfiguration von
  ATTinyCore kein Signal an OC1A/OC1B. Das Tastverhältnis in UnoSim kommt aus
  den Registern und stimmt; ein Sketch, der den Pegel des Pins liest, sieht LOW
  (README des Pakets).
- **Meldungen an avr8js** (REFS2, GIMSK/GIFR, Timer-1-PWM): nach außen
  gerichtet, wartet auf einen Menschen.
- **Halbduplex** des Software-UART ist Eigenschaft des Boards und im
  Benutzerhandbuch beschrieben.
- **Mobile-Layout** der ATtiny-Ansicht wie bei Nano und Mega nicht gesondert
  geprüft.
- **Portleiste des Serial Monitors** (Mega, #319): weiterhin von keinem
  Menschen angesehen.
