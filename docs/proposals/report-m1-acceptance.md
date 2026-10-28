# M1-Abnahme: Uno im Browser (P3.10)

> **Nicht normativ.** Abnahmebericht zu M1 aus [browser-emulation-plan.md](browser-emulation-plan.md).
> Der Bericht wird mit dem Plan gelöscht.

## Ergebnis

M1 ist **technisch abnahmefähig, mit ausgewiesenen Ausnahmen bei den Hardware-Referenzen**
(Abschnitt „Hardware-Referenzen der 51 Beispiele“). Alle anderen Kriterien sind erfüllt
und belegt. Die Ausnahmen kommen von fehlendem Messaufbau, nicht von fehlender Software;
sie sind nicht als erledigt markiert.

## Kriterien aus Plan 2 und P3.10

| Kriterium | Stand | Beleg |
|---|---|---|
| Browser-Emulation für den Uno, Standard im lokalen Profil | erfüllt | `parseRuntimeSettings`: lokal `browser`, Docker `host-mock` bis M4; `GET /api/config` meldet `"default":"browser"`; Test `tests/server/runtime-settings.test.ts`; [INSTALL_LOCAL.md](../INSTALL_LOCAL.md) |
| Korpus grün | erfüllt | Korpus 65 Fälle (`packages/avr-emulator/tests/runtime-corpus-*.test.ts`), Teil des Unit-Gates |
| Referenzen der Klasse `hardware` für die 51 Beispiele | **teilweise: 34 von 51** | Aufnahmen am Uno R3, Ausnahmen unten ausgewiesen ([report-p1-14-hardware.md](report-p1-14-hardware.md)) |
| E2E der Browser-Emulation grün | erfüllt | `e2e/browser-emulation.spec.ts`, 7 Szenarien (unten), in der CI (Playwright E2E) |
| alle bisherigen Gates grün | erfüllt, siehe CI des Abnahme-PR | Pre-push (Unit, Sonar), CI: Toolchain, Clean-room, Docker-Sandbox, Lint & Unit, Playwright E2E, Production Gateway |
| Host-Mock-Fallback erhalten | erfüllt | E2E „host-mock fallback“; Rückfall ohne Abbild im Controller (`use-simulation-controller.test.tsx`); `connection-loss.spec.ts` prüft weiter das Verhalten des Host-Mocks |
| Benutzerhandbuch „Grenzen der Simulation“ neu | erfüllt | [USER_GUIDE.md](../USER_GUIDE.md): Modell der Emulation (Tabelle 4.8), Legacy-Tabelle getrennt |
| Bundle: Emulator nur im Worker-Chunk | erfüllt | `npm run check:bundle` prüft avr8js im initialen Ladepfad (Test `tests/server/bundle-budget.test.ts`); initial 703,8 kB von 710 kB, unverändert |

## End-to-End-Lauf im Browser (Playwright, echter Compile)

| Bereich | Szenario | Ergebnis |
|---|---|---|
| Uno End-to-End | Sketch im Editor, Start: Compile, `artifact` zum Browser, Worker startet, Serial-Ausgabe erscheint; kein `start_simulation` über die Verbindung | grün |
| Serial I/O | Eingabe im Serial Monitor erreicht den Sketch, die Antwort kommt zurück | grün |
| Lifecycle | Pause hält die simulierte Zeit (Zähler steht), Fortsetzen läuft weiter, Stop beendet; je Systemzeile | grün |
| Diagnostics | Eingabe vor `Serial.begin()` erscheint als Systemzeile „Serial input discarded because the receiver was not enabled yet (Serial.begin() has not run)“, nicht als Sketch-Ausgabe | grün |
| Reset/Restart | Reset (Taste am Board) startet den Sketch neu, ohne erneut zu kompilieren | grün |
| Verbindungsverlust | Lauf geht offline weiter, Stop funktioniert, danach ist Start (braucht Compile) gesperrt | grün |
| Host-Mock-Fallback | Engine „Legacy“: der Server simuliert, `start_simulation` geht über die Verbindung | grün |

