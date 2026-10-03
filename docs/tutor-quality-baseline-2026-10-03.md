# Tutor Quality – Real-Provider-Baseline (L3)

Status: Auswertung von PR E aus `docs/UNOSIM_TUTOR_QUALITY_AUTOMATION_PLAN.md`.
Normativ ist `ssot/ssot_function_definition_TutorQualityEvaluation.md`
(im Folgenden „SSOT“, Regeln als `R-…`). Dieser Bericht legt keine
Verdict-Regel fest; Abschnitt 8 ist eine nicht-normative Empfehlung für PR F.

Der Lauf fand am 2026-10-03 statt (UTC 08:37–08:40). Als Ausgabeverzeichnis
wurde das zuvor vorbereitete `.tutor-quality-output/baseline-2026-10-02/`
verwendet; die Rohartefakte liegen nur dort lokal und werden nicht committet.

## 1. Lauf und Provenance

| Merkmal | Wert |
| --- | --- |
| Run-ID | `tq2a-20261003T083701839Z-08726f1f-020e-474e-ba2b-661cc3d04bb8` |
| Run-Status | `completed` |
| Git | `main` @ `218b606c`, saubere relevante Git-Lage (R-ID-3) |
| Corpus | `unosim-tutor-quality-anchor` v5, Datei-Digest `f3d70154…` |
| Tutor-Modell | requested `openai-gpt5.4-mini` → returned `gpt-5.4-mini-2026-03-17` (eine einheitliche ID) |
| Judge-Modell | requested `openai-gpt5.5` → returned `gpt-5.5-2026-04-24` (eine einheitliche ID) |
| Tutor-Prompt | `tutor-prompts-v1`, Template-Digest `7df4aa25…` |
| Judge-Prompt | `tutor-quality-minimal-criteria-v2` |
| Temperaturen | Tutor 0.2, Judge 0 |
| Timeout | 30 000 ms |
| Samples | 3 pro Case |
| Gesamtdauer | 181 s |

Cases: alle sieben Cases mit `judge`-Block, nämlich `TQ-SEM-001` und die sechs
`strategy-*`-Cases (13 Turns, 7 Judge-Cases).

G1 gilt weiterhin nur für die Judge-Prompt-Revision `-v1`. Dieser Lauf nutzt
`-v2`: Er hat 21 / 21 schema- und evidence-valide Judge-Antworten erzeugt
(Abschnitt 4), ersetzt aber keine G1-Messung, weil er keine reine
Judge-Repeatability über eingefrorene Transcripts misst.

## 2. Calls gegen Budget

Budget nach R-BUD-2, vor dem Lauf aus dem Callgraph berechnet:
`1 + 3 × 13 × 2 + 3 × 7 = 100`.

| Kategorie | Calls |
| --- | ---: |
| Model-List (1 Preflight + 39 Modellauflösungen) | 40 |
| Tutor-Generierung | 39 |
| Judge | 21 |
| **Gesamt** | **100 / 100** |

Die tatsächlichen Calls entsprechen exakt der Rechnung. Kein Sample lief in
`budget-exhausted`. Monetäre Kosten liefert der Provider nicht (`unavailable`).
Pro Case: `TQ-SEM-001` 9 Calls, jeder Strategy-Case 15 Calls.

## 3. Ausführung und deterministische Checks

| Kennzahl | Wert |
| --- | --- |
| Samples beobachtet / abgeschlossen | 21 / 21 |
| `invalid` | 0 |
| `technical-failure` | 0 |
| `not-run` | 0 |
| Samples mit Violations | 0 |
| inconclusive Judge-Status | 0 |

Es gibt keine Violation, weder aus dem Rohoutput (`raw-provider`) noch aus dem
finalen Tutor-Ergebnis oder dem Progression-State. Alle Rating-Bänder wurden
getroffen; kein `phaseAfter`-Check war „nicht anwendbar“.

### Strategy-Cases

`learningPhase` gilt für beide Turns. Die Follow-up-Provenance stammt aus
`TutorService` (R-FUP-1).

