# Gemeinsamer Prüf- und Umsetzungsbericht: Beispiele und Tutor

Stand: 31.10.2026. Ausgang: UnoSim `02710f769`, UnoSim-Examples `bdd4c0a`.
Quellen: eigene Prüfung im Arbeitsdialog und [Codex-Prüfbericht](results/tutor-examples-review/codex/Pruefbericht.md)
mit seinen [Belegen](results/tutor-examples-review/codex/). Nicht normativ; die
Verträge stehen in den SSOTs.

Einstufung: **F** nachgewiesener Fehler, **D** didaktische Schwäche, **V**
Verbesserungsvorschlag. Priorität: 1 hoch, 2 mittel, 3 gering.

## Befunde und Umsetzung

| Nr. | Art | Prio | Quelle | Befund und gemeinsame Ursache | Korrektur | Abnahmekriterium und Nachweis |
|---|---|---|---|---|---|---|
| 1 | F | 1 | Codex R1 | Der beantwortete Turn trug die IDs der Folgefrage; Bewertungen landeten bei der falschen Frage und änderten die Fokusreihenfolge | `use-tutor.ts` nimmt Identität vom gestellten Objekt, Feedback und Bewertung von der Antwort; `resolveTurnQuestion`: der Text entscheidet | Client: `tutor-learning-situation` (Historie); Client-Service-Ablauf über zwei Bereichswechsel: `focus-session` |
| 2 | F | 1 | Codex R2 | Nur der Bibliothekspfad schützte vor verspäteten Beispielantworten; im Menü ging Arbeit verloren | Gemeinsamer Guard `useChangeGuard`, im Menü über `onBeginExampleLoad` | `examples-menu.late-load`; Browser: `tutor-learning` „keeps an edit“ |
| 3 | F | 1 | beide (Codex R3, eigener Punkt 1) | Der Dialog hing am serialisierten Kontext: Built-in zu Built-in, erneutes Laden, Bibliotheksbeispiel und Load Files setzten nichts zurück, ein fremder Lehrerfokus wirkte weiter | Neuer Zähler `learningSituation`; jede Projektübernahme zählt hoch, auch für `null` | `tutor-learning-situation`; Browser „starts over“ in zwei Runden |
| 4 | F | 1 | beide (Codex R4, eigener Punkt 2) | Fokusfragen setzten Code voraus, der nach Experimenten fehlte | `focus-applicability.ts`: Begriffe in Backticks gegen den aktuellen Sketch; unter 50 % Begriffen pausiert der Fokus; jede der 228 Fragen trägt nun mindestens einen Begriff (36 ergänzt), Gate erzwingt das | `focus-session` (kleines Experiment, ersetzter Sketch, Rückkehr); Live: Frage zum ersetzten Sketch bezieht sich auf dessen Code |
| 5 | F | 1 | Codex R5 | Kurskontext hing vom Katalogabruf ab; ein Katalog löschte Frage und Entwurf | Lernsituation unabhängig vom Katalog; Kontext je Dialog fixiert; neue Frage lädt den Katalog bei Bedarf selbst | `tutor-learning-situation`; Browser „keeps a typed answer“ |
| 6 | F | 1 | beide (Codex R6, eigener Punkt 7) | IT01.1 nannte `int x;` reine Deklaration; IT02.5 erwartete `100` statt `4` | Kommentare, Lernziel, Fokusfragen und README korrigiert; Beispiele, Tutor und Gate folgen einheitlich C++ ([basic.def], [basic.start.static]); die ältere Kursformel lehnt das Gate ab | Codex-[Experiment](results/tutor-examples-review/codex/bit-experiment.json): Ausgabe 4; Quelltext unverändert |
| 7 | F | 2 | Codex R7 | Prüfungen liefen vor dem Einsetzen von Planerfragen | `finalizeTutorResult` prüft das Endergebnis vor dem Commit; sonst geprüfte Providerfrage ohne Fortschritt; Gate lehnt Doppelfragen und Lösungscode ab | `focus-session` „delivers only final results“; `inline-focus-validator` |
| 8 | F | 2 | beide (Codex R8, eigene Doku-Liste) | Doku widersprach Emulation, Zeilenende, Boards, Fokus; Links auf ein 404-Repo | README, USER_GUIDE, drei SSOTs, Manifest, Korpus-README | `check:docs`; Abgleich im Abschnitt Prüfergebnisse |
| 9 | F | 1 | eigene Prüfung | `main` von UnoSim-Examples war ungeschützt, die SSOT nennt ihn Veröffentlichungsgrenze | siehe „Nach dem Merge“ | Noch offen |
| 10 | F | 2 | eigene Prüfung, Nachprüfung Codex | Live-Modell bewertete falsche Angaben als korrekt (Endindex 4: 5 Sterne) | Kontext nennt `lastIndex` je Array, nur bei aus dem Text sicherer Größe (die erste Fassung nahm die Zahl der Initialisierer: `byte a[4] = {1, 2}` ergab fälschlich Index 1); neue Regel: falsche Angabe höchstens 2, vage Antwort höchstens 2 | Live: 5 von 5 auf Bewertung 2 |
| 18 | F | 2 | Nachprüfung Codex | Projektwechsel beendete die Ladeanzeige nicht, solange der Katalog lud; die neue Frage blieb gesperrt | `clearDialog` gibt den Ladezustand frei; Warten auf den Katalog ist abbrechbar und auf 5 s begrenzt | `tutor-learning-situation` „ends the loading state“ |
| 11 | F | 2 | eigene Prüfung, Browser | Rohe Backticks im Fragetext; mobiler Schwebebutton verdeckte das Senden | `TutorText`, Abstand im Eingabebereich | Screenshot, E2E |
| 12 | D | 2 | beide (Codex 1, 2) | Schwache Antwort ohne Hilfe, Erschöpfung wirkte wie Abschluss, Schwierigkeit täuschte Anpassung vor | Hinweis plus einmalige Wiederholung; `focusProgress` trennt `active`, `completed`, `open`, `paused`; offene Ziele gehen an den freien Tutor; Doku stellt klar, dass Fokusfragen fest sind | `focus-session`; Live: vorgegebene richtige Zweitantworten wurden korrekt bewertet; ein Lerneffekt der Hinweise ist damit nicht belegt |
| 13 | D | 2 | eigene Prüfung | Kommentare verrieten Antworten (IT02.1, 03.2, 06.3, 11.5), Fragetypen falsch eingeordnet, Wertebereich fehlte in IT03.8 | Texte neu gefasst, Typen korrigiert | Gate; Lesekontrolle |
| 14 | V | 2 | beide (Codex 3, eigener Punkt 9) | Built-ins ohne Lernziel und Beobachtung, gemischte Baudraten | Deutscher Kopf, einheitlich 115200 und `const byte`, kleine Korrekturen | `tests/integration/builtin-examples.test.ts` |
| 15 | V | 2 | Codex 4 | Tutoraktion trug nur einen Statusnamen | Name nennt die Aktion zuerst; Status zeigt Fokus oder freien Tutor | E2E „names the action“ |
| 16 | F | 2 | beide (Codex R8, eigener Punkt 6) | Fehlendes `board` behauptete Eignung für alle Boards; ATtiny85 unbrauchbar | `board: uno` in 51 Beispielen und den 10 allgemeinen Built-ins; Doku nennt die ATtiny-Grenze | Unit-Tests; siehe Ergebnisse |
| 17 | V | 3 | eigener Punkt 5 | `exploration-policy` war unerreichbar, Topics wirken nicht bei Beispielen | Strategie entfernt; README ordnet Topics eigenen Sketches zu | Gate |

