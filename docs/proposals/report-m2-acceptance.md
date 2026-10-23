# M2-Abnahme: Nano und Mega 2560 im Browser (P5.4)

> **Nicht normativ.** Abnahmebericht zu M2 aus [browser-emulation-plan.md](browser-emulation-plan.md).
> Der Bericht wird mit dem Plan gelöscht.

## Ergebnis

M2 ist **technisch abnahmefähig, mit ausgewiesenen Ausnahmen**: Nano und Mega 2560 sind als
`preview` freigegeben, Proben, Korpus-Auszug und E2E sind je Board grün. Für beide Boards gibt
es **keine Aufnahme an echter Hardware**: alle Fälle sind Klasse `derived`. Das kommt vom
fehlenden Board und Messaufbau, nicht von fehlender Software; die Fälle sind nicht als
Hardwarevergleich ausgewiesen (Abschnitt „Referenzen“).

## Kriterien aus Plan 2 und P5.4

| Kriterium | Stand | Beleg |
|---|---|---|
| Board-Auswahl im Client | erfüllt | Tools → Board bietet Uno, Nano und Mega (`preview` mit Hinweis); Wechsel stoppt den Lauf und verwirft das Build; E2E „Tools → Board offers …“ je Board |
| Nano freigegeben (`preview`) | erfüllt | `shared/boards.ts`: `nano` `preview`, Laufzeit `browser`; P4.8 |
| Mega 2560 freigegeben (`preview`) | erfüllt | `shared/boards.ts`: `mega2560` `preview`, Laufzeit `browser`; P5.4 |
| Proben je Board grün | erfüllt | Nano: `nano_adc_read` (A6/A7) und die Proben der Board-Hardware aus P1.3 (`nano-analog_probe`, `-int_probe`, `-memory_probe`). Mega: 7 Proben im Korpus (Speicher, PWM, ADC mit MUX5, vier serielle Ports, Interrupts, Pins auf H/J/K/L, Flash über 64 KB mit Code über 128 KB) und `atmega2560-boards.test.ts` |
| Korpus-Auszug je Board grün | erfüllt | Nano: 6 Beispiele plus Probe (7 Fälle). Mega: 14 Beispiele plus 7 Proben (21 Fälle). Beispiele sind unveränderte Kopien der Uno-Originale (`board-examples.test.ts`); Hex-Dateien im Toolchain-Gate byte-identisch neu gebaut |
| E2E je Board grün | erfüllt | `e2e/nano.spec.ts` und `e2e/mega.spec.ts`, je 3 Szenarien (unten), 6 von 6 in 12,5 s |
| alle bisherigen Gates grün | erfüllt | CI-Lauf 39920096755 auf `a78b3e26f` (`feature/browser-emulation`): Toolchain, Clean-room, Docker-Sandbox, Lint & Unit, Playwright E2E, Production Gateway |
| Bundle: Emulator nur im Worker-Chunk | erfüllt, **knapp** | `npm run check:bundle` ohne Fehler, avr8js nur im Chunk `emulator.worker-…`. Initialer Ladepfad 708,2 kB von 710 kB (M1: 703,8 kB) |
| Leistung mit 256-KB-Flash | erfüllt | Tabelle unten; `mega_flash_far` liest PROGMEM über 64 KB und ruft Code über 128 KB auf |

## End-to-End-Lauf im Browser (Playwright, echter Compile)

| Board | Szenario | Ergebnis |
|---|---|---|
| Nano | Tools → Board bietet den Nano mit Preview-Hinweis, die Boardansicht wechselt | grün |
| Nano | Compile für den Nano, Lauf im Browser, A6 und A7 (nur am Nano analog) am Board gesetzt und im Sketch gelesen | grün |
| Nano | Boardwechsel stoppt den Lauf, der nächste Start baut für das neue Board | grün |
| Mega | Tools → Board bietet den Mega mit Preview-Hinweis, die Boardansicht zeichnet die Pins (A0–A15, 0–53) | grün |
| Mega | Compile für den Mega (`Serial1` und A15 gibt es nur dort), Lauf im Browser, Ausgabe und Eingabe auf `Serial` und `Serial1`, A15 am Board gesetzt | grün |
| Mega | Boardwechsel stoppt den Lauf, der nächste Start baut für das neue Board | grün |

## Leistung (Headless, `npm run emulate`, Median von 7 Läufen, 1500 ms simuliert)

Gerät: Apple M2 Pro, Node 24.20.0, ein Kern, keine weitere Last (wie [report-p1-13-leistung.md](report-p1-13-leistung.md)).

| Fixture | Board | Geschwindigkeit |
|---|---|---|
| `uno-blink` | Uno | 4,5 × Echtzeit |
| `nano-analog_probe` | Nano | 5,0 × |
| `mega2560-mega_io` | Mega | 4,4 × |
| `mega2560-mega_probe` | Mega | 4,0 × |
| `mega2560-mega_serial_ports` | Mega | 3,5 × |

