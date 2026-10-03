# UnoSim – Tutor-Quality-Automatisierung: Umsetzungsplan

Stand: 2026-10-02
Status: ausführbarer Plan, **nicht normativ**. Normativ ist
`ssot/ssot_function_definition_TutorQualityEvaluation.md` (im Folgenden
„Evaluation-SSOT“, Regeln als `R-…`).
Ersetzt als Arbeitsgrundlage: `docs/UNOSIM_TUTOR_SIMPLIFICATION_PLAN.md`,
`docs/plan-tutor-quality-stage-2a.md`,
`docs/superpowers/plans/2026-09-27-tutor-quality-stage-1.md` (historisch).

Geprüft gegen: `main` @ `c2c2940a`, lokaler Branch
`refactor/tutor-quality-phase2-1-strategy-cases` @ `79032a3f`
(Worktree `/private/tmp/unosim-tutor-quality-strategy-cases`, nicht gepusht).

---

## 0. Arbeitsregel für den ausführenden Agenten

**Claude Sonnet / Luna MUST read:**

1. `ssot/ssot_function_definition_TutorQualityEvaluation.md`
2. `docs/UNOSIM_TUTOR_QUALITY_AUTOMATION_PLAN.md`

**before implementing any Tutor-Quality change.**

Vor jedem PR:

- **Aktuellen Code erneut prüfen.** Zeilennummern und Befunde in diesem Plan
  sind ein Stand vom 2026-10-02. Weicht der Code ab, gilt der Code; den Plan
  nicht blind übernehmen, Abweichungen im PR-Text nennen.
- **TDD:** erst ein roter Test, der den Befund belegt, dann der Fix.
- **Ein PR, ein Zweck.** Kein Refactor, der für den Zweck nicht nötig ist.
- **Bestehende Tests sind Spezifikation** (`ssot/ssot_agent_policy.md` 2.2):
  Eine Änderung an bestehenden Testerwartungen nur mit technischer Begründung
  im PR-Text und ausdrücklicher Freigabe durch den User.
- **Keine Provider-Calls**, außer in PR E, und dort erst nach ausdrücklicher
  Freigabe.
- **Geschützte Datei** `ssot/ssot_function_tutor_model_registration.md` niemals
  verändern, auch nicht für Verweise.
- **Kein Push** ohne ausdrückliche Freigabe. Kein `--no-verify`.
- Conventional Commits, Commit-Header ≤ 100 Zeichen.
- Base-Branch aller PRs dieser Serie: `main` (verbindlich; es gibt keinen
  `dev`-Branch, obwohl `ssot/ssot_agent_policy.md` 2.1 `dev` nennt). Vor jedem
  neuen Branch: `git fetch --prune origin`, `main` per `--ff-only` aktualisieren
  und prüfen, dass lokales `main` und `origin/main` denselben SHA haben.
- Nach jedem PR: Review abwarten, erst dann den nächsten beginnen.

### 0.1 Gates (für jeden PR)

```bash
npm run check                          # 0 TypeScript-Fehler (beide Projekte)
npm run test:tutor-quality             # 0 failed, Budget eingehalten
npm run test:unit                      # 0 failed, Budget eingehalten
npx eslint . --ext .ts,.tsx            # 0 Fehler, keine neuen Warnungen ggü. Ausgangsstand
                                       # (nicht `npm run lint`: das ruft --fix auf)
npm run check:docs                     # 0 Fehler (Links, npm-Skripte in Markdown)
git status --porcelain                 # nur beabsichtigte Dateien
```

Zusätzlich, wenn Course-Content-Logik berührt ist: `npm run validate:tutor-course-content`.
Vor Beginn jedes PRs die Ausgangswerte (Testanzahl, Warnungen) notieren und im
PR-Text gegenüberstellen.

---

## 1. Reihenfolge