| Case | `learningPhase` (Turn 0 / 1) | Band | Ratings (3 Samples) | `phaseAfter` | Blocked | Follow-up |
| --- | --- | --- | --- | --- | --- | --- |
| `strategy-learn-weak-answer` | LEARN / LEARN | [1,2] | 2, 2, 2 | LEARN ×3 | keiner | `planner` |
| `strategy-learn-strong-answer` | LEARN / LEARN | [3,5] | 4, 5, 4 | DEEPEN ×3 | keiner | `planner` |
| `strategy-deepen-transfer` | DEEPEN / DEEPEN | [4,5] | 4, 4, 4 | EXPAND ×3 | keiner | `planner` |
| `strategy-deepen-correction` | DEEPEN / DEEPEN | [1,2] | 2, 2, 2 | DEEPEN ×3 | keiner | `planner` |
| `strategy-expand-proposal` | EXPAND / EXPAND | – | 3, 3, 2 | EXPAND ×3 | keiner | `planner` |
| `strategy-expand-observation` | EXPAND / EXPAND | – | 2, 2, 2 | EXPAND ×3 | keiner | `planner` |

`TQ-SEM-001` (freier Tutor): Ratings 4, 3, 4; Follow-up-Provenance `provider`.

## 4. Judge

**Schema- und Evidence-Validität:** 21 / 21 `evaluated`. Keine Antwort war
`judge-invalid`; alle Zitate lagen in genau einer erlaubten Quelle (R-EVD-4).
Alle Fail-Verdicts und Critical Issues trugen ein gültiges Zitat.

**Repeatability** über drei Samples: 16 von 21 Paaren (Case, Kriterium)
einstimmig, paarweise Übereinstimmung 53 / 63 (84 %). Diese Zahl mischt
Tutor- und Judge-Varianz, weil jedes Sample eine neue Tutor-Antwort bewertet.

| Case | Kriterium | Verdicts |
| --- | --- | --- |
| `TQ-SEM-001` | `accepts-correct-answer` | pass, **fail**, pass |
| `strategy-deepen-transfer` | `deepen-uses-transfer` | **fail**, pass, pass |
| `strategy-expand-observation` | `expand-observable-result` | **fail, fail, fail** |
| `strategy-expand-proposal` | `expand-targets-observation` | **fail**, pass, **fail** |
| `strategy-learn-strong-answer` | `learn-accepts-correct-answer` | pass, pass, **fail** |
| `strategy-learn-strong-answer` | `learn-feedback-grounds-sketch` | **fail, fail, fail** |
| `strategy-learn-weak-answer` | `learn-hint-first` | **fail**, pass, pass |

Alle übrigen 14 Kriterien: dreimal `pass`.

**Critical Issues** (jeweils 1 von 3 Samples):

| Case / Sample | Code |
| --- | --- |
| `TQ-SEM-001` / 1 | `correct-answer-rejected` |
| `strategy-deepen-transfer` / 0 | `correct-answer-rejected` |
| `strategy-learn-strong-answer` / 2 | `correct-answer-rejected` |
| `strategy-learn-weak-answer` / 0 | `complete-solution` |

## 5. Handdurchsicht und Zuordnung

Die Zuordnung trennt Tutor-Modell, Judge-Modell, Planner/Curriculum,
deterministisches Produktverhalten und Kriterien. Die Judge-Begründungen
stimmen in allen durchgesehenen Fällen mit dem zitierten Text überein; einen
Judge-Defekt habe ich nicht gefunden.

### F1 – Produkt: falscher didaktischer Kontext im EXPAND-Dialog (belegt)

In allen sechs EXPAND-Samples behandelt der Tutor den Erweiterungsvorschlag
der lernenden Person als Behauptung über den aktuellen Sketch („im aktuellen
Sketch wird `counter` nirgends erhöht“) und bewertet ihn mit 2 oder 3, obwohl
die Frage ausdrücklich nach einer *Erweiterung* fragt.

Ursache im Produkt, anhand der Transcripts verifiziert: Der Dialog-Prompt
erhält als „Validierter didaktischer Kontext“ den Plan der *nächsten* Frage
(`variable-output-transfer`, Ziel „Zusammenhang zwischen Integerwert und
Verwendung erklären“), nicht den der beantworteten Erweiterungsfrage
(`expand-serial-output`, Ziel „Eine weitere serielle Beobachtung am Sketch
ableiten“). `TutorService.generateDialogResponse` berechnet den Kontext über
`planInitial` mit dem aktuellen State. Nach dem Ausliefern der Erweiterung ist
deren Ziel bereits als benutzt markiert, deshalb plant `planInitial` eine
andere Frage. Bei LEARN und DEEPEN tritt das nicht auf, weil `planInitial`
dort dieselbe noch unbeantwortete Frage erneut plant.

