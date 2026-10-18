# Umsetzungsstand Browser-Emulation

> **Nicht normativ.** Fortschritt zu [browser-emulation-plan.md](browser-emulation-plan.md);
> wird mit dem Plan gelöscht.

| Paket | Status | PR | Notiz |
|---|---|---|---|
| P0.1 | in Arbeit | #258 | Entwürfe ADR 0009/0010 (`Proposed`) gemergt; Spike-Ergebnisse werden eingetragen (E11 hier, E6/E7/E3 im Folge-PR); Annahme durch die Maintainer |
| P0.2 | erledigt | #259 | Kriterium erfüllt: p95-Mehraufwand ≤ 195 ms mit kopiertem Core-Cache, keine fremde Datei lesbar; Nebenbefund `.include` auf `/proc/self/environ` (V1) |
| P0.3 | wartet auf Mensch | | Messung auf Referenzgeräten (Schulgerät, Tablet, Notebook) |
| P0.4 | erledigt | #260 | Registerweg + Befehlsdekodierung: alle Paare pin-genau außer einem `digitalWrite` ohne Pegeländerung; Symbole nach LTO in 1/62 Builds |
| P0.5 | erledigt | #262 | ATTinyCore 1.5.2; Software-UART TX/RX inkl. Komparatormodell; avr8js-Fehler REFS2 |
| P0.6 | erledigt | #261 | Mega-Profil mit eigenen Vektoren; alle Proben stimmen |
| P0.7 | erledigt | #254 | Branch `feature/browser-emulation` existiert, CI-Trigger aktiv |
| P1.1 | erledigt | (dieser PR) | Workspace-Paket `@unosim/avr-emulator`, avr8js 0.21.1, Gates verdrahtet |

Status: offen · in Arbeit · erledigt · wartet auf Mensch · blockiert