| PR | Zweck | Basis | Provider-Calls |
| --- | --- | --- | --- |
| A | EXPAND-Produktfehler beheben | `main` | nein |
| B | Strategy-Cases fachlich korrekt (Phase 2.1 fertigstellen) | Phase-2.1-Branch, rebased auf `main` nach A | nein |
| C | Evaluation-Diagnostik (Quotes, Report, Provenance) | `main` nach B | nein |
| D | SSOT-/Doku-Konsolidierung | `main` nach C | nein |
| E | Real-Provider-Baseline | `main` nach D | **ja, nach Freigabe** |
| F | `qualityVerdict` und Exit-Code | `main` nach Sichtung von E | nein |
| G | periodische Ausführung | `main` nach F | nur durch den Workflow |

---

## PR A – EXPAND-Fortsetzung (Produktfehler)

**Zweck:** R-EXP-1 und R-EXP-2 erfüllen. Eine vom Planner erzeugte
EXPAND-Erweiterungsfrage wird bei der Dialogantwort erkannt; die Antwort endet
nicht fälschlich in `content-exhausted`.

**Befund (Stand `79032a3f`, mit Fake-Provider reproduziert):**
- `generateQuestion` im EXPAND-Zustand liefert `questionId: expand-<target>`
  aus `buildExpansionPlan` (`server/services/tutor/curriculum-tutor-adapter.ts`).
- `generateDialogResponse` mit genau dieser Frage liefert bei Rating 2 und 5
  `progressionBlockedReason: content-exhausted`.
- Ursache: `findQuestion` sucht nur in `topic.questions`. `planner.advance`
  liefert dann null, und `advancePlan` ruft `exhaustionResult` auf.
- Der Dialog-Request überträgt für die *aktuelle* Frage nur deren Text
  (`tutorDialogRequestSchema`: `question`, keine ID). History-Einträge können
  eine `questionId` tragen, aber nur für frühere Turns.
- Im Server-State gibt es `usedExpansionTargetTopicIds` (wird in `startPlan`
  über `markExpansionTargetUsed` gesetzt).

**Scope:** `server/services/tutor/curriculum-tutor-adapter.ts`, bei Bedarf
`server/services/tutor/curriculum/progression-state.ts`, zugehörige Tests,
optional ein Satz in `ssot/ssot_function_definition_LearningQuestions.md`
(Abschnitt „DEEPEN to EXPAND“).

**Nicht im Scope:** Tutor-Quality-Corpus, Evaluation-Runner, Report,
die Fixture `includeExpansionPlanQuestion` (Entfernen erst in PR B).

**Schritte:**

1. Den bestehenden Testort für Adapter-/Progressionsverhalten suchen
   (`tests/server/services/tutor/`), dort ergänzen statt eine neue Struktur
   anzulegen.
2. **RED:** Course Content wie die Anchor-Fixture `progression-expand`, aber
   **ohne** eine Frage, die den Erweiterungstext imitiert (Topic-Schema v2 mit
   `extensions` und `deepening`, State `phase: EXPAND`, Topic gemeistert).
   - `generateQuestion` → `learningPhase: EXPAND`, `questionId` beginnt mit `expand-`.
   - `generateDialogResponse` mit genau dieser Frage, Fake-Rating 2 **und** 5.
   - Erwartung: `learningPhase === "EXPAND"`; `progressionBlockedReason`
     undefined (im Ergebnis und im State); die Folgefrage stammt aus einem
     Planner-Schritt (Transferfrage, weitere unbenutzte Erweiterung oder
     begründete Lückenrevision).
   - Gegenprobe: Gibt es weder Transferfrage noch unbenutzte Erweiterung noch
     Lücke, ist `content-exhausted` weiterhin erlaubt (R-EXP-2).
