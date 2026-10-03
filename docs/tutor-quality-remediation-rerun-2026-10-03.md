# Tutor Quality – Remediation-Nachlauf F1/F3 (L3)

Status: Auswertung des Nachlaufs zu den Befunden F1 und F3 aus
`docs/tutor-quality-baseline-2026-10-03.md` (im Folgenden „Baseline“). Die
Baseline bleibt als historische Referenz unverändert. Normativ ist
`ssot/ssot_function_definition_TutorQualityEvaluation.md` (im Folgenden
„SSOT“, Regeln als `R-…`). Dieser Bericht legt keine Verdict-Regel fest;
Abschnitt 7 ist Datengrundlage für PR F.

Rohartefakte (`report.json`, `report.md`, Transcripts) liegen nur lokal unter
`.tutor-quality-output/rerun-f1-f3-2026-10-03/` und werden nicht committet.

## 1. Lauf und Provenance

| Merkmal | Wert |
| --- | --- |
| Run-ID | `tq2a-20261003T103256951Z-cc6579a3-5e1f-464e-99db-2c4feb1561f6` |
| Run-Status | `completed` |
| Git | `main` @ `cdd7493d` (nach PR #135 / F1 und PR #136 / F3), saubere relevante Git-Lage (R-ID-3) |
| Corpus | `unosim-tutor-quality-anchor` v6, Datei-Digest `17a326bf…` |
| Tutor-Modell | requested `openai-gpt5.4-mini` → returned `gpt-5.4-mini-2026-03-17` (eine einheitliche ID) |
| Judge-Modell | requested `openai-gpt5.5` → returned `gpt-5.5-2026-04-24` (eine einheitliche ID) |
| Tutor-Prompt | `tutor-prompts-v1`, Template-Digest `7df4aa25…` (wie Baseline) |
| Judge-Prompt | `tutor-quality-minimal-criteria-v2` (wie Baseline; G1 gilt weiterhin nur für `-v1`) |
| Temperaturen | Tutor 0.2, Judge 0 |
| Samples | 3 pro Case |
| Gesamtdauer | 74 s |

Cases: `strategy-expand-proposal`, `strategy-expand-observation`,
`strategy-learn-strong-answer` (6 Turns, 3 Judge-Cases).

## 2. Calls gegen Budget

Budget nach R-BUD-2, unmittelbar vor dem Lauf gegen den Callgraph auf
`cdd7493d` geprüft (pro Turn eine Modellauflösung und eine Generierung; die
F1-Kontextauflösung `planAnsweredQuestion` ruft keinen Provider auf):
`1 + 3 × 6 × 2 + 3 × 3 = 46`.

| Kategorie | Calls |
| --- | ---: |
| Model-List (1 Preflight + 18 Modellauflösungen) | 19 |
| Tutor-Generierung | 18 |
| Judge | 9 |
| **Gesamt** | **46 / 46** |

Kein `budget-exhausted`. Monetäre Kosten: `unavailable`. Real-Provider-Calls
insgesamt seit Beginn der Serie: 100 (Baseline) + 46 = 146.

## 3. Technische Validität und deterministische Checks

| Kennzahl | Wert |
| --- | --- |
| Samples beobachtet / abgeschlossen | 9 / 9 |
| `invalid` / `technical-failure` / `not-run` | 0 / 0 / 0 |
| Judge `evaluated` | 9 / 9 |
| App-eigene Violations (`final-tutor` außer Rating, `state`, `scenario`) | 0 |
| `raw-provider`-Violations | 0 |
| Rating außerhalb des Bands | 1 (`strategy-learn-strong-answer` / 2: Rating 2, Band [3,5]) |

Für das Sample mit Rating 2 ist `expected-phase-after` korrekt „nicht
anwendbar“ (R-RAT-5); der State bleibt in LEARN, wie es die Progression bei
Rating 2 verlangt. Credential-Werte kommen in keinem Artefakt vor (geprüft).

| Case | `learningPhase` (Turn 0 / 1) | Band | Ratings | `phaseAfter` | Blocked | Follow-up |
| --- | --- | --- | --- | --- | --- | --- |
| `strategy-expand-proposal` | EXPAND / EXPAND | – | 4, 4, 4 | EXPAND ×3 | keiner | `planner` |
| `strategy-expand-observation` | EXPAND / EXPAND | – | 2, 2, 3 | EXPAND ×3 | keiner | `planner` |
| `strategy-learn-strong-answer` | LEARN / LEARN | [3,5] | 3, 4, **2** | DEEPEN, DEEPEN, LEARN (n/a) | keiner | `planner` |

## 4. Judge

Alle 9 Antworten sind schema-valide. Jedes Zitat wurde zusätzlich unabhängig
gegen die drei erlaubten Quellen geprüft (NFKC, Whitespace-Kollaps, genau eine
Quelle; R-EVD-4): keine Grenzüberschreitung, kein Zitat aus nicht zitierbaren
Feldern. Die Begründungen passen in allen Fällen zum zitierten Text.

| Case | Kriterium | Baseline (v5) | Nachlauf (v6) |
| --- | --- | --- | --- |
| `strategy-expand-proposal` | `expand-targets-observation` | fail, pass, fail | pass, pass, pass |
| `strategy-expand-proposal` | `expand-keeps-learner-idea` | pass ×3 | pass ×3 |
| `strategy-expand-proposal` | `expand-no-replacement-code` | pass ×3 | pass ×3 |
| `strategy-expand-observation` | `expand-observable-result` | fail ×3 | **fail ×3** |
| `strategy-expand-observation` | `expand-sketch-grounding` | pass ×3 | pass ×3 |
| `strategy-expand-observation` | `expand-scaffolding` | pass ×3 | pass ×3 |
| `strategy-learn-strong-answer` | `learn-accepts-correct-answer` | pass, pass, fail | **fail**, pass, **fail** |
| `strategy-learn-strong-answer` | `learn-feedback-grounds-sketch` | fail ×3 (alter Text) | **fail ×3** (neuer Text) |
| `strategy-learn-strong-answer` | `learn-next-step` | pass ×3 | pass ×3 |

Critical Issues: `correct-answer-rejected` in `strategy-learn-strong-answer`
/ 0 und / 2 (Baseline: / 2). In den EXPAND-Cases keine.

Repeatability über drei Samples: 8 von 9 Paaren (Case, Kriterium) einstimmig,
paarweise Übereinstimmung 25 / 27. Wie in der Baseline mischt das Tutor- und
Judge-Varianz.

## 5. F1 – EXPAND-Dialogkontext

**Technisch behoben.** Der Dialog-Prompt beider EXPAND-Cases enthält als
„Validierter didaktischer Kontext“ jetzt die beantwortete Erweiterungsfrage
(`expand-serial-output`, Ziel „Eine weitere serielle Beobachtung am Sketch
ableiten.“, mit `expansionBrief`) statt des Plans der nächsten Frage. Das ist
die einzige Differenz zum Baseline-Prompt dieses Turns; Turn 0 ist
byte-identisch.

| | `strategy-expand-proposal` | `strategy-expand-observation` |
| --- | --- | --- |
| Ratings Baseline → Nachlauf | 3, 3, 2 → 4, 4, 4 | 2, 2, 2 → 2, 2, 3 |
| Hauptkriterium Baseline → Nachlauf | `expand-targets-observation` 2/3 fail → 0/3 | `expand-observable-result` 3/3 fail → 3/3 |
| Feedback liest Vorschlag als Behauptung über den aktuellen Sketch | 3/3 → 1/3 | 3/3 → 3/3 |

Im Proposal-Case greift das Feedback die Idee jetzt als Erweiterung auf („Gut
erkannt: Du beschreibst eine beobachtbare Änderung …“). Im Observation-Case
antwortet der Tutor weiterhin nach dem Muster „Das ist inhaltlich passend, aber
der Sketch erhöht `counter` in `loop()` nicht.“ und bewertet mit 2 bis 3,
obwohl die Antwort („Wenn ich `counter` in `loop` erhöhe, sollten … steigende
Werte erscheinen“) eine korrekte Erweiterung mit beobachtbarer Wirkung ist. Das
Judge-Urteil `expand-observable-result = fail` ist in allen drei Samples durch
das Zitat gedeckt.

**Bewertung der Hypothese:** *teilweise bestätigt.* Der falsche Kontext war
eine wesentliche Ursache im Proposal-Case. Im Observation-Case erklärt er die
niedrigen Ratings und den Judge-Fail nicht: Mit korrektem Kontext bleibt das
Verhalten unverändert (6 / 6 Samples über beide Läufe). Die verbleibende
Ursache liegt im Tutor-Verhalten (Modell plus Dialog-Prompt, der keine
eigene Bewertungshilfe für Erweiterungsvorschläge enthält), nicht in Planner,
Progression oder Messung. Das ist ein reproduzierbarer Qualitätsbefund, kein
Mess- oder Produktdefekt.

## 6. F3 – `learn-feedback-grounds-sketch`

Der Kriterientext verlangt seit v6 nur noch, dass das Feedback die tatsächliche
Ausgabe (3 aus `setup`) konkret benennt und keine weitere Ausgabe in `loop`
behauptet; die frühere Forderung, auch die Erhöhung in `loop` zu nennen, ist
entfallen.

Die Tutor-Prompts dieses Cases sind in beiden Turns **byte-identisch** zur
Baseline (gleiche Digests, gleicher System-Prompt). Unterschiede zwischen den
Läufen sind hier also reine Varianz des Tutor-Modells.

| Sample | Rating | Feedback (gekürzt) | `grounds-sketch` | `accepts-correct` |
| --- | --- | --- | --- | --- |
| 0 | 3 | „Fast richtig: … `counter` zu Beginn den Wert 3 … Entscheidend ist noch, wann `Serial.println(counter)` ausgeführt wird.“ | fail | fail |
| 1 | 4 | „Richtig: Der Startwert von counter ist 3, und loop verändert diesen Wert erst danach.“ | fail | pass |
| 2 | 2 | „Teilweise richtig: … aber `loop` verändert die Ausgabe von `Serial.println(counter)` nicht mehr.“ | fail | fail |

Bewertung:

- **Kein Gefälligkeits-Pass.** Das neue Kriterium fällt 3 / 3 durch. In zwei
  Samples ist das Feedback tatsächlich fachlich schwach (korrekte Antwort als
  „fast“ bzw. „teilweise richtig“ eingestuft, Ausgabe nicht benannt). Sample 1
  bestätigt die Antwort, nennt aber nur den Startwert, nicht die Ausgabe; das
  Urteil ist streng, aber durch den Kriterientext gedeckt.
- **Trennschärfe.** Das Baseline-Feedback von Sample 0 („`Serial.println(counter);`
  gibt den aktuellen Wert von `counter` aus, also beim Start 3“) hätte den neuen
  Text erfüllt (Handprüfung, kein Re-Judge). Das Kriterium unterscheidet also
  geerdetes von ungeerdetem Feedback.
- **Kein neuer Corpus- oder Judge-Defekt.** Der Rest-Anteil an Strenge
  (Sample 1) bleibt beobachtenswert, rechtfertigt aber keine erneute
  Kriterienänderung.

Ein Nebenbefund zur Fixture: Die synthetische Antwort „setup gibt **zuerst** 3
aus; loop erhöht counter **danach** …“ lässt eine Lesart zu, nach der weitere
Ausgaben folgen. Der Tutor reagiert darauf in Sample 2 mit einer Korrektur
(„`loop` verändert die Ausgabe … nicht mehr“). Die Antwort ist fachlich
korrekt; Judge-Facts und Kriterium sind eindeutig. Die Einstufung als
„Teilweise richtig“ bleibt ein Tutor-Defizit (wie F2 der Baseline), das Wort
„zuerst“ verstärkt es vermutlich. Kein Fix vor PR F.

## 7. Zuordnung und Datengrundlage für PR F

| Befund | Klasse | Baseline | Nachlauf |
| --- | --- | --- | --- |
| falscher EXPAND-Dialogkontext (F1) | Produkt, behoben | belegt | nicht mehr vorhanden |
| überbestimmtes Kriterium (F3, alter Text) | Corpus, behoben | 3/3 fail | – |
| Erweiterungsvorschlag als Sketch-Behauptung gelesen (Observation) | Tutor, stabil | 3/3 | 3/3 |
| korrekte LEARN-Antwort nicht voll anerkannt (`correct-answer-rejected`) | Tutor-Varianz bei identischem Input | 1/3 | 2/3 |
| `learn-feedback-grounds-sketch` (neuer Text) | Tutor, teils Kriterienstrenge | – | 3/3 |
| Rating außerhalb des Bands | Tutor-Varianz | 0/3 | 1/3 |
| Rückfall auf die Basisfrage als Folgefrage (F5) | Fixture-Grenze | 6/6 EXPAND | 6/6 EXPAND |
| Judge | – | kein Defekt | kein Defekt |

Folgerungen für die Verdict-Regel:

1. **Identischer Input, verschiedene Häufigkeit.** Derselbe LEARN-Case mit
   byte-identischen Prompts zeigt `correct-answer-rejected` einmal in 1 / 3 und
   einmal in 2 / 3 Samples (zusammen 3 / 6). Ein Befund mit einer echten Rate
   um 50 % liegt bei drei Samples an jeder Mehrheitsschwelle; das ist
   Messunsicherheit von n = 3, kein Fehler der Regel.
2. **Stabile Befunde sind stabil.** `expand-observable-result` fällt in 6 / 6
   Samples beider Läufe durch. Eine Mehrheitsregel pro (Case, Befund) erfasst
   das deterministisch.
3. **Kein Zusammenzählen über Cases.** Die Baseline hatte vier
   `correct-answer-rejected`- bzw. `complete-solution`-Vorkommen in vier
   verschiedenen Cases, jeweils 1 / 3. Summiert wäre das ein `fail`, obwohl
   jeder Case für sich unauffällig ist. Gezählt werden muss pro Case und
   Befundschlüssel.
4. **Deterministische App-Violations** traten in 30 Samples beider Läufe nicht
   auf; die einzige Violation war eine Rating-Abweichung (LLM-Befund).
5. **Inconclusive** trat nicht auf; die Regel muss es trotzdem eindeutig
   behandeln.

Mit der Kandidatenregel des Plans (Mehrheit ≥ 2 / 3 pro Case und Befund ⇒
`fail`, 1 / 3 ⇒ `warn`) ergäbe dieser Nachlauf `fail`, getragen von
`expand-observable-result` (3 / 3), `learn-feedback-grounds-sketch` (3 / 3),
`learn-accepts-correct-answer` (2 / 3) und `correct-answer-rejected` (2 / 3).
Das sind reale Tutor-Befunde, keine Mess- oder Produktartefakte mehr.

## 8. Schlussfolgerung

Kein Blocker für PR F: Der Lauf ist technisch vollständig valide, der Judge
liefert valide und nachvollziehbare Urteile, es gibt keine App-Violation, F1
ist im Prompt nachweislich behoben und F3 hat keinen neuen Defekt erzeugt. Die
verbleibenden Fails sind echte Tutor-Befunde (Erweiterungsvorschläge im
Observation-Case, unvollständige Anerkennung korrekter LEARN-Antworten). Sie
sind Gegenstand späterer Tutor-Arbeit, nicht der Verdict-Regel.
