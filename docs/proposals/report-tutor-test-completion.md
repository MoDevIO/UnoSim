# Arbeitsbericht: Tutor-Tests vervollständigen

Plan: `docs/superpowers/plans/2026-11-11-tutor-test-completion.md`. Auftrag: `docs/superpowers/prompts/2026-11-11-tutor-test-completion-sonnet.md`. Matrix: `docs/tutor-test-matrix.md`.

## 1. Ausgangsstand

- Gestartet auf Branch `main`, HEAD `c60eac9d8` (Merge PR #378). Policy §2.1 verlangt einen Working-Branch; deshalb am Anfang `git checkout -b feature/tutor-test-completion` (neuer Branch, Working Tree unverändert mitgenommen, kein Reset/Stash).
- Vorgefundene Änderungen (bewahrt, nicht von mir): ` M docs/superpowers/plans/2026-11-11-tutor-test-completion.md`, `?? docs/superpowers/prompts/2026-11-11-tutor-test-completion-sonnet.md`.
- Es gibt weder `AGENTS.md` noch `CLAUDE.md` im Projekt; maßgeblich ist `ssot/ssot_agent_policy.md`.
- Echtes Modellbudget: 0 Calls. Keine KI:connect-/Judge-Anfragen.

## 2. Ausgangsprüfungen (Aufgabe 1)

| Befehl | Ergebnis |
| --- | --- |
| `npm run test:tutor-quality` | 60 Dateien, 764 Tests bestanden, 0 übersprungen; Budget 2439 ms / 15000 ms |
| `npx vitest run --project=unit-client tests/client/tutor-review-structure.test.ts tests/client/tutor-review-chain.test.ts tests/client/tutor-review-findings.test.ts` | 3 Dateien, 67 Tests bestanden |

Strukturcode-Korrektur: `tests/client/tutor-review-structure.test.ts` ist vorhanden und grün. Der Test „keeps the classification and every server code, and still redacts the key in free content“ (Key `answer`, Collector, JSON, Browser-Laufzeit, Export) belegt das Gegenbeispiel aus dem alten Korrekturauftrag; der historische Befund ist damit behoben und braucht keine erneute Reparatur.

## 3. Aufgabenstatus

| Aufgabe | Status |
| --- | --- |
| 1 Matrix | erledigt (`docs/tutor-test-matrix.md`, `check:docs` grün) |
| 2 Antwortvertrag | erledigt: `tutor-response-contract.test.ts`, 21 Tests, kein Produktfehler |
| 3 Dialog über HTTP | erledigt: `tutor-mocked-dialog.routes.test.ts`, 15 Tests (`unit-node-http`), kein Produktfehler |
| 4 Kontextvarianten | erledigt: `tutor-context-variants.test.ts`, 23 Tests, Fixture `TQ-REG-002-dice-context.ino` |
| 5 Grafik und Frage | erledigt: `tutor-graphic-question-contract.test.ts` (13) und `tutor-graphic-contract.test.tsx` (11) |
| 6 Lebenszyklus E2E | erledigt: `e2e/tutor-mocked-lifecycle.spec.ts` (LC-01…05), `tutor-review-state-machine.test.ts` (3); alle 29 Tutor-Browsertests im ersten Versuch grün (`--retries=0`) |
| 8 Evaluator | erledigt: Vier-Quellen-Vertrag, `turnKind`, Grafikfokus, Korpus v16 (nach der Nachbesserung v17, Abschnitt 13), SSOT, Sichtbarkeit schwerer Befunde; 2 neue Testdateien (32 + 28 Tests, nach der Nachbesserung 32 + 32) |
| 7 Gesamtabnahme | siehe Abschnitt 8 |
| Echte Modellmessung | nicht ausgeführt – kein Budget beauftragt |

## 3a. Zwischenstände (Prüfungen)

| Befehl | Ergebnis |
| --- | --- |
| `npm run test:tutor-quality` nach Aufgabe 5 | 63 Dateien, 821 Tests grün (Ausgang 764), 2602 ms von 15000 ms |
| `npx playwright test --project=browser --retries=0 e2e/tutor-learning.spec.ts e2e/tutor-status-indicator.spec.ts e2e/tutor-debug-graphics.spec.ts e2e/tutor-review.spec.ts e2e/tutor-mocked-lifecycle.spec.ts` | 29 bestanden, 0 Retries, 27,4 s |
| `npx tsc -p tests/tsconfig.tutor.json --noEmit`, `npx tsc --noEmit`, eslint der neuen Dateien | sauber |

## 4. Entscheidungen

- Branch `feature/tutor-test-completion` angelegt (Policy §2.1).
- Aufgabe 3: Review-Trennung Rohbewertung/Korrekturentscheidung wird über den echten `KiconnectProvider` mit gestubbtem `fetch` belegt (nur dort entstehen Draft-Einträge); der Fake-Provider-Teil prüft Zähler und Zustand.
- Aufgabe 6: Kursinhalt im Browser entsteht, indem nur `GET /api/examples` (Katalog) per `page.route` beantwortet wird; der Browser sendet dann selbst `courseContent`, der Server-Resolver liefert die IT06.4-Fixture. Ein Kontextwechsel während einer offenen Antwort wird über das Laden eines Built-in-Examples ausgelöst (Menüpunkt „Neue Lernrunde“ ist während einer Anfrage deaktiviert, auch das ist geprüft).
- `tests/client/tutor-review-state-machine.test.ts` ergänzt nur Überschneidungen (Clear/DEBUG-Wechsel mit gleichzeitig laufender frischer Anfrage); die Einzelübergänge belegen schon `tutor-review-capture.test.ts` und `tutor-review-chain.test.ts`.
- Aufgabe 8, Evaluatorvertrag: Der Runner nutzt das neue `judgeEvidence` (diskriminierte Rückgabe mit Grund). Die Kurzform `buildJudgeInput` war danach nur noch in Tests genutzt; der CI-Knip-Gate (Produktionsprofil) meldete das in PR #379. Sie liegt deshalb jetzt als Testhilfe in `tests/server/services/tutor/evaluation/judge-input.ts` (Abschnitt 15). Dadurch bekommt „keine ausgelieferte Grafik“ den eigenen Grund `graphic-not-provided`, ohne Judge-Aufruf; der Verdictpfad führt ihn als `judge-not-evaluated` → `inconclusive`.
- Aufgabe 8, Fakten/Judge-Eingabe: Die Fakten der Würfel-Fälle sind aus der Fixture abgelesen (Textoperationen im Test, unabhängig von der Faktenextraktion). *Ursprünglich (überholt, Befund A):* Die falsche frühere Behauptung von `TQ-DICE-OBJECTION` stand nur in den Judge-Fakten, weil das Korpusformat kein Historien-Feedback kannte; sie erreichte das Tutor-Modell nicht. Seit der Nachbesserung (Abschnitt 13) wird sie als Historien-`feedback` an den Tutor gesendet.
- Aufgabe 8, Sichtbarkeit schwerer Befunde: Klassen `product-violation` und `critical-issue` erscheinen zusätzlich im Bericht („Severe findings“) und im CLI-Summary als `severeFindings` (SSOT R-VER-10). Schwellen, `k(n)` und Exitcodes sind unverändert; die Mehrheitsregel wurde nicht angefasst.
- Aufgabe 8, Fake-Judge: Die Judge-Fakes wenden eine einfache Textregel auf die Evidenz an (z. B. „Feedback enthält `ruft Serial.println`“ → Fail mit diesem Zitat). Das belegt Zuordnung und Auswertung von Befunden, nicht die Urteilsqualität eines echten Judges.
- Plan-Abweichung Aufgabe 3: `vitest.config.ts` ordnet die neue Routendatei dem Projekt `unit-node-http` zu; die bestehende `tutor-learning-support.routes.test.ts` läuft weiterhin in `unit-node` (unverändert).

## 5. Geänderte Dateien (eigene)

- `docs/proposals/report-tutor-test-completion.md`, `docs/tutor-test-matrix.md` (neu).
- Neue Tests: `tests/server/services/tutor/tutor-response-contract.test.ts`, `tests/server/routes/tutor-mocked-dialog.routes.test.ts`, `tests/server/services/tutor/tutor-context-variants.test.ts`, `tests/server/services/tutor/tutor-graphic-question-contract.test.ts`, `tests/client/tutor-graphic-contract.test.tsx`, `tests/client/tutor-review-state-machine.test.ts`, `e2e/tutor-mocked-lifecycle.spec.ts`; Fixture `tests/fixtures/tutor-quality/TQ-REG-002-dice-context.ino`.
- `vitest.config.ts`: eine Zeile in `serializedHttpUnitTests`.
- Evaluator (Produktcode): `server/services/tutor/evaluation/judge.ts`, `anchor-corpus.ts`, `anchor-course-content.ts`, `real-provider-evaluation.ts`, `report.ts`, `quality-verdict.ts`, neu `dice-context-fixture.ts`; `scripts/tutor-quality-real-provider-eval.ts` (nur `severeFindings` im Summary); `evals/tutor-quality/anchor-corpus.yaml` (v15 → v16, 7 neue Fälle); `ssot/ssot_function_definition_TutorQualityEvaluation.md` (R-JDG-1/2, R-EVD-1/2/4, R-RSP-4, R-VER-10, Eingabeschema).
- Neue Evaluator-Tests: `tests/server/services/tutor/evaluation/tutor-judge-extended-evidence.test.ts` (32), `tutor-dialog-regressions.test.ts` (28).
- Migrierte bestehende Tests: siehe Abschnitt 7.
- Produktcode außerhalb der Evaluation: **keine Änderung**. Alle Aufgaben-2–6-Tests bestätigten das bestehende Verhalten (kein Produktfehler gefunden, daher keine Reparatur).

## 6. Gegenproben (Aufgabe 7)

Verfahren: Je ein Schutz wurde im Arbeitsbaum kurz deaktiviert, der passende neue Test ausgeführt und die Datei byte-genau aus einer Sicherung wiederhergestellt (SHA-256 vor und nach der Änderung verglichen, Skript bricht bei Abweichung ab; `git status` danach ohne Produktcodeänderung außerhalb der Evaluation). Alle Fälle waren auf dem unveränderten Stand grün; „rot“ meint die Zahl fehlschlagender Tests mit deaktiviertem Schutz.

| Nr. | Deaktivierter Schutz (Datei) | Prüfender Test | Ergebnis |
| --- | --- | --- | --- |
| G1b | Planer-Autorität `questionId` und `stripProviderPlanningMetadata` (`tutor-service.ts`), beide Ebenen | RC-01 | 1 rot. Eine einzelne Ebene allein bleibt grün: beide Schutzebenen sichern sich gegenseitig (bewusste Redundanz) |
| G2 | Wiederholungsreparatur `ensureDistinctDialogQuestion` | RC-02a | 2 rot |
| G3 | Transaktionsisolation (`beginTutorPlanningTransaction` arbeitet auf dem echten Zustand) | RC-04a/b | 2 rot |
| G4 | Referenzbewertung `applyReferenceGrade` (`learning-support.ts`) | CV-05; SD-02 (HTTP) | 1 rot bzw. 3 rot |
| G5b/d | Epochenprüfung `current` und Handle-Epoche; DEBUG-Wechsel erhöht Epoche nicht | `tutor-review-state-machine.test.ts` | 1 rot je Fall. `epoch++` bei Clear: dort grün (Run entfällt ohnehin), aber `tutor-review-capture.test.ts` „does not dispatch events of a request started before Clear“ rot (1) |
| G5-E2E | beide Epochenprüfungen deaktiviert, frisch gebauter Client | `e2e/tutor-mocked-lifecycle.spec.ts` LC-03 | rot (`not.toContainText`) |
| G6 | Grafik folgt ihrer Frage (`graphicForQuestion`) | GQ-01 | 2 rot |
| G7 | Boardbindung der Referenz (`reference-answer.ts`) | CV-05 (anderes Board) | 1 rot |
| G8 | Grafikfokus ohne Grafik | Judge-Evidenz | 3 rot |
| G9 | vierte Zitatquelle | Judge-Evidenz | 3 rot |
| G10 | Kommentare nicht als Fakten (`stripComments` in `sketch-facts.ts`) | CV-01/02/03 | 6 rot |
| G11 | Sichtbarkeit schwerer Befunde | `tutor-dialog-regressions.test.ts` | 1 rot |
| G12 | `initial` als beurteilbare Turnart | Judge-Evidenz | 6 rot |
| G13 | Replay einer wiederholten Aktion (`learning-support-store.ts`) | SD-04 | 2 rot |
| G14 | Überspringen nach 1 statt 2 Klärungen | SD-03 | 1 rot |
| G15 | Referenz nach 2 statt 3 Antworten | SD-03 | 1 rot |

Fachliche Fehler wurden durch die neuen Tests nicht gefunden: Alle Aufgaben-2–6-Tests waren auf dem Ausgangsstand grün, ihre Erkennungskraft ist durch die Gegenproben belegt (keine künstliche rote Phase durch fehlende Importe). Zwei Erwartungen in meinen eigenen Tests waren zunächst falsch und wurden korrigiert, nicht der Produktcode: RC-05 (`unresolved` statt `probeable`, weil alle Fragen verbraucht waren) und ein Fake-Provider mit identischen Klärungstexten (die Wiederholungssperre von R-SUP-9 lehnte ihn ab).

## 7. Migrierte bestehende Tests (technische Begründung, begrenzte Freigabe)

Beide Dateien nach der ausdrücklichen Freigabe des Auftrags (Abschnitt 1) für die Vier-Quellen-/Revisionsmigration. Fachliche Sollwerte, Gegenbeispiele und Ablehnungen sind unverändert.

| Datei | Änderung | Warum die Aussage erhalten bleibt |
| --- | --- | --- |
| `tests/server/services/tutor/evaluation/judge.test.ts` | Revision v2 → v3 und `systemDigest` (`71ac0c84…` → `e7d17898…`); erwartete Quellenliste um `tutor.mermaid` erweitert; Regex des Promptsatzes auf vier Quellen; `it.each` der Quellen prüft die vierte mit einer Grafik im Input; Erwartung `buildJudgeInput` enthält jetzt `turnKind: "dialog"`; Typ-Fixture `judgeInput` bleibt ohne `turnKind` | Die drei alten Quellen bleiben im selben `it.each` akzeptiert; alle Ablehnungen (nichtquotbare Felder, quellenübergreifende Zitate, NFKC) laufen unverändert; „alte manuell gebaute Inputs bleiben gültig“ ist zusätzlich in der neuen Datei geprüft |
| `tests/server/services/tutor/evaluation/anchor-corpus.test.ts` | Pin `{ corpusVersion: 15, digest: e0cca52d… }` → `{ 16, ac53adfb… }`; Nachbesserung: → `{ 17, bd3d95d5… }` (Historien-`feedback` in `TQ-DICE-OBJECTION`, R-COR-1); neue Parsertests für `feedback` (Grenze, leer, Typ, fremdes Feld) | Die Version steigt je Inhaltsänderung einmal, der Digest ist der vom Parser aus den tatsächlichen Daten berechnete Wert; der Test prüft weiter, dass eine Inhaltsänderung eine höhere Version verlangt |

Unveränderte bestehende Tests bleiben grün, darunter der Volllauf des Korpus mit Fake-Provider (`tutor-quality-real-provider-cli.test.ts`), der die neuen Fälle ohne Anpassung besteht.

## 8. Gesamtabnahme (Aufgabe 7)

*Historischer Stand vom 2026-11-11 vor der Nachbesserung; die Nachweise nach der Nachbesserung stehen in Abschnitt 13.*

| Befehl | Ergebnis |
| --- | --- |
| `npm run test:tutor-quality` | 65 Dateien, 883 Tests bestanden, 0 übersprungen, 2446 ms von 15000 ms (Ausgang: 60/764, 2439 ms) |
| `npm run test:unit` | App: 456 Dateien bestanden, 1 übersprungen (4540 Tests bestanden, 1 übersprungen: `capacity-validation.test.ts`, schon vorher so); Emulator: 35 Dateien, 697 Tests bestanden |
| `npm run check` | bestanden (4 `tsc`-Läufe) |
| `npm run lint` | bestanden, `--max-warnings=0` |
| `npx knip` | Exitcode 0, nur Konfigurationshinweise (keine ungenutzten Dateien/Exporte) |
| `npm run check:docs` | bestanden (112 Markdown-Dateien) |
| `git diff --check` | bestanden |
| `npm run build` | bestanden; Bundlebudget-Prüfung (`check:bundle`) bestanden; Startbudget unverändert, kein Clientcode geändert (initialBytes 450 677, initialPathChunks 11) |
| `npx playwright test --project=browser e2e/tutor-learning.spec.ts e2e/tutor-status-indicator.spec.ts e2e/tutor-debug-graphics.spec.ts e2e/tutor-review.spec.ts e2e/tutor-mocked-lifecycle.spec.ts` (Standard-Retry 1) | 29 bestanden, 0 Retries nötig (Flaky 0); zusätzlich mit `--retries=0` ebenfalls 29/29 |
| `NODE_ENV=test UNOSIM_SERVER_MODE=local npm run sonar` | Gate PASSED, frische Analyse `51f6ac64` (2026-11-11 22:33 UTC); siehe 8a |

Neue Testdateien im Gate: `vitest list` ordnet die Serverdateien `unit-node`, `tutor-mocked-dialog.routes.test.ts` dem Projekt `unit-node-http` und die Clientdateien `unit-client` zu; `tutor-quality` schließt die fünf neuen Servertests unter `tests/server/services/tutor/` ein (Zählung 764 → 883).

## 8a. Coverage und Sonar

Erster Scan (Analyse `9e4985b6`, 22:29 UTC): Gate FAILED mit genau einem neuen Verstoß, `typescript:S3776` (kognitive Komplexität 18 > 15) in `evaluateSamples` (`real-provider-evaluation.ts`), verursacht durch meine Ergänzung des Semantikeintrags. Behoben an der Ursache durch Auslagern in `semanticRecord`; danach `check`, `lint`, `knip`, `test:tutor-quality` (883/883) erneut grün. Zweiter Scan über den endgültigen Stand (inklusive einer verschärften Assertion in SD-01): **Quality Gate PASSED**, Analysedatum jünger als die Ausgangsanalyse `8fbfb8f0` (21:10 UTC), keine neuen Verstöße. Zweite Analyse: `51f6ac64`, 22:33 UTC. Im Coverage-Lauf übersprang der Emulator bewusst 295 Tests (`UNOSIM_SKIP_CORPUS=1`, kein Tutor-Bezug). Der Scan enthielt den Coverage-Lauf (`npm run test:coverage`) und endete mit Exitcode 0. Die Datumszuordnung wurde über `api/project_analyses/search` geprüft.

## 9. Selbstprüfung gegen die fünf Review-Focus-Punkte

1. **„Ist es 1?“ ≠ Klärung; echte Bitte ≠ Fehlversuch.** SD-01: „Ist es 1?“, „Meine Erklärung: Bit 7 ist gesetzt, also 1.“ und „Gibt es eine 1 aus, weil das Bit gesetzt ist?“ werden als Antwort bewertet (Providerzähler +1); „Welche Variable meinst du?“/„Ich brauche einen Tipp“ lassen Frage, Versuche, Sterne und Evidenz unverändert. LC-01 prüft dieselbe Unterscheidung im Browser.
2. **Offene Frage vs. bereits beantwortete.** RC-02a (erfolgreich beantwortet → Wiederholung wird ersetzt, exakt und heuristisch) gegen RC-02b (schwach beantwortet im Lernhilfezyklus → dieselbe Frage bleibt).
3. **Header-/Board-/Codewechsel.** CV-04/CV-05 (Server, Referenz nicht mehr anwendbar, gleiche Rohbewertung bleibt unkorrigiert); LC-01 zeigt im Browser die Anwendung der Referenz.
4. **Sichere Grafik nach Frageersetzung.** GQ-01/02/04: Grafik wird mit der ersetzten Frage verworfen (Grund `question-replaced`, gleiche `diagramId`, Review `discarded`); ohne Ersetzung bleibt sie mit denselben Knoten/Kanten; eine gehaltene Grafik erscheint erst nach „Weiter“ und wird einmal gezählt.
5. **Altes Ergebnis nach Leeren/DEBUG/„Weiter“.** LC-03 und `tutor-review-state-machine.test.ts` (einschließlich Überschneidung mit frischem Request); Gegenprobe G5 zeigt, dass die Tests die Epochenschutz-Ebenen wirklich erkennen.

Eine unabhängige Zweitprüfung durch eine andere Instanz wurde nicht durchgeführt; dies ist eine Selbstprüfung.

## 10. Echte Modellmessung: nicht ausgeführt – kein Budget beauftragt

Keine KI:connect- und keine Judge-Anfragen. Die Fake-Läufe belegen Evaluatorfähigkeit (Auswertung, Zuordnung, Berichte), nicht Modellqualität. Nicht gemessen: alle sieben Anhang-B-Fälle gegen ein echtes Modell, die semantische Beurteilung durch einen echten Judge (Prompt v3 ist nicht kalibriert), fachlich falsche, aber sichere Grafiken.

### Vorbereitetes Live-Protokoll (zur Genehmigung, ohne Aufruf)

- **Feste Modelle:** Tutor-Modell und Judge-Modell explizit (kein `auto`); angefragte und zurückgegebene Kennungen aus dem Bericht festhalten.
- **Stand:** sauberer relevanter Git-Stand (der Runner prüft ihn), Korpus v17 (Digest `bd3d95d5…`), Judge-Revision `tutor-quality-minimal-criteria-v3`, Tutor-Promptrevision unverändert.
- **Vorab gewählte Fälle:** `TQ-DICE-INITIAL`, `TQ-DICE-CLARIFY`, `TQ-DICE-SERIAL`, `TQ-DICE-OBJECTION`, `TQ-DICE-FOLLOWUP`, `TQ-GRAPH-PROCESS`, `TQ-GRAPH-NO-SOLUTION`.
- **Screening:** 3–5 Stichproben je Fall. *Die frühere Schätzung (2 Modelllisten, ≈ 55 bzw. ≈ 90 Aufrufe) war falsch:* Mit festem Modell ruft der Service vor jeder Tutoraktion die Modellliste ab (`resolveModel`, SSOT R-BUD-2), zusätzlich einmal der Runner beim Start. Abgeleitet aus dem Runnerweg und bestätigt durch einen kontrollierten Trockenlauf (echter Loader und Runner, zählender Fake-Provider, kein Netzwerk):

  | Fall | Tutoraktionen je Stichprobe | Listen | Tutor | Judge | Summe je Stichprobe |
  | --- | --- | --- | --- | --- | --- |
  | `TQ-DICE-CLARIFY` (http: Initialfrage + Klärung) | 2 | 2 | 2 | 1 | 5 |
  | jeder der sechs übrigen Fälle | 1 | 1 | 1 | 1 | 3 |
  | Runnerstart | – | 1 | – | – | 1 |

  Gemeinsamer Lauf aller sieben Fälle: **n = 3: 25 Listen + 24 Tutor + 21 Judge = 70 Aufrufe; n = 5: 41 + 40 + 35 = 116** (Trockenlauf: `providerCalls.total` 70 bzw. 116). `--max-calls` zählt alle drei Arten gemeinsam (R-BUD-3). Ein Grafikfall ohne ausgelieferte Grafik spart seinen Judge-Aufruf; die Zahlen sind daher Obergrenzen. Automatische Wiederholungen gibt es weder im Runner noch im Adapter noch im Judge-Aufruf (mit festem Modell auch keinen versteckten Listenabruf im Adapter; `auto` ist ausgeschlossen). Eine vorab genehmigte, begrenzte Wiederholung einer technisch ausgefallenen Stichprobe ist ein eigener Lauf und kostet 1 + 3 Aufrufe (1 + 5 für `TQ-DICE-CLARIFY`); Reserve für höchstens eine solche Wiederholung je Fall: 7 + 6 × 3 + 5 = 30. Zu genehmigen ist also z. B. 70 (+ 30 Reserve) für n = 3 oder 116 (+ 30) für n = 5; `--max-calls` setzt die harte Grenze je Lauf.
- **Technische Ausfälle** nicht durch neue Läufe „heilen“; Rate-Limits getrennt berichten.
- **Bericht je Fall:** geplant/ausgeführt/auswertbar; Rohmodellfehler; ausgelieferte Fehler; Anwendungskorrekturen; ungültige Judge-Ergebnisse; Grafikfälle: Anteil mit ausgelieferter Grafik. Strittige und kritische Befunde menschlich nachprüfen; `severeFindings` und `warn`/`inconclusive`/`not-run` nie als Freigabe lesen.
- **Nicht ersetzt:** zweiter kalibrierter Beurteiler, Untersuchungen mit Lernenden. Weder Fake-Pass noch 3/3 Live-Pass belegt einen Lerneffekt.

## 11. Offene Punkte

- Sonar-Gate: siehe 8a.
- Modellmessung: Abschnitt 10.
- Bekannte Grenzen der neuen Tests: Referenzen der Dice-Fälle fehlen bewusst (keine Musterantwort erfunden). Die frühere Grenze des SD-Fakes (unbegrenzte zyklische Erklärungen) ist seit Abschnitt 13 behoben. Die Fake-Judge-Regeln sind Testmittel für die jeweils bekannten Beispiele, keine allgemeinen Semantikprüfer.

## 12. Unabhängige Prüfung am 2026-11-12

Nach der Selbstprüfung wurde der uncommittete Stand durch eine separate Prüfinstanz und den koordinierenden Agenten unabhängig nachgeprüft. Ergebnis: **vor Commit nachbessern**. Der [Prüfbericht](review-tutor-test-completion-2026-11-12.md) dokumentiert drei wesentliche Lücken: eine im Tutorinput fehlende historische Falschbehauptung beim Selbstkorrekturfall, eine fachlich ungeeignete positive Grafikprobe und eine bereits vor Freigabe erfüllte Wartebedingung im Test der verspäteten Antwort. Hinzu kommt die dokumentierte Abweichung des nicht strikt begrenzten SD-Fakes. Die vollständige Unit-Suite wurde erneut erfolgreich ausgeführt (App 4.540 bestanden / 1 übersprungen, Emulator 697 bestanden). Die genannten grünen Implementierungsläufe bleiben als historische Nachweise erhalten; sie schließen diese konkreten Testlücken nicht. Produktcode und Tests wurden bei der Nachprüfung nicht geändert. Der [gezielte Korrekturauftrag](../superpowers/prompts/2026-11-12-tutor-test-completion-corrections-sonnet.md) beschreibt die Nachbesserung.

## 13. Nachbesserung am 2026-11-12

Umgesetzt nach dem [Nachbesserungsauftrag](../superpowers/prompts/2026-11-12-tutor-test-completion-corrections-sonnet.md). Die Datenwege und Gegenproben je Befund stehen im [Prüfbericht, Abschnitt 6](review-tutor-test-completion-2026-11-12.md#6-nachbesserung). Modellbudget: 0 Calls, keine KI:connect- und keine Judge-Anfragen. Nichts committet. Dies ist keine unabhängige Nachprüfung.

**Geänderte Dateien in der Nachbesserung:**

- `server/services/tutor/evaluation/anchor-corpus.ts`: Historien-`feedback` mit Vertragsgrenze; fremde Historienfelder werden abgelehnt.
- `scripts/tutor-quality-real-provider-eval.ts`: `historyEntry` übernimmt `feedback`.
- `evals/tutor-quality/anchor-corpus.yaml`: v17. `TQ-DICE-OBJECTION` sendet die Falschbehauptung als Feedback, und der Fakt zitiert sie.
- SSOT: `HistoryEntry`, R-TURN-6.
- Tests: `anchor-corpus.test.ts` (Pin v17, Parsertests), `tutor-dialog-regressions.test.ts` (Prompttests zu A, neues Grafikpaar zu B), `tutor-mocked-dialog.routes.test.ts` (strikter Fake, Kontrollen).
- E2E: `e2e/tutor-mocked-lifecycle.spec.ts` (LC-02).
- Neu: `tests/client/tutor-late-dialog-answer.test.tsx`.
- Doku: Matrix, Prüf- und Arbeitsbericht.
- Produktcode außerhalb der Evaluation: keine Änderung. `tutor-service.ts` und `use-tutor.ts` wurden nur für die Gegenproben A4, C1 und C2 kurz verändert und bytegenau wiederhergestellt (SHA-256 geprüft).

**Gegenproben:** A1–A4, B1, C1, C2, D1 und D2 waren mit deaktiviertem Schutz rot und nach der Wiederherstellung grün (Tabelle im Prüfbericht). A3 wurde nach der Komplexitätskorrektur gegen die ausgelagerte Prüfung wiederholt und war erneut rot.

**Prüfläufe nach der Nachbesserung:**

| Befehl | Ergebnis |
| --- | --- |
| `npx vitest run --project=unit-node` (Regressionen, erweiterte Evidenz, Korpus, `http-replay`) | 4 Dateien, 155 Tests bestanden |
| `npx vitest run --project=unit-node-http tests/server/routes/tutor-mocked-dialog.routes.test.ts` | 19 Tests bestanden (bisher 15, plus 4 Kontrollen des Fakes) |
| `npx vitest run --project=unit-client tests/client/tutor-late-dialog-answer.test.tsx` | 1 Test bestanden |
| `npm run test:tutor-quality` | 65 Dateien, 892 Tests bestanden, 2404 ms von 15000 ms |
| `npm run test:unit` | App 4554 bestanden, 1 übersprungen (`capacity-validation.test.ts`, wie zuvor); Emulator 697 bestanden |
| `npm run check`, `npm run lint`, `npx knip` | Exitcode jeweils 0 |
| `npm run build` | bestanden, Bundlebudget unverändert (initialBytes 450 677) |
| Playwright `--retries=0`, fünf Tutor-Specs | 29 bestanden |
| `NODE_ENV=test UNOSIM_SERVER_MODE=local npm run sonar`, erster Lauf (ca. 09:14 UTC) | **Gate FAILED**: ein neuer Verstoß `typescript:S3776` (Komplexität 20) in `parseHistory`, verursacht durch die Nachbesserung. Der Befehl endete trotzdem mit Exitcode 0, maßgeblich ist die Gate-Zeile. |
| Korrektur | Prüfung fremder Felder in `assertKnownHistoryKeys` ausgelagert. Danach erneut grün: gezielte Tests, `check`, `lint`, `knip`, `test:tutor-quality` (892) und `test:unit` (4554 und 697). |
| `NODE_ENV=test UNOSIM_SERVER_MODE=local npm run sonar`, zweiter Lauf (ca. 09:19 UTC) | **Gate PASSED**: neue Verstöße 0, Coverage neuer Code 86,6 %, Duplikate 0,02 %, Hotspots 100 % geprüft. Die Analyse ist jünger als der fehlgeschlagene Lauf. Im Coverage-Lauf übersprang der Emulator wie bisher 295 Korpustests. |

Build und Browserlauf wurden nach der Komplexitätskorrektur auf dem Endstand wiederholt: `npm run build` bestanden (initialBytes 450 677), Playwright `--retries=0` mit den fünf Tutor-Specs 29 bestanden.

**Grenzen:** Die Fake-Judge-Regeln sind Testmittel für bekannte Beispiele. Fake-Läufe sagen nichts über Modellqualität. Die echte Modellmessung bleibt „nicht ausgeführt – kein Budget beauftragt“, das Aufrufbudget steht in Abschnitt 10.

## 14. Unabhängige Nachprüfung und Commitfreigabe

Am 2026-11-12 haben der koordinierende Agent und eine separate frische Prüfinstanz die Nachbesserungen unabhängig geprüft. **A–C und die SD-Fake-Abweichung sind geschlossen; keine verbleibenden wesentlichen Reviewbefunde im geprüften Umfang.** Die Datenwege und Nachweise stehen im [Prüfbericht, Abschnitt 7](review-tutor-test-completion-2026-11-12.md#7-unabhängige-nachprüfung-der-korrekturen).

Der koordinierende Agent bestätigte mit eigenen frischen Läufen: Unit App 4.554 bestanden / 1 übersprungen, Emulator 697 bestanden, Tutor-Quality 892 bestanden, Typprüfung/Lint/Knip sauber sowie alle 29 Tutor-Browsertests gegen einen frisch gebauten Client ohne Retry. Bundlebudget bestanden. Das vorhandene erfolgreiche Sonar-Gate wurde zusätzlich anhand seiner konkreten Analyse-ID über die API geprüft. Die unabhängige Prüfinstanz bestätigte die fokussierten Gegenbeispiele und meldete keine neuen Critical-/Important-Befunde. Reale Modellmessung bleibt ausdrücklich nicht ausgeführt; sie ist kein Bestandteil dieser technischen Commitfreigabe.

## 15. CI-Befunde in PR #379 und Korrektur

Erster CI-Lauf auf `f39cefcc5` (Run 43198946195): sechs Jobs grün, drei rot.

- **Clean-room checks and build, Dead-Code-Gate:** Knip im Produktionsprofil meldete `buildJudgeInput` (`judge.ts`) als nur in Tests genutzten Export. Ursache: Der Runner nutzt seit Aufgabe 8 `judgeEvidence`. Mein lokaler `npx knip`-Lauf prüfte nur das volle Profil. Behoben, indem die Kurzform aus dem Produktcode entfernt und als Testhilfe `judge-input.ts` bereitgestellt wurde; in `judge.test.ts`, `tutor-judge-extended-evidence.test.ts` und `http-replay.test.ts` ändert sich nur die Importzeile, alle Assertions bleiben gleich. Lokal ist `./run-tests.sh --knip-gate-only` jetzt grün (beide Profile: neu 0).
- **Lint & Unit Tests:** Alle Tests bestanden, aber das Wanduhr-Testbudget `unit-coverage` wurde überschritten: 156 354 ms bei 150 000 ms Grenze. Keine der neuen Testdateien ist unter den zehn langsamsten. Auf `main` schwankt derselbe Wert zwischen 101 251 ms, 118 298 ms und 152 543 ms; der Lauf mit 152 543 ms ist auf `main` ebenfalls gescheitert. Das Budget wurde nicht verändert.
- **Clean-room reproducibility:** Sammeljob, rot als Folge des Knip-Befunds.