## Bewusst nicht oder anders umgesetzt

- **Serverseitiger ID-Vergleich (Codex R1):** Ein strenges Ablehnen abweichender
  Paare brach eine bestehende Vertragsprüfung. Stattdessen entscheidet der Text,
  die ID hilft nur bei unbekanntem Text. Das schließt die Fehlzuordnung ebenso.
- **Katalog beim Laden der Seite:** verworfen. Eine neue Lernfrage lädt ihn; so
  entsteht für Nutzer ohne Tutor keine Last.
- **Suche und Beschreibungen für 51 Remote-Beispiele (Codex 5):** Bewusst vertagte
  Erweiterung ohne Fehlerbezug. Technisch hindert nichts daran: Titel und Kategorie
  liegen vor, `description` ist im Schema bereits optional, gepflegt ist es noch nicht.
- **ATtiny-Unterstützung:** keine Nachrüstung, nur korrekte Angaben.
- **Offenes `answerRating` des Clients (OPL T3):** unverändert offen.
- **Fester Startfokus nach `paused`:** Der Fokus kehrt zurück, sobald der Code
  zurückkehrt; das ist gewollt.

## Geänderte bestehende Tests

Nötig durch das geforderte neue Verhalten; Begründung je Fall:

| Test | Änderung | Grund |
|---|---|---|
| `inline-focus.test.ts` (2 Fälle) | erwartet die Wiederholung nach schwacher Antwort | Punkt 12 |
| `tutor-prompt-revision.test.ts` | `tutor-prompts-v5` | Prompt geändert |
| `experimental-workspace-layout.test.tsx`, `tutor-status-indicator.spec.ts` | Name nennt die Aktion | Punkt 15 |
| `examples-availability.spec.ts` | neuer Bezeichner im Built-in | Punkt 14 |