3. **Implementierung, Entscheidungsreihenfolge (R-EXP-3):**
   1. Bevorzugt eine stabile, application-owned Identität: Die beim Ausliefern
      des Erweiterungsplans bekannte `questionId`/Erweiterung wird im
      Server-State bzw. vorhandenen State-Feldern (`usedExpansionTargetTopicIds`)
      so verfügbar gemacht, dass die Antwort ihr eindeutig zugeordnet wird.
   2. Wenn das nicht ohne Vertragsänderung geht: kleinstmögliche
      State-Ergänzung (zum Beispiel die zuletzt ausgelieferte Plan-Question-ID),
      mit Begründung im PR. State-Migration und Revisionsreset beachten.
   3. Textabgleich nur, wenn nachweislich keine stabile Identität verfügbar
      ist. Dann muss es eine einzige Funktion geben, die den Erweiterungstext
      erzeugt und abgleicht, und der PR-Text muss das begründen.
   - Die erkannte Antwort zählt als `transfer`-Beobachtung in
     `postMasteryEvidence` (konsistent mit `questionKind: "transfer"` des
     Erweiterungsplans), danach der nächste EXPAND-Planschritt.
   - SSOT-Regel „must not repeat the same extension indefinitely“ bleibt
     erfüllt: ein benutztes Ziel wird nicht erneut angeboten.
4. Stage-1-Tests und alle Adapter-Tests grün; keine bestehende Erwartung
   ändern ohne Freigabe.

**Abnahme:** RED-Test grün für Rating 2 und 5; Gegenprobe grün; Gates grün;
Tutor-Quality-Corpus unverändert.

**Commit-Vorschlag:** `fix(tutor): continue EXPAND after a generated extension question`

---

## PR B – Strategy-Cases fachlich korrekt

**Zweck:** Die sechs Strategy-Cases testen tatsächlich 2× LEARN, 2× DEEPEN,
2× EXPAND über den echten `TutorService` und `CurriculumTutorAdapter`, nicht
Free-Tutor und nicht `content-exhausted`.

**Basis:** Branch `refactor/tutor-quality-phase2-1-strategy-cases`
(`c0df64d3`, `79032a3f`) nach dem Merge von PR A auf `main` rebasen.
Bereits vorhanden und zu behalten: Allowlist in `parseExpected`, strikter
`learningPhase`-Check, `phaseAfter`, Blocked-Check, Judge-Prompt-Satz zur
Quote-Allowlist.

**Scope:** `evals/tutor-quality/anchor-corpus.yaml`,
`server/services/tutor/evaluation/anchor-corpus.ts`,
`server/services/tutor/evaluation/anchor-course-content.ts`,
`server/services/tutor/evaluation/real-provider-evaluation.ts` (nur Checks),
`scripts/tutor-quality-real-provider-eval.ts` (nur Materialisierung),
Tests unter `tests/server/services/tutor/evaluation/`.

**Nicht im Scope:** Report-Format, Judge-Parser, neuer Runner, echte Calls.

**Schritte (jeweils RED → GREEN):**

1. **`expected.answerRating`** (R-RAT-1..5):
   - Parser: Tupel `[min, max]`, ganzzahlig, `1 ≤ min ≤ max ≤ 5`; nur gültig,
     wenn der letzte Turn `dialog` ist.
   - Parser (R-RAT-2): `phaseAfter` verlangt `learningPhase`; bei
     `learningPhase` ∈ {LEARN, DEEPEN} verlangt `phaseAfter` auch `answerRating`.
   - Check `expected-answer-rating` auf dem letzten Turn; Violation
     `answer-rating-out-of-band`, Ursache Rating.
   - `expected-phase-after`: Bei Rating außerhalb des Bands **nicht anwendbar**
     (R-RAT-5, R-ATT-2). Kodierung minimal und additiv, zum Beispiel ein
     optionales Feld am Check (`outcome: "not-applicable"`, `reason:
     "rating-out-of-band"`). Nicht als `passed: true` tarnen. Keine Violation.
2. **`bindsToQuestion` entfernen** (R-TURN-4): aus beiden Turn-Typen, Parser,
   Preflight (`unbound-question-context` entfällt), `invalidTurnContext`,
   `safeTurn`, YAML. `preceding-question-mismatch` bleibt.
3. **Fixture-Workaround entfernen** (R-EXP-4): `includeExpansionPlanQuestion`
   und die Frage `expand-serial-output` löschen. Die EXPAND-Cases müssen danach
   dank PR A grün sein.
