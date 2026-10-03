# Tutor Quality – L3-Lauf Antwortbewertungsrahmen (Prompt v3)

Status: Auswertung, **nicht normativ**. Prüft die in
`docs/tutor-quality-answer-evaluation-analysis-2026-10-03.md` §7 vorab
festgelegten Hypothesen H1–H5 für den Stack #141 (Prompt v2) und #142
(Prompt v3). Normativ sind `ssot/ssot_function_definition_TutorQualityEvaluation.md`
und `ssot/ssot_function_definition_LearningQuestions.md`. Rohartefakte liegen
nur lokal und werden nicht committet.

## 1. Lauf und Provenance

| Merkmal | Wert |
| --- | --- |
| Run-ID | `tq2a-20261003T134339231Z-8151d04a-1657-41fc-b2d6-d64b0c00b7fb` |
| Git | Head von #142, `4f99d548`, sauberer separater Worktree (R-ID-3) |
| Corpus | `unosim-tutor-quality-anchor` v7, 18 Cases, 26 Turns, 8 mit Judge |
| Tutor-Prompt | `tutor-prompts-v3`, Template-Digest `a18e59d2…` (enthält #141 und #142) |
| Judge-Prompt | `tutor-quality-minimal-criteria-v2` (unverändert) |
| Tutor-Modell | requested `openai-gpt5.4-mini` → returned `gpt-5.4-mini-2026-03-17` (eine ID) |
| Judge-Modell | requested `openai-gpt5.5` → returned `gpt-5.5-2026-04-24` (eine ID) |
| Temperaturen | Tutor 0,2, Judge 0 |
| Samples | 5 pro Case |
| Dauer | 361 s |

## 2. Calls und technische Validität

Budget vor dem Lauf auf dem ausgecheckten Head aus dem Callgraph geprüft:
`1 + 5 × (50 + 8) = 291` (25 Turns mit je Modellauflösung und Generierung,
`off-topic-answer` lokal ohne Call).

| Kategorie | Calls |
| --- | ---: |
| Model-List (1 Preflight + 125 Auflösungen) | 126 |
| Tutor-Generierung | 125 |
| Judge | 40 |
| **Gesamt** | **291 / 291** |

90 / 90 Samples `completed`; 0 `invalid`, 0 `technical-failure`; 40 / 40 Judge
`evaluated`; **0 Violations** (weder `raw-provider` noch `final-tutor` noch
`state`). Keine Credential-Werte in den Artefakten (geprüft). Provider-Calls der
Serie insgesamt: 146 + 291 = 437.

## 3. `qualityVerdict`

**`fail`** (`tutor-quality-verdict-v1`, n = 5, k = 3, Judge konfiguriert).

| Effekt | Case | Schlüssel | Samples |
| --- | --- | --- | --- |
| fail | `strategy-expand-observation` | `criterion/expand-observable-result` | 5 / 5 |
| fail | `strategy-learn-strong-answer` | `criterion/learn-accepts-correct-answer` | 4 / 5 |
| fail | `strategy-learn-strong-answer` | `critical-issue/correct-answer-rejected` | 4 / 5 |
| fail | `strategy-learn-weak-answer` | `criterion/learn-hint-first` | 3 / 5 |
| warn | `strategy-learn-strong-answer` | `criterion/learn-feedback-grounds-sketch` | 2 / 5 |
| warn | `strategy-learn-weak-answer` | `criterion/learn-detects-weak-answer` | 1 / 5 |
| warn | `strategy-learn-weak-answer` | `critical-issue/complete-solution` | 1 / 5 |
| warn | `strategy-expand-observation` | `criterion/expand-sketch-grounding` | 1 / 5 |
| warn | `strategy-deepen-correction` | `criterion/deepen-explains-evidence` | 1 / 5 |
| warn | `TQ-SEM-001` | `criterion/distinct-followup` | 1 / 5 |

Alle Judge-Begründungen wurden gegen das zitierte Feedback von Hand geprüft;
sie sind durch die Zitate gedeckt.

## 4. Vergleich mit den Läufen unter Prompt v1

Baseline = 2026-10-03 (Corpus v5, n = 3), Nachlauf = Remediation-Nachlauf
(Corpus v6, n = 3). Die Läufe haben unterschiedliche Sample-Zahlen; Anteile
sind nur grob vergleichbar. Eine zeitgleiche v1-Kontrolle mit n = 5 fehlt (§9).

| Case | Ratings Baseline | Ratings Nachlauf | Ratings v3 | Hauptkriterium Baseline → Nachlauf → v3 |
| --- | --- | --- | --- | --- |
| `strategy-expand-observation` | 2, 2, 2 | 2, 2, 3 | 3, 4, 4, 3, 3 | `expand-observable-result` 3/3 → 3/3 → **5/5** |
| `strategy-expand-proposal` | 3, 3, 2 | 4, 4, 4 | 4, 4, 4, 4, 3 | `expand-targets-observation` 2/3 → 0/3 → 0/5 |
| `strategy-deepen-transfer` | 4, 4, 4 | – | 5, 5, 4, 4, 4 | `deepen-uses-transfer` 1/3 → – → 0/5; `correct-answer-rejected` 1/3 → 0/5 |
| `strategy-learn-strong-answer` | 4, 5, 4 | 3, 4, 2 | 5, 3, 3, 4, 3 | `correct-answer-rejected` 1/3 → 2/3 → **4/5** |
| `TQ-SEM-001` | 4, 3, 4 | – | 5, 4, 5, 2, 2 | `accepts-correct-answer` 1/3 → – → 0/5 (Judge), siehe H2 |
| `strategy-learn-weak-answer` | 2, 2, 2 | – | 2 ×5 | `learn-hint-first` 1/3 → – → **3/5** |
| `strategy-deepen-correction` | 2, 2, 2 | – | 2 ×5 | `deepen-corrects-misconception` 0/3 → 0/5 |
| `strategy-expand-wrong-effect` | neu | neu | 2 ×5 | alle Kriterien 0/5 fail |

## 5. Hypothesen (Schwellen aus der Analyse §7, unverändert angewandt)

### H1 – Vorschlag als Vorschlag behandeln: **widerlegt** (für diese Lösung)

Schwelle: `expand-observable-result` ≤ 1/5. Ergebnis: **5/5 fail**.

Handprüfung pro Sample:

| Case | s0 | s1 | s2 | s3 | s4 |
| --- | --- | --- | --- | --- | --- |
| Observation: Vorschlag als plausibel erkannt | ja | ja | ja | ja | ja |
| Observation: Ist-Zustand als „aber“-Einschub | ja | nein | ja | ja | ja |
| Observation: erwartete Beobachtung konkret benannt (steigende Werte) | nein | nein | nein | nein | nein |
| Proposal: Ist-Zustand als „aber“-Einschub | nein | nein | nein | nein | ja |
| DEEPEN-Transfer: „Richtig“ ohne Abwertung | ja | ja | ja (mit „allerdings“) | ja (mit „Beachte nur“) | ja (mit „aber“) |

Teilwirkung, aber nicht die geforderte: Die Vorschläge werden jetzt als
plausibel anerkannt und höher bewertet (Observation Mittel 2,2 → 3,4;
DEEPEN-Transfer 4,0 → 4,4). Der Ist-Zustand-Einschub sinkt von 13 / 15 auf
8 / 15 Vorschlagsantworten und steht jetzt nach der Anerkennung statt als
Ablehnung. Die vorregistrierte Eigenschaft – das Feedback benennt die konkrete
prüfbare Wirkung des Vorschlags – tritt in keinem Sample auf. Das Feedback
paraphrasiert abstrakt („Du nennst … das erwartete Beobachtungsmuster“),
obwohl v3 ausdrücklich verlangt, eine richtige Antwort „konkret … an der
erwarteten Beobachtung“ zu bestätigen.

### H2 – richtige Antworten anerkennen: **widerlegt**

Schwellen: `correct-answer-rejected` ≤ 1/5 → **4/5**; `learn-accepts-correct-answer`
≤ 1/5 → **4/5**; Rating im Band 5/5 → **erfüllt** (5, 3, 3, 4, 3).

Sprache: „Fast richtig“ in 4/5 (`strategy-learn-strong-answer`) und 3/5
(`TQ-SEM-001`), obwohl v3 genau diese Einordnung ausdrücklich ausschließt. In
`TQ-SEM-001` erhalten zwei Samples Rating 2 für die richtige Antwort (Baseline:
4, 3, 4); der Judge markiert sie nicht, weil das Rating nicht zitierbar ist
(R-EVD-2). Handprüfung: in diesem Case also eher schlechter als die Baseline.

Beobachtung zum Mechanismus: Die Einordnung passt jetzt durchgehend zum Rating
(„Richtig“ bei 5, „Fast richtig“ bei 2–4). Die v3-Regel „Einordnung passt zur
answerRating“ wird befolgt. Der Dissens liegt im **Urteil über
Vollständigkeit**: Das Modell hält die Antwort mit Zusatzaussage
(„… loop erhöht counter danach“) bzw. auf Signal-Ebene („an PIN2 muss GND
anliegen“) für unvollständig. Die Regeln „zusätzliche zutreffende Aussagen“
und „gleichwertige Beschreibung auf einer anderen Ebene senken die Bewertung
nicht“ ändern dieses Urteil bei diesem Modell nicht messbar.

Über die sieben bisherigen Judge-Cases tragen 9/35 Feedbacks einen
relativierenden Einstieg (Baseline 8/21). Ein Priming-Effekt durch das wörtlich
zitierte „fast“ ist denkbar, aber durch diese Daten nicht belegt.

### H3 – konkretes Grounding: **bestätigt (knapp), Handprüfung: teilweise**

Schwelle: `learn-feedback-grounds-sketch` ≤ 2/5 → **2/5**. Handprüfung: s0, s2,
s3 nennen die tatsächliche Ausgabe 3 von `Serial.println(counter)`; s1 nennt
nur den Wert von `counter` (Judge-Fail streng, aber gedeckt); s4 nennt keinen
Wert. Keine erfundene Ausgabe in `loop`. Die Verbesserung gegenüber dem
Nachlauf (3/3 fail) ist echt, tritt aber zusammen mit „Fast richtig“ auf.

### H4 – keine Nachgiebigkeit: **Bänder erfüllt, Korrekturkriterium nicht**

| Negativkontrolle | Ratings | Band [1, 2] | Kriterien |
| --- | --- | --- | --- |
| `strategy-learn-weak-answer` | 2, 2, 2, 2, 2 | 5/5 | `learn-hint-first` **3/5 fail**, `learn-detects-weak-answer` 1/5, `complete-solution` 1/5 |
| `strategy-deepen-correction` | 2, 2, 2, 2, 2 | 5/5 | `deepen-explains-evidence` 1/5 |
| `strategy-expand-wrong-effect` | 2, 2, 2, 2, 2 | 5/5 | alle 0/5 fail |

Die Ratings zeigen keine Nachgiebigkeit. `strategy-expand-wrong-effect`
behandelt die Antwort als Änderung und korrigiert genau die falsche Wirkung
(„`delay(500)` ändert nur das Timing der Ausgaben“, „`counter` bleibt 3“);
mehrere Samples rahmen das allerdings wieder als „passt nicht zum aktuellen
Sketch“.

Sprachlich zu positiv: Die falsche Antwort „immer 99“ beginnt in 2/5 Samples
mit „Fast“ (Baseline 0/3). `learn-hint-first` scheitert in 3/5 (Baseline 1/3):
Zweimal lenkt der Hinweis nur auf die Verwendung statt auch auf die
Initialisierung von `counter`, einmal nennt das Feedback die Lösung 3.

Die Analyse §7 hat H4 als „Korrekturkriterien ≤ 1/5 fail“ vorregistriert und ein
Korrekturkriterium ≥ 3/5 als Merge-Stopp. `learn-hint-first` ist das
Korrekturkriterium dieser Negativkontrolle. **H4 ist damit nach der eigenen
Vorregistrierung nicht erfüllt.**

### H5 – keine Produktregression: **bestätigt**

0 Produkt- oder State-Violations; `learn-to-deepen` 5/5 im Band [3, 5].

## 6. Übriger Corpus

Für die zehn Cases ohne Judge ist das die erste reale Beobachtung; Regressionen
gegen frühere Läufe sind dort nicht bestimmbar.

- Falsche und unvollständige Antworten bleiben niedrig:
  `incorrect-answer-remediation` 2, 1, 1, 1, 1; `partial-answer-follow-up`
  2, 2, 1, 2, 2. Keine Ratingsteigerung bei falschen Antworten.
- `strong-answer-progression` 5/5 mit „Richtig: …“ ohne Relativierung.
- `TQ-REG-001` (bewusst vage Frage): Ratings 3, 4, 4, 4, 2; zweimal
  „Teilweise/Fast richtig … aber die Frage zielte auf …“. Das passt zur Regel
  „Miss die Antwort an dem, was die Frage verlangt“, ist ohne v1-Daten aber
  nicht als Änderung zu werten.
- Keine Raw-Provider-Violation, kein zusätzliches `complete-solution` außer dem
  einen Fall in `strategy-learn-weak-answer`.
- Folgefragen nach DEEPEN/EXPAND bleiben planner-eigen die Basisfrage („Welche
  Ausgabe erzeugt Serial.println im aktuellen Sketch?“), 25/25 – die bekannte
  Fixture-Grenze (P6). Sie fragt nach einem Vorschlag wieder den Ist-Zustand ab
  und arbeitet damit gegen jede Feedback-Verbesserung in EXPAND.

## 7. Zuordnung #141 (v2) und #142 (v3)

Der Lauf misst beide Änderungen zusammen; eine kausale Trennung gibt er nicht her.

- Plausibel aus #142: höhere Ratings und „plausibel“-Anerkennung der Vorschläge
  (die v3-Regeln adressieren genau diese Antwortart); die Kopplung von
  Einordnung und Rating.
- Plausibel aus #141: keine beobachtbare Wirkung. Die erhoffte Abnahme des
  „… aber“-Hinweises nach richtigen Antworten zeigt sich in LEARN und im
  freien Tutor nicht.
- Nicht zuordenbar: die Verschlechterung von `learn-hint-first`. Beide PRs
  ändern genau diesen Bereich: #141 den Remediation-Text für schwache Antworten,
  #142 „Benenne einen Fehler präzise, ohne die vollständige richtige Antwort
  vorwegzunehmen“ und „Gib einen Hinweis … nur, wenn …“.

## 8. Bewertung

- **#142 in der jetzigen Form nicht zur Merge-Freigabe empfohlen.** H1 und H2
  sind nach den vorab festgelegten Schwellen widerlegt, H4 ist am
  Korrekturkriterium verfehlt. Positiv und nachweisbar: Die Ratings für
  richtige Vorschläge steigen, die Negativkontrollen bleiben im Band.
- **Die Architekturannahme ist nur zur Hälfte bestätigt.** Der fehlende
  Bewertungsmaßstab erklärt die niedrigen Ratings für Vorschläge – sie ändern
  sich mit dem Maßstab. Die vom Judge geforderten Feedback-Eigenschaften
  (konkrete Wirkung benennen, richtige Antwort nicht relativieren) folgen
  ausdrücklichen Promptregeln bei diesem Modell und kurzem Feedback aber nicht.
  Weiteres Prompt-Tuning ist deshalb nicht der nächste Schritt.
- **#141:** Der Provenance-Commit (R-ID-2, gerenderte Prompts byte-identisch)
  ist eigenständig begründet und unabhängig von L3 sinnvoll. Der
  Guidance-Commit ändert Prompttext; für ihn liegt keine eigene L3-Messung vor
  (Evaluation-SSOT §13), und die `learn-hint-first`-Verschlechterung liegt in
  seinem Wirkungsbereich. Ein v2-only-Lauf wäre nötig, um ihn mit Daten zu
  mergen.

## 9. Fehlende v1-Kontrolle

Eine zeitgleiche Kontrolle mit Prompt v1 (Corpus v7, n = 5, gleiche Modelle)
liegt nicht vor. Der dafür vorgesehene Wochenlauf auf `main` findet nicht statt:
Das Repository hat keine Provider-Secrets, und der `schedule` wird deshalb
deaktiviert (#144); L3 läuft lokal vor relevanten Tutor-Änderungen. Eine
v1-Kontrolle wäre ein eigener, freizugebender lokaler Lauf.

Sie würde zusätzlich zeigen:

- ob die v3-Unterschiede bei gleichem n = 5 bestehen bleiben (insbesondere
  Ratings für Vorschläge, `learn-hint-first`, „Fast richtig“ bei
  `TQ-SEM-001`);
- wie sich die Negativkontrolle `strategy-expand-wrong-effect` unter Prompt v1
  verhält;
- wie die zehn Cases ohne Judge unter v1 abschneiden, damit §6 Regressionen
  von Grundverhalten trennen kann.

## 10. Einschränkungen

- Ein Lauf, n = 5 pro Case; Befunde mit wahrer Rate um 0,5 bleiben unscharf.
- Vergleichsläufe unter v1 haben n = 3 und andere Corpus-Versionen.
- Die Fehlinterpretations-Zählung (Ist-Zustand-Einschub) ist eine Handkodierung
  durch den Autor dieses Berichts, nicht Judge-validiert.