## Live-Tutor-Lauf

Modell `openai-gpt5.4-mini` über KI:connect, je fünf Beispiele mit vorab fachlich
geprüfter richtiger, teilweise richtiger und falscher Antwort plus Antwort nach
dem Hinweis: [Endstand](results/tutor-examples-review/live-final.json),
[Zwischenstand vor der Bewertungsregel](results/tutor-examples-review/live-before-rating-rule.json).

Der Lauf deckte drei Mängel auf, die simulierte Provider nicht zeigen konnten:

| Mangel | Vorher | Maßnahme | Nachher |
|---|---|---|---|
| Falscher Endindex 4 | 5 Sterne, „Korrekt.“ | `lastIndex` im Kontext | [5 von 5 mit Bewertung 2](results/tutor-examples-review/live-index-five-runs.json) |
| Vage Antwort | 4 Sterne | Regel: höchstens 2 | für „Einen besonderen Wert“ und „Noch keinen eigenen Wert“ 2 |
| Richtige Antwort nach schwacher | 0 von 6 korrekt | Schwacher früherer Versuch nicht im Verlaufsprompt | [6 von 6 mit Bewertung 5](results/tutor-examples-review/live-retry-six-runs.json) |

Die Läufe belegen, dass **vorgegebene** richtige Zweitantworten korrekt bewertet
werden. Sie belegen nicht, dass der Hinweis Lernende zur Antwort führt; dafür fehlen
beobachtete Antworten von Lernenden.

Verbleibend: „Normalerweise nicht.“ erhielt bei if/else weiterhin 4 oder 5. Einmal
scheiterte ein Lauf an `invalid-response`; die Antwort bleibt dabei stehen und
lässt sich erneut senden. Eine Stichprobe von 15 Antworten belegt keine
allgemeine Feedbackqualität und ersetzt keine Bewertung durch Lehrkräfte.

## Prüfergebnisse

| Prüfung | Ergebnis |
|---|---|
| `REQUIRE_RELEASE_GATE=1 ./run-tests.sh` (1.11.2026) | Unit 3937 bestanden, 1 übersprungen; Toolchain-Integration 161 bestanden, 1 übersprungen; Docker 43 bestanden; E2E 84 bestanden; Build und Security Audit bestanden; Sonar neu gescannt am 1.11.2026, 14:24 UTC: Quality Gate bestanden, Abdeckung des neuen Codes 85,4 %, gesamt 84,7 %, 0 Violations. Der erste echte Scan fand 6 Violations, die behoben sind; ein Lauf ohne `REQUIRE_RELEASE_GATE=1` liest nur den letzten Scan aus. |
| Compile-Matrix | 244 von 244 auf 4 Boards, keine Sketch-Warnung |
| Emulation | 244 von 244 ohne Fehler; 10 Built-ins verhaltensgeprüft; Remote-Quelltext (ohne Kommentare) identisch mit dem Korpus v3.0.0 |
| ATtiny85 | übersetzt alle, aber 34 von 51 Remote-Beispielen liefern unlesbare Ausgabe; dokumentiert, Beispiele tragen `board: uno` |
| Browser | E2E mit 390 px und XXL; Darstellung im [Screenshot](results/tutor-examples-review/tutor-narrow-xxl.png) geprüft |

## Nach dem Merge

Reihenfolge wegen des Validator-Pins:

1. UnoSim-Änderung mergen.
2. In UnoSim-Examples `.unosim-compatible-commit` auf den Merge-Commit setzen,
   mergen und Tag `v3.1.0` setzen. Bis dahin prüft dessen CI mit dem alten Validator.
3. Branch-Schutz für `main` von UnoSim-Examples einrichten (Punkt 9).
4. Kursfolien gemäß der abgestimmten Änderungsliste (IT01 ff., Kurzreferenz) anpassen.
5. Korpus `examples-v3.0.0` kann bleiben: Der Quelltext ist unverändert.