4. **Wertebereiche nicht duplizieren:** Phasen und Blocked-Gründe aus
   `DidacticPhase` und `ProgressionBlockedReason`
   (`server/services/tutor/curriculum/progression-state.ts`) ableiten;
   `expected` als ein gemeinsamer exportierter Typ für Corpus und Runner.
5. **Corpus `corpusVersion` erhöhen** und Cases korrigieren:
   - Ratings (Vorschlag; aus Didaktik und Mastery-Konfiguration der Fixture
     ableiten und im PR begründen):
     - `strategy-learn-weak-answer`: `[1,2]`, `phaseAfter: LEARN`;
     - `strategy-learn-strong-answer`: `[3,5]`, `phaseAfter: DEEPEN`
       (Fixture: `successRatingAtLeast: 3`);
     - `strategy-deepen-transfer`: `[4,5]`, `phaseAfter: EXPAND`
       (Fixture: `deepening.successRatingAtLeast: 4`);
     - **`strategy-deepen-correction`** (falsche Antwort): `[1,2]`,
       **`phaseAfter: DEEPEN`** (heute fälschlich `EXPAND`);
     - EXPAND-Cases: `phaseAfter: EXPAND`, `answerRating` nur falls fachlich
       Gegenstand;
     - `learn-to-deepen`: braucht nach R-RAT-2 ein Band (`[3,5]`).
   - **DEEPEN-Prämisse** (R-AUT-2): Beide DEEPEN-Cases auf
     `evals/tutor-quality/fixtures/simple-variable.ino` umstellen (dort gilt
     `counter += 1`), Facts und Antworten anpassen. Die Fehlvorstellung
     „`delay` erhöht `counter`“ bleibt dort eine echte Fehlvorstellung.
   - **ID-Facts entfernen** (R-AUT-3): alle Facts mit `… hat die ID …` streichen
     oder in Klartext ohne IDs umschreiben.
   - Kriterien gegen R-CRT-1..3 prüfen; nichts, was nur über Rating, ID oder
     Phase entscheidbar wäre.
6. **Fake-Rating-Heuristik ersetzen** (R-RAT-6): `includes("99")` in
   `tutor-quality-real-provider-cli.test.ts` (zwei Stellen) durch ein Rating
   aus dem `answerRating`-Band des jeweiligen Cases ersetzen (Zuordnung über
   die geladenen Szenarien, nicht über Prompt-Inhalte). Negativtest: Ein
   Rating außerhalb des Bands erzeugt `answer-rating-out-of-band`, und
   `phaseAfter` ist nicht anwendbar.
7. **Keine hart codierten Listen** (R-AUT-1): die vollständige ID-Liste in
   `anchor-corpus.test.ts` durch strukturelle Invarianten ersetzen.
   (Änderung bestehender Tests: Begründung im PR, Freigabe einholen.)

**Abnahme:** Ein Fake-Provider-Lauf über den echten `TutorService` und
`CurriculumTutorAdapter` (bestehender CLI-Test) zeigt für alle sechs
Strategy-Cases:
- `learningPhase` = erwartete Phase auf jedem Turn;
- `phaseAfter` wie erwartet bzw. nicht anwendbar;
- kein `progressionBlockedReason`;
- die bediente Frage stammt vom Planner (bis PR C prüfbar über die
  Plan-`questionId` *im Test*; das ist eine Testaussage, keine Report-Provenance);
- 0 Violations, 0 externe Calls.

---

## PR C – Evaluation-Diagnostik

**Zweck:** Ein Entwickler sieht im Report, *was* schlechter wurde und *wer*
es verursacht hat.

**Scope:** `server/services/tutor/evaluation/judge.ts`,
`server/services/tutor/evaluation/report.ts`,
`server/services/tutor/evaluation/real-provider-evaluation.ts`,
`server/services/tutor/tutor-service.ts` (nur Provenance), Tests.

**Schritte:**

1. **Quote-Allowlist einmal definieren** (R-EVD-3): eine Konstante für die
   Quellen `sketch`, `tutor.feedback`, `tutor.followUpQuestion`; Prompt-Satz
   und Parser lesen daraus.
