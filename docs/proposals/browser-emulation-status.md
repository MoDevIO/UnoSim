# Umsetzungsstand Browser-Emulation

> **Nicht normativ.** Fortschritt zu [browser-emulation-plan.md](browser-emulation-plan.md);
> wird mit dem Plan gelöscht.

| Paket | Status | PR | Notiz |
|---|---|---|---|
| P0.1 | in Arbeit | #258 | Entwürfe ADR 0009/0010 (`Proposed`) mit den Ergebnissen von P0.2, P0.4–P0.6 (#262, #263); offen: E12 nach P0.3, Annahme durch die Maintainer |
| P0.2 | erledigt | #259 | Kriterium erfüllt: p95-Mehraufwand ≤ 195 ms mit kopiertem Core-Cache, keine fremde Datei lesbar; Nebenbefund `.include` auf `/proc/self/environ` (V1) |
| P0.3 | wartet auf Mensch | | Messung auf Referenzgeräten (Schulgerät, Tablet, Notebook) |
| P0.4 | erledigt | #260 | Registerweg + Befehlsdekodierung: alle Paare pin-genau außer einem `digitalWrite` ohne Pegeländerung; Symbole nach LTO in 1/62 Builds |
| P0.5 | erledigt | #262 | ATTinyCore 1.5.2; Software-UART TX/RX inkl. Komparatormodell; avr8js-Fehler REFS2 |
| P0.6 | erledigt | #261 | Mega-Profil mit eigenen Vektoren; alle Proben stimmen |
| P0.7 | erledigt | #254 | Branch `feature/browser-emulation` existiert, CI-Trigger aktiv |
| P1.1 | erledigt | #264 | Workspace-Paket `@unosim/avr-emulator`, avr8js 0.21.1, Gates verdrahtet |
| P1.2 | erledigt | #265 | `SimulationImage`: HEX-Parser 00–05, ELF-Symbole, SHA-256, Base64, Validierung beim Laden |
| P1.3 | erledigt | #266 | ATmega328P-Profil, Uno und Nano; Pinbelegung gegen den Core geprüft (Toolchain-Gate). Abgleich der Speicherprobe mit einem echten Uno wartet auf Mensch (P1.14) |
| P1.4 | erledigt | #267 | `PinModel`: Modus aus DDR/PORT, Pull-up, äußerer Pegel mit Vorrang bis OUTPUT, Änderungsliste mit Zähler |
| P1.5 | erledigt | #268 | Tastverhältnis 0–255 je Timerkanal aus COM/WGM/OCR; Abnahme Uno-Pins 3/5/6/9/10/11 × 0/1/25/128/254/255 |
| P1.6 | erledigt | #270 | Reglerwert → (Wert + 0,5)/1024 · VCC, `analogRead` = Reglerwert; INTERNAL nach Datenblatt, AREF = VCC (neue Modellannahme in 4.8). Emulator-Tests laufen seit #269 in eigenem Coverage-Durchlauf |
| P1.7 | erledigt | #271 | UTF-8-Stromdekoder je Port, Eingabe im Rahmentakt erst nach `Serial.begin`, 64-Byte-Puffer des Cores, Grenzen 4 KiB/1 MiB; SerialOutput-SSOT folgt mit dem Worker-Transport (P1.11/P1.12) |
| P1.8 | erledigt | #272 | `Emulator`: Scheiben ≤ 8 ms, Neusetzen bei > 100 ms Rückstand, Warten bei Vorauslauf, Echtzeitfaktor, Pause/Resume/Stop/Reset, Timeout ohne Pausen, Headless `advance`/`at`; Abnahme „30 s bei Faktor 0,5“ skaliert getestet (400 ms → 200 ms) |
| P1.9 | erledigt | (dieser PR) | `IoUsageObserver` nach Spike P0.4, Stufe R2, je Maschine (auch nach Reset); IoRegistry-SSOT-Fälle 1–11 als Tests mit HEX-Fixtures (Fall 7: `digitalWrite` portgenau, mit ELF-Symbolen pin-genau); `analogWrite` 0/255 als `digitalWrite`; keine Wiederholung in `loop()` |
| P1.10 | erledigt | (dieser PR) | `Diagnostics`: Stack in `.bss`/Heap, PC außerhalb des Programms, Watchdog-Reset (baut die Maschine neu auf), `sleep` bei gesperrten Interrupts; neue SSOT SimulationRuntime (Abschnitt Diagnosen); Prüfung je 4000-Takte-Abschnitt und bei SPL-Schreibzugriffen |

Status: offen · in Arbeit · erledigt · wartet auf Mensch · blockiert