## Funde der Abnahme (alle behoben, mit Test)

1. **Das Eingabefeld des Serial Monitors ließ sich nicht beschreiben, solange es leer war** (der Zusatz `!serialInputValue.trim()` sperrte das ganze Feld, nicht nur den Senden-Knopf; Regression der UI-Vereinheitlichung vom 22.09.). `InputGroup.submitDisabled`.
2. **Browser-Läufe ließen sich bei meldeter Offline-Verbindung nicht steuern**: React Query pausiert Mutationen im `networkMode: "online"`. Die Steuer-Mutationen senden nie HTTP und laufen jetzt mit `networkMode: "always"`.
3. **Der Compile-Status blieb auf „compiling“**, weil ihn sonst eine Servernachricht beim Start beendet, die es im Browser nicht gibt: der Compile+Start-Ablauf setzt ihn selbst.
4. **Serial-Text im Format des Servers**: Zeilen mit LF, CRLF zu LF, `isComplete` nach Zeilenende (rohe Stücke zerrissen die Anzeige).
5. **EEPROM bleibt je Board im Tab erhalten** (Modellannahme 4.8) – war bis dahin nicht umgesetzt (#298).
6. `connection-loss.spec.ts` prüft ausdrücklich den Host-Mock (Legacy), denn nur dessen Lauf endet mit der Verbindung.

## Hardware-Referenzen der 51 Beispiele (Ausnahmen)

34 Beispiele sind Klasse `hardware` (am Uno R3 aufgenommen). 17 sind es nicht:

| Beispiel | Klasse | Grund | Mit einfachen Hilfsmitteln aufnehmbar? |
|---|---|---|---|
| `it05-05-intervall-ohne-delay` | `regression` | aufgenommen, aber 8 Schleifendurchläufe je Ausgabe (0,006 %) weniger auf dem Board als im Emulator (UART-Zyklenmodell); keine Toleranz | – (gemessene Abweichung, dokumentiert) |
| `it08-01-struct`, `it08-03-array-aus-structs`, `it08-05-headerdatei` | `derived` | feste Spannungen an A0 bzw. A0–A2 zum Zeitpunkt 0 | ja: Spannungsteiler oder Poti mit Multimeter (Anleitung: [human-tests.md](human-tests.md)); noch nicht aufgenommen |
| `it04-01`, `it04-02`, `it04-05`, `it05-01`, `it05-02`, `it05-03`, `it07-07` | `derived` | Spannung nach Zeitplan (100–700 ms zwischen den Stufen) | nein: von Hand nicht auf die Millisekunde |
| `it03-06-digitaler-eingang`, `it04-04-taster-flanke` | `derived` | Pegelwechsel nach Zeitplan | nein: von Hand nicht auf die Millisekunde |
| `it03-04`, `it03-05`, `it04-03`, `it07-01` | `derived` | prüfen Pinzustand (`expectState`), die serielle Aufnahme deckt ihn nicht ab | nein: Logikanalysator oder Oszilloskop |

Die Fälle der Klasse `derived` stützen sich auf den Quelltext des Cores und das Datenblatt; sie
gelten **nicht** als Hardwarevergleich. Die Probe-Fälle `adc_read`, `pullup_input` und `pwm_duty` stehen im
selben Messbacklog (Messaufbau fehlt, keine Software).

## Bekannte Restpunkte (nicht M1-blockierend)

- Die 16 `derived`-Beispiele oben und `it05-05` bleiben offen, bis Messaufbau und Zeit da sind.
- P0.3: Messung nur synthetisch, eine Messung auf dem schwächsten Schulgerät bleibt empfohlen ([report-p0-3-vm-matrix.md](report-p0-3-vm-matrix.md)).
- P0.1: ADR 0009/0010 stehen auf `Proposed`; die Annahme durch die Maintainer ist keine Programmieraufgabe.
- Boards außer dem Uno, die Compile-Sandbox im Docker-Profil (P2.4) und der Pilot-Betrieb gehören zu M2–M4.