2. **Quote innerhalb einer Quelle** (R-EVD-4): Evidence als Liste dreier
   normalisierter Quellen; gültig nur bei Teilstring einer Quelle. RED-Test:
   ein Zitat über die Grenze Feedback/Folgefrage → `criterion-quote-not-in-evidence`.
3. **Judge-Prompt-Revision erhöhen** (R-RSP-4): Der Prompt hat sich in
   `79032a3f` geändert, die Revision steht noch auf
   `tutor-quality-minimal-criteria-v1`. Auf `-v2` setzen; im PR vermerken, dass
   G1 für v1 gemessen wurde.
4. **Follow-up-Provenance an der Entscheidungsstelle** (R-FUP-1..4):
   - Entscheidungsstellen in `tutor-service.ts`: `applyPlanningOutcome` (ein
     `TutorPlan` ersetzt die Frage → `planner`), `ensureDistinctDialogQuestion`
     (Ersatzfrage → `application-fallback`), philosophischer Fallback
     (`application-fallback`), sonst `provider`.
   - Die Quelle als zusätzliches Feld im **internen** Rückgabeobjekt von
     `generateQuestion` und `generateDialogResponse` (heute `{ result, model }`)
     liefern. `tutor.routes.ts` gibt nur `result` und `model` weiter; die
     öffentliche API bleibt unverändert (R-FUP-3). Mit einem Test belegen.
   - Keine Ableitung aus `questionId`.
   - Falls sich das als unverhältnismäßig erweist: im Report „unavailable“
     (R-FUP-4); keine Heuristik.
5. **Report-Diagnostik** (§11.2, R-REP-3), additiv in `report.json`, lesbar in
   `report.md`:
   - pro Sample und Turn: `learningPhase`, `answerRating`, Blocked-Grund,
     Follow-up-Provenance, Checks mit pass/fail/nicht anwendbar, Violations
     (Quelle, Code);
   - pro Sample: `phaseAfter`, Judge-Status, Verdicts, Critical Issues,
     technische Fehler, Calls, Dauer;
   - pro Run: Gesamtdauer;
   - deterministisch sortiert (Case, Sample, Turn, Check).
   - Schema-IDs bleiben `-v1` (nur additive Felder, §11.4).

**Nicht im Scope:** Plattform, Dashboard, Datenbank, Verdict.

**Abnahme:** L2-Tests für Allowlist-Gleichheit, Quellgrenze, Provenance (alle
drei Werte) und eine `report.md`-Fixture mit deterministischer Reihenfolge;
Gates grün.

---

## PR D – SSOT-/Doku-Konsolidierung

**Zweck:** Die Doku entspricht dem Code nach A–C. Keine funktionalen Änderungen.

**Schritte:**

1. Evaluation-SSOT gegen den Code abgleichen; Appendix A auf den neuen Stand
   bringen (geschlossene Lücken entfernen).
2. `ssot/ssot_function_definition_TutorQualityStage2A.md`: löschen (bevorzugt)
   oder als Stub mit Verweis auf die Evaluation-SSOT belassen. Alle Verweise
   finden: `grep -rn "TutorQualityStage2A\|tutor-quality-stage-2a" --exclude-dir=node_modules --exclude-dir=coverage .`
3. `docs/tutor-quality-stage-2a.md`: Bedienteil (lokaler Lauf, Workflow) als
   kurzer Abschnitt „Running an evaluation“ in die Evaluation-SSOT oder ein
   Runbook übernehmen; Datei löschen oder als Stub umleiten.
4. `ssot/ssot_function_definition_TutorQuality.md` §7: auf die Evaluation-SSOT
   verweisen (der Hinweis ist bereits gesetzt; Wortlaut prüfen).
5. Historische Pläne: Kopfzeilen prüfen (bereits gesetzt, siehe Abschnitt 4).
6. `docs/tutor-quality-judge-smoke-2026-10-01.md`: Kopfzeile mit Verweis auf
   das Glossar der Evaluation-SSOT (Begriffe Protocol A/B, G1).
