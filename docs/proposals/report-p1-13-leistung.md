# Leistungsmessung P1.13: Headless-Lauf

> **Nicht normativ.** Messbericht zu Arbeitspaket P1.13 aus
> [browser-emulation-plan.md](browser-emulation-plan.md). Er dient als
> Vergleichswert für P0.3 und P1.12 (Startwerte auf schwachen Geräten) und
> wird mit dem Plan gelöscht.

## Aufbau

- Werkzeug: `npm run emulate -- <hex> --ms 1500 --repeat 7`
  ([scripts/emulate.ts](../../scripts/emulate.ts)); angegeben ist der Median
  der „Geschwindigkeit“ = simulierte Zeit je Wanduhrzeit des reinen Rechnens
  (`runHeadless`, ohne Pacing, ohne Worker).
- Gerät: Apple M2 Pro, Node 24.20.0, ein Kern, keine weitere
  Last. Die IoUsage-Beobachtung und die Diagnosen
  (P1.9, P1.10) sind eingeschaltet, wie im Betrieb.
- Sketches: vorkompilierte Fixtures aus
  [tests/fixtures](../../packages/avr-emulator/tests/fixtures/README.md).

## Messwerte

| Fixture | Inhalt | Geschwindigkeit |
|---|---|---|
| `uno-blink` | `digitalWrite` im 1-s-Takt, sonst `delay` | 4,4 × |
| `uno-tick_probe` | Zeile alle 10 ms über Serial | 4,6 × |
| `uno-ssot_tc06` | `digitalWrite(9, HIGH)` in `loop()` ohne Pause | 3,5 × |
| `uno-adc_probe` | 8 `analogRead` und eine Zeile alle 5 ms | 4,2 × |
| `uno-pwm_probe` | `analogWrite` auf allen PWM-Pins, dann Leerlauf | 6,4 × |
| `uno-serial_probe` | `parseInt`-Wartezeit, UTF-8-Ausgabe | 4,9 × |
| `uno-delay_probe` | `delay(587)` in Schleife | 4,7 × |

## Bewertung

- Der Wert liegt auf dem M2 Pro bei 3,5–6,4 ×; der Spike P0.4 maß 5,2 × ohne
  und mit Beobachtung. Ein Gerät, das nur ein Viertel so schnell rechnet,
  erreicht den Echtzeitfaktor 1 gerade noch (E12 geht davon aus, dass der
  Faktor auf schwachen Geräten unter 1 fällt).
- Der teuerste gemessene Fall ist ein Sketch, der in `loop()` ständig
  schreibt (`ssot_tc06`): jeder Schleifendurchlauf löst die Registerhooks der
  IoUsage-Beobachtung aus (3,5 × gegenüber 4,4 × bei `blink`, also etwa 20 %
  Mehraufwand im ungünstigsten Fall).
- Die Werte sind Messungen eines einzelnen Geräts. Messungen auf den
  Referenzgeräten (Schulgerät, Tablet, Notebook) bleiben P0.3 vorbehalten
  („wartet auf Mensch“); mit `npm run emulate` und denselben Fixtures lässt
  sich dort derselbe Kennwert ermitteln (im Browser statt Node weicht er ab).