Belegt ist der falsche Kontext. **Hypothese, nicht belegt:** Er ist die
Hauptursache für die niedrigen Ratings (2–3) in den EXPAND-Samples und für
`expand-observable-result` (3/3 fail) sowie `expand-targets-observation`
(2/3 fail). Bestätigen lässt sich das erst durch einen Nachlauf nach dem Fix. Da
die EXPAND-Cases kein `answerRating`-Band deklarieren, schlägt kein
deterministischer Check an.

Bezug: R-EXP-1 verlangt, dass eine generierte Erweiterungsfrage beim Antworten
als gültige EXPAND-Frage erkannt wird. PR A hat das für die Progression
umgesetzt, nicht für den Prompt-Kontext.

### F2 – Tutor-Modell: „Fast richtig“ bei korrekten Antworten

In drei Samples nennt der Tutor eine fachlich korrekte Antwort „Fast
richtig“, bei Ratings 3 oder 4: `TQ-SEM-001` / 1, `strategy-deepen-transfer` / 0,
`strategy-learn-strong-answer` / 2. Der Judge meldet jeweils
`correct-answer-rejected`. Das ist Varianz des Tutor-Modells.

`TQ-SEM-001`: Der Plan nennt ein „bekanntes stabiles
`accepts-correct-answer = fail`“. In dieser Baseline fällt das Kriterium nur in
1 von 3 Samples durch, und nur dort, wo das Feedback wörtlich „Fast richtig“
sagt. Die Antwort „an PIN2 muss GND anliegen“ beschreibt den gedrückten Taster
gegen GND korrekt. Ich ordne den Befund dem Tutor zu, nicht der
Kriterienauslegung.

### F3 – Corpus/Judge-Kriterium: `learn-feedback-grounds-sketch` ist überbestimmt

Das Kriterium verlangt, dass das Feedback die anfängliche Ausgabe 3 *und* die
spätere Erhöhung von `counter` nennt. Es fällt in 3 von 3 Samples durch.
Gefragt war „Welche Ausgabe erzeugt `Serial.println` im aktuellen Sketch?“;
die korrekte Antwort ist 3, die Erhöhung in `loop` wird nicht ausgegeben. Das
Feedback des Tutors ist kurz und korrekt, wie es die Strategie verlangt
(`feedbackVerbosity: short`). Das Kriterium fordert eine Wiederholung, die
weder die Frage noch die Strategie verlangen. Das ist ein Corpus-Defekt,
kein Tutor-Defekt.

### F4 – Tutor-Modell: Lösung vorweggenommen

`strategy-learn-weak-answer` / 0: Das Feedback nennt die Lösung direkt („…der
steht im Sketch zu Beginn auf 3“). Der Judge meldet `learn-hint-first = fail`
und `complete-solution`. Der deterministische Check
`raw-provider-no-complete-solution` schlägt nicht an, weil er vollständigen
Code erkennt, keine verbal genannte Einzelantwort. 1 von 3 Samples; Varianz des
Tutor-Modells.

### F5 – Planner/Curriculum: Rückfall auf die Basisfrage

Nach jeder EXPAND-Antwort und nach jeder DEEPEN-Antwort (mit und ohne
Übergang nach EXPAND) ist die Folgefrage `serial-output-prediction` („Welche
Ausgabe erzeugt `Serial.println` im aktuellen Sketch?“), in 12 von 12
EXPAND- und DEEPEN-Samples. Die
Anchor-Fixture hat nur drei Fragen; ohne Recall-Fragen bleibt nach der
Transferfrage nur diese Prediction-Frage. Didaktisch ist das ein Schritt
zurück, aber eine Folge der kleinen Fixture, kein Planner-Fehler. Kriterien zur
Folgefrage bewerten hier den Planner (R-CRT-4); der Judge hat
`expand-scaffolding` und `deepen-new-step` trotzdem durchgehend bestanden.

### Weitere Beobachtungen