7. `.github/workflows/tutor-quality-real-provider.yml`: Artefaktname
   `tutor-quality-stage-2a-…` → `tutor-quality-run-…`; Input-Text „leave empty
   for Stage 2A only“ → „leave empty for execution only“.
8. Prüfen: Im normativen Text kommen „Stage 2A/2B“ nur noch im Glossar als
   historischer Begriff vor.

**Abnahme:** `npm run check:docs` grün; keine Codeänderung außer
Workflow-Namen.

---

## PR E – Real-Provider-Baseline (L3)

**Zweck:** Erster validierter realer Lauf der reparierten Cases als Baseline
und als Datengrundlage für die Verdict-Regel. **Nur nach ausdrücklicher
Freigabe.**

**Vorbereitung:**

1. Feste Tutor-Model-ID und feste Judge-Model-ID mit dem User festlegen
   (kein `auto`).
2. Case-Auswahl: alle Cases mit `judge`-Block (Stand heute: `TQ-SEM-001` und
   sechs `strategy-*`; nach PR B neu zählen).
3. **Budget exakt berechnen** (R-BUD-2) aus dem aktuellen Code:
   `1 + samples × Σ Turns × Calls_pro_Turn + samples × Judge-Cases`.
   **NON-NORMATIVE EXAMPLE** (Beispielrechnung, keine Vorgabe; normativ ist nur,
   das Budget vor jedem Run aus dem aktuellen Callgraph zu berechnen):
   7 Cases mit insgesamt 13 Turns, samples = 3,
   2 Calls pro Turn → `1 + 3·13·2 + 3·7 = 100`. Vor dem Start neu
   rechnen und als `--max-calls` genau diesen Wert setzen. Nicht die
   technische Obergrenze verwenden.
4. Clean Worktree, Credentials nur über Variablennamen
   (`--credential-env`, `--judge-credential-env`).

**Ausführung (lokal):**

```bash
npm run eval:tutor-quality:real -- --model <TUTOR_ID> --judge-model <JUDGE_ID> \
  --samples 3 --max-calls <BERECHNET> --output-dir .tutor-quality-output/baseline-<datum> \
  --credential-env UNOSIM_TUTOR_EVAL_CREDENTIAL --judge-credential-env UNOSIM_TUTOR_JUDGE_CREDENTIAL \
  --case TQ-SEM-001 --case strategy-learn-weak-answer --case …
```

**Auswertung**, als Bericht `docs/tutor-quality-baseline-<datum>.md`
(Artefakte selbst nicht committen):

- Schema-Validität und Evidence-Validität der Judge-Antworten;
- Repeatability: Konsistenz der Verdicts je (Case, Kriterium) über die drei
  Samples. Ehrlich ausweisen, dass das Tutor- und Judge-Varianz mischt. Eine
  reine Judge-Repeatability (Neubewertung eingefrorener Transcripts) gibt es
  im Runner nicht; nur bei konkretem Verdacht ad hoc wie bei G1 messen und
  dafür keine Runner-Funktion bauen;
- je Strategy-Case: `learningPhase`, `phaseAfter`, `answerRating` gegen das
  Band, Blocked-Grund, Follow-up-Provenance;
- Critical Issues;
- fachlich auffällige Judge-Verdicts von Hand durchsehen, insbesondere das
  bekannte stabile `accepts-correct-answer = fail` bei `TQ-SEM-001`
  (Tutor-Defizit oder Kriterienauslegung?);
- tatsächliche Calls gegen das berechnete Budget;
- Empfehlung für die Verdict-Regel (Input für PR F).

**Abnahme:** Bericht liegt vor, User hat ihn gesichtet. Ergeben sich Corpus-
oder Kriterienfehler, folgt ein eigener kleiner PR vor PR F.

---

## PR F – `qualityVerdict` und Exit-Code

**Zweck:** R-VER-1..3 umsetzen, mit einer an der Baseline begründeten Regel.

**Kandidatenregel (nicht normativ; anhand von PR E bestätigen oder verwerfen):**

- `fail`: App-eigene Violation (`final-tutor` außer Rating, `state`) in
  mindestens einem Sample; oder Rating außerhalb des Bands, ein Kriterium
  `fail` bzw. ein Critical Issue in ≥ 2 von 3 Samples;