Der Mega liegt bei 3,5–4,4 ×, also im selben Bereich wie der Uno (Messung bei P5.4: 3,5–4,6 ×
gegen 3,6–5,2 ×). Die 256 KB Flash und die 22-Bit-Befehle kosten keinen auffälligen Mehraufwand.
Wie bei M1 gilt: Messung auf dem Entwicklungsrechner, nicht auf Schulgeräten (P0.3).

## Referenzen: was die Fälle beweisen

| Board | Fälle | Klasse | Grundlage |
|---|---|---|---|
| Nano | 7 | `derived` | Der Nano hat den ATmega328P des Uno bei 16 MHz; die Uno-Aufnahme (am echten Uno R3, Klasse `hardware`) gilt, solange der Sketch weder A6 noch A7 nutzt. A6/A7 deckt `nano_adc_read` aus dem Datenblatt ab. Keine Aufnahme am Nano |
| Mega | 21 | `derived` | Datenblatt, Core-Quelltext (`pins_arduino.h`) und Rechnung; die Beispiele nennen die Uno-Aufnahme, aus der sie folgen, und jede Abweichung (z. B. `it08-05` druckt A0–A2 als Pins 54–56 statt 14–16). Keine Aufnahme am Mega |

Ein bestandener Fall heißt: Übereinstimmung mit der Herleitung, **nicht** mit einem echten Board.

## Funde der Abnahme (alle behoben, mit Test)

1. **Die Port-Konfigurationen B/C/D von avr8js tragen die Pin-Change-Verdrahtung des 328P**: die Mega-Vektoren von INT3/INT4 wurden dadurch ausgelöst (P5.1, Probe `mega_interrupts`). Das Profil übernimmt nur die Registeradressen.
2. **Analogwerte am Board gingen nur an die Pins 14–19**: A6/A7 des Nano und A0–A15 des Mega kamen nicht an. Der Router setzt jetzt auf allen Analogeingängen des gewählten Boards (P5.3).
3. **`it08-05` gibt A0 als Pin 54 aus** (Mega): erwartetes Verhalten, im Korpus als Abweichung festgehalten.
4. **Seiten-Reset beim ersten Compile und Start**: die Emulator-Laufzeit lädt erst beim ersten Browser-Start, der Worker entsteht mit `new Worker(new URL(…))`, den der Abhängigkeits-Scan von Vite nicht verfolgt. `avr8js` wurde erst dann entdeckt, neu optimiert und die Seite neu geladen. Jetzt in `optimizeDeps.include` (#315). Aufgefallen beim Ausprobieren nach der Nano-Installation.
5. **Die Einstellung „Simulation engine“ fehlte bei Nano und Mega**: sie war nur sichtbar, wenn mehr als eine Laufzeit nutzbar ist. Jetzt immer sichtbar, bei Nano und Mega gesperrt auf „Emulation“ mit dem Grund (#315).
6. **Das Unit-Gate hatte 0,8 s Reserve**: der Emulator-Korpus wächst mit jedem Board und riss das Zeitbudget (124,7 s bei 120 s). `test:unit` läuft jetzt in zwei Durchläufen mit je eigenem Budget (#314); Korpusfälle zu löschen hätte nur 1,8 s gebracht und die Abnahme geschwächt.
7. **Das Docker-Gate lief zwischen 120 s und 185 s bei gleichem Code**: Limit auf 240 s (#316). Dabei sieben doppelte oder leere Docker-Tests entfernt, 35 s weniger (#317).

## Bekannte Restpunkte (nicht M2-blockierend)

- **Keine Aufnahme an echtem Nano oder Mega.** Ein Mega-Lauf mit den 7 Proben und den 14 Beispielen am echten Board würde die 28 `derived`-Fälle in `hardware` überführen ([human-tests.md](human-tests.md) beschreibt den Ablauf für den Uno).
- **Bundle-Reserve 1,8 kB** im initialen Ladepfad (708,2 von 710 kB). Das nächste Feature im initialen Pfad (z. B. eine ATtiny-Boardansicht, P6.5) braucht entweder Nachladen oder eine begründete Anhebung des Limits.
- **Mobile-Layout je Board ist nicht geprüft** (offen aus P4.4); die Mega-Grafik hat 70 Pins.
- **Portleiste des Serial Monitors** (#319): die Portauswahl steht in einer eigenen Leiste unter der Kopfzeile statt in der Kopfzeile. Der ursprüngliche Grund ist nicht festgehalten, die Leiste ist noch nicht von einem Menschen auf dem Mega begutachtet.
- **P4.6:** das README von UnoSim-Examples mit dem Feld `board` steht aus (anderes Repository).
- **`preview` bleibt:** die Freigabe als `available` für Nano und Mega ist eine Entscheidung für M4/Release, nicht für M2.
- **Parser:** `Serial1`–`Serial3` je Board sind mit P5.4 erledigt; offen bleibt „kein Hardware-Serial“ für den ATtiny85 (P6.4).