- `strategy-deepen-transfer` / 0: Der Tutor liest die Antwort (eine
  vorgeschlagene zusätzliche Ausgabe) ebenfalls als Behauptung über den
  aktuellen Sketch. Hier ist der Kontext korrekt (Abschnitt F1 trifft nicht
  zu), es ist also Tutor-Varianz.
- `strategy-deepen-correction`: in allen drei Samples korrekt korrigiert und
  bewertet.

## 6. Einschätzung vor PR F

Vor PR F sind zwei kleine eigene Korrektur-PRs erforderlich:

1. **Produkt (F1):** Im Dialog-Turn auf eine generierte EXPAND-Frage muss der
   Prompt-Kontext das Erweiterungsziel der beantworteten Frage enthalten. TDD
   mit Fake-Provider; keine Corpus-Änderung.
2. **Corpus (F3):** `learn-feedback-grounds-sketch` auf das beschränken, was
   die Frage verlangt (zum Beispiel „Das Feedback nennt die tatsächliche
   Ausgabe 3 korrekt.“); `corpusVersion` erhöhen (R-COR-1).

Danach sollten die betroffenen Cases erneut real laufen (`strategy-expand-*`
und `strategy-learn-strong-answer`), mit einem vorab nach R-BUD-2 berechneten
Budget. Erst diese Daten sind eine saubere Grundlage für die Verdict-Regel,
weil sonst ein Produkt- und ein Corpus-Defekt als Tutor-Qualität gezählt
würden.

F2, F4 und F5 brauchen keinen Fix vor PR F: F2 und F4 sind Varianz des
Tutor-Modells, die die Verdict-Regel als `warn` erfassen soll; F5 ist eine
Grenze der Fixture.

## 7. Datengrundlage für die Verdict-Regel

| Klasse | Beobachtung in dieser Baseline |
| --- | --- |
| deterministische App-Violations | 0 in 21 Samples |
| Rating außerhalb des Bands | 0 in 12 Samples mit Band |
| Kriterium 3/3 fail | 2 Paare (`expand-observable-result`, `learn-feedback-grounds-sketch`), beide auf F1 bzw. F3 zurückführbar |
| Kriterium 2/3 fail | 1 Paar (`expand-targets-observation`), wahrscheinlich F1 |
| Kriterium 1/3 fail | 4 Paare, Tutor-Varianz |
| Critical Issue | 4 Vorkommen, jeweils 1/3 und in verschiedenen Cases |
| inconclusive | 0 |

## 8. Empfehlung für PR F (nicht normativ)

Die Verdict-Regel wird mit diesem Bericht nicht normativ festgelegt (R-VER-3);
das geschieht erst in PR F in der SSOT §12.

Die Kandidatenregel aus dem Plan passt zu diesen Daten:

- `fail`: eine App-eigene deterministische Violation (`final-tutor` außer
  Rating, `state`, `scenario`) in mindestens einem Sample; oder dasselbe
  Kriterium `fail`, dasselbe Critical Issue oder ein Rating außerhalb des Bands
  in mindestens 2 von 3 Samples eines Cases.
- `warn`: dieselben LLM-abhängigen Befunde in genau 1 von 3 Samples.
- `inconclusive`: technische Fehler, `invalid` oder Judge-Status außer
  `evaluated`, sobald sie ein Urteil verhindern.
- sonst `pass`.

Angewandt auf diese Baseline ergäbe die Regel `fail`, getragen von den zwei
3/3-Paaren und dem 2/3-Paar. Nach den Fixes F1 und F3 wäre ohne neue Daten
`warn` zu erwarten (vier 1/3-Befunde und vier einzelne Critical Issues). Das
spricht dafür, die Regel erst nach dem Nachlauf festzuschreiben (R-VER-3), und
dafür, Critical Issues pro Code und Case zu zählen, nicht summiert über Cases.

## 9. Abgrenzung

- Keine Verdict-Regel als Code; keine Arbeiten aus PR F oder G.
- Rohartefakte (`report.json`, `report.md`, Transcripts) bleiben lokal.
- Credentials wurden nur über `UNOSIM_TUTOR_EVAL_CREDENTIAL` und
  `UNOSIM_TUTOR_JUDGE_CREDENTIAL` übergeben; Artefakte und CLI-Ausgabe
  enthalten keine Credential-Werte (geprüft).