- `warn`: dieselben LLM-abhängigen Befunde in 1 von 3 Samples;
- `inconclusive`: technische Fehler, `invalid`, Judge-Status ≠ `evaluated`,
  die ein Urteil verhindern;
- sonst `pass`.

**Schritte:**

1. Die endgültige Regel in die Evaluation-SSOT §12 schreiben (normativ),
   *bevor* sie implementiert wird.
2. `qualityVerdict` additiv in `report.json` und `report.md`, mit Begründung
   (welche Befunde zum Urteil geführt haben).
3. CLI: Exit ≠ 0 bei `fail`, getrennter Code für Laufzeitfehler (heute 1).
   Ob `inconclusive` einen eigenen Exit-Code bekommt, in PR F entscheiden.
4. L2-Tests für jede Klasse; Fixture-Reports aus anonymisierten
   Baseline-Daten.

---

## PR G – Periodische Automatisierung

**Zweck:** Bestehenden Workflow `.github/workflows/tutor-quality-real-provider.yml`
erweitern. Kein neuer Runner, kein neuer Workflow.

- L1/L2 bleiben auf jedem PR (`ci.yml`, unverändert).
- L3 manuell (`workflow_dispatch`) vor relevanten Änderungen an Tutor-Prompt,
  Strategy, Planner, Adapter oder Course Content.
- L3 zusätzlich per `schedule` wöchentlich auf `main`, mit festen Model-IDs
  und explizit berechnetem Budget. Kein Nightly, solange kein Nutzen belegt ist.
- Fehlende Secrets → `not-run`, kein roter Lauf (R-PYR-2).
- Artefakte: `report.json`, `report.md`, Transcripts; begrenzte Aufbewahrung.
- Der Vergleich mit der Baseline erfolgt per Text-Diff von `report.md`
  (R-REP-3). Keine Datenbank, kein Dashboard.

> Nachtrag: Der wöchentliche `schedule` ist wieder deaktiviert; L3 läuft vor
> relevanten Tutor-Änderungen lokal oder per manuellem Dispatch (Anhang B der
> Evaluation-SSOT). Der folgende Abschnitt beschreibt den damaligen Stand.

**Umsetzung (PR G, Stand 2026-10-03, Betrieb in Anhang B der Evaluation-SSOT):**

- **Scope: vollständiger Corpus** (v6: 17 Cases, 24 Turns, 7 mit Judge). Die
  SSOT definiert L3 „over the corpus“; jeder Case besteht L1 (R-PYR-1). Die
  zehn Cases ohne Judge-Block prüfen real, was L1 mit Fake-Provider nicht
  prüfen kann: Rohausgabe (Schema, eine Frage, keine Komplettlösung,
  Wiederholung), Rating-Bänder mit echtem Modell und provider-eigene
  Folgefragen. Ohne Case-Liste braucht ein neuer Case keine Workflow-Änderung.
  Diese zehn Cases liefen bisher nie real; der erste Wochenlauf ist auch ihre
  erste L3-Beobachtung.
- **Samples: 5** statt 3. Die Mehrheitsschwelle wird k(5) = 3. Bei einem
  Befund mit echter Rate um 50 % bleibt das Ergebnis ein Münzwurf, unabhängig
  von n. Für seltene Befunde sinkt aber die Wahrscheinlichkeit eines
  Zufalls-`fail` deutlich: bei Rate 0,15 pro (Case, Schlüssel) von 6,1 %
  (n = 3) auf 2,7 % (n = 5). Über acht bis zehn solche Paare pro Lauf (die Baseline
  hatte acht vereinzelte Befunde), sinkt die Wahrscheinlichkeit eines unbegründet roten
  Wochenlaufs damit von etwa 47 % auf etwa 24 %. Echte Befunde (Rate 0,8)
  werden öfter erkannt (90 % → 94 %). n = 7 würde nur noch wenig gewinnen
  (rund 11 %) bei 40 % mehr Calls.
- **Budget**: `1 + 5 × (46 + 7) = 266` Calls pro Woche (rund 7 bis 8 Minuten
  nach den Laufzeiten von Baseline und Nachlauf). Der Workflow-Vertragstest
  rechnet den Wert aus dem aktuellen Callgraph nach.
- **Modelle**: Tutor `openai-gpt5.4-mini`, Judge `openai-gpt5.5`, wie in
  Baseline und Nachlauf (beide mit je einer einheitlichen zurückgegebenen ID);
  damit bleiben die Wochenläufe mit diesen Daten vergleichbar.
- **Bekannter Zustand bei Aktivierung:** Baseline und Nachlauf ergeben nach
  §12 `fail`, getragen von echten Tutor-Befunden
  (`docs/tutor-quality-remediation-rerun-2026-10-03.md`):
  `strategy-expand-observation` / `expand-observable-result` (6 / 6 Samples
  über beide Läufe) und `strategy-learn-strong-answer` mit
  `learn-feedback-grounds-sketch` (3 / 3) sowie
  `learn-accepts-correct-answer` und `correct-answer-rejected` (je 2 / 3 im
  Nachlauf, 1 / 3 in der Baseline). Der Wochenlauf ist daher voraussichtlich
  rot, bis diese Tutor-Befunde behoben sind. Das ist beabsichtigt: Das Gate
  rechnet bekannte Probleme nicht grün; Kriterien und Schwellen bleiben
  unverändert.

---

## 2. Not-to-build

| Nicht bauen | Grund |
| --- | --- |
| neues Benchmark-Framework, neuer Runner | der bestehende Runner trägt beliebig viele Cases |
| Modellranking, Pairwise Model Evaluation | Ziel ist Regressionserkennung, nicht Modellvergleich |
| Calibration-Plattform | einmalige Durchsicht der Baseline (PR E) reicht |
| Exposure-System | kein belegter Bedarf |
| allgemeine Rubric Engine | Kriterien als Freitext pro Case sind die Stärke |
| Datenbank für Runs, Dashboard | Artefakte plus Text-Diff genügen |
| Workflow Engine | ein GitHub-Workflow genügt |
| komplexe Statistikplattform | einfache Mehrheitsregel über wenige Samples |
| Re-Judge-Funktion für eingefrorene Transcripts | nur bei konkretem Bedarf ad hoc |

## 3. Backlog (nur als eigener Mini-PR, wenn ohnehin Code berührt wird)

Nicht in A–G mischen:

- `compareTutorQualityCorpusVersions` und `CorpusEvolutionComparison` in
  `anchor-corpus.ts` werden nur von einem Selbsttest benutzt → entfernen.
- Toter Zweig in `questionIdReuseCheck` (`if (result.questionId === undefined) return;`
  nach `!result.questionId`).
- Den doppelt aufgebauten Check-Kontext in `processFinalResult` (Blocked-Check
  neben `expectedChecks`) zusammenführen.
- `incorrect-answer-remediation` dupliziert Sketch und Antwort von
  `strategy-learn-weak-answer`: als Free-Tutor-Pendant mit Judge-Block und
  `answerRating: [1,2]` aufwerten oder entfernen (Corpus-Version erhöhen).

## 4. Historische Dokumente

Als historisch bzw. abgelöst markiert, mit Verweis auf diesen Plan oder die
Evaluation-SSOT:

- `docs/UNOSIM_TUTOR_SIMPLIFICATION_PLAN.md`
- `docs/plan-tutor-quality-stage-2a.md`
- `docs/superpowers/plans/2026-09-27-tutor-quality-stage-1.md`
- `ssot/ssot_function_definition_TutorQualityStage2A.md` (abgelöst; in PR D entfernt)
- `docs/tutor-quality-stage-2a.md` (abgelöst; in PR D entfernt, Bedienteil in Appendix B der Evaluation-SSOT)
- `ssot/ssot_function_definition_TutorQualityStage2B.md`, `docs/plan-tutor-quality-stage-2b.md`
  (waren bereits historisch; Verweis ergänzt)
