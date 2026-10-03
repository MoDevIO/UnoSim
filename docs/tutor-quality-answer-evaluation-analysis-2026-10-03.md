# Tutor Quality – Ursachenanalyse Antwortbewertung und L3-Nachlaufplan

Status: Analyse und Arbeitsplan, **nicht normativ**. Normativ sind
`ssot/ssot_function_definition_TutorQualityEvaluation.md` (Regeln `R-…`) und
`ssot/ssot_function_definition_LearningQuestions.md`. Datengrundlage sind die
beiden realen Läufe vom 2026-10-03:
`docs/tutor-quality-baseline-2026-10-03.md` (im Folgenden „Baseline“, Corpus
v5) und `docs/tutor-quality-remediation-rerun-2026-10-03.md` („Nachlauf“,
Corpus v6), jeweils `openai-gpt5.4-mini` als Tutor, `openai-gpt5.5` als Judge,
3 Samples pro Case, Prompt-Revision `tutor-prompts-v1`. Ein geplanter
Wochenlauf existierte bei Abschluss dieser Analyse noch nicht.

Die Analyse stützt sich auf die vollständigen lokalen Transcripts beider Läufe
(Prompts, Rohantworten, Judge-Begründungen), nicht nur auf die Berichte.

## 1. Befunde und Priorisierung

| # | Befund | Stabilität | Didaktische Schwere | Ursprung | Priorität |
| --- | --- | --- | --- | --- | --- |
| P1 | Vorschlag oder erwartete Wirkung einer Änderung wird als Behauptung über den aktuellen Sketch gelesen | 13 / 15 Samples mit Vorschlagsantwort, 2 Läufe, 3 Cases, 2 Phasen, 2 Sketches | hoch: richtige Transferantwort mit Rating 2 → schwache Transfer-Evidenz, Difficulty −3, Folgefrage prüft den Ist-Zustand | Prompt (fehlender Bewertungsmaßstab) | 1 |
| P2 | Richtige Antwort wird als „fast“ oder „teilweise“ richtig eingeordnet | `TQ-SEM-001` 3 / 3 im Wortlaut, `strategy-learn-strong-answer` 3 / 6 `correct-answer-rejected`, 1 / 6 Rating außerhalb des Bands | hoch: Rating 2 hält eine richtige LEARN-Antwort in LEARN | Prompt (kein Kern-zuerst-Maßstab, unbedingter Hinweisauftrag) und Modellvarianz | 2 |
| P3 | Feedback bestätigt eine richtige Antwort nicht konkret am Sketch (`learn-feedback-grounds-sketch`) | 3 / 3 (nur Nachlauf, neuer Kriterientext) | mittel | Prompt (keine Bestätigungsregel), teils Kriterienstrenge | 3, mit P2 adressiert |
| P4 | Sprachliche Einordnung passt nicht zum Rating („Fast:“ bei falscher Antwort mit Rating 2) | `strategy-deepen-correction` 2 / 3 | niedrig | Prompt | mit P1/P2 adressiert |
| P5 | Lösung bei schwacher Antwort vorweggenommen | 1 / 3 | mittel | Modellvarianz | beobachten |
| P6 | Folgefrage fällt nach DEEPEN/EXPAND auf die Basisfrage zurück | 12 / 12 | niedrig | Grenze der Anchor-Fixture | kein Fix |
| P7 | `TUTOR_PROMPT_REVISION` digestet die Remediation-/Progression-Anweisungen des Dialog-Prompts nicht | deterministisch | Messinstrument (R-ID-2) | Code | Fix |

Die Ausgangshypothese „`expand-observable-result` hat Priorität“ bestätigt
sich, aber der Befund ist **nicht EXPAND-spezifisch**. Er ist das sichtbarste
Symptom von P1.

## 2. P1 – Vorschlag als Ist-Behauptung gelesen

### Beobachtung

Alle Antworten auf Fragen, die nach einer Änderung oder Überprüfung fragen
(„Wie würdest du … überprüfen?“, „Welche Erweiterung würdest du umsetzen …?“):

| Lauf | Case | Antwort (gekürzt) | Ratings | Feedback korrigiert den Ist-Zustand |
| --- | --- | --- | --- | --- |
| Baseline | `strategy-deepen-transfer` | „Ich würde in loop zusätzlich `Serial.println(counter)` ausgeben …“ | 4, 4, 4 | 3 / 3 („… im Sketch wird der Wert aber nur in `setup()` ausgegeben“) |
| Baseline | `strategy-expand-proposal` | „Ich könnte counter nach einer Ausgabe erhöhen …“ | 3, 3, 2 | 3 / 3 |
| Baseline | `strategy-expand-observation` | „Wenn ich counter in loop erhöhe, sollten … steigende Werte erscheinen.“ | 2, 2, 2 | 3 / 3 |
| Nachlauf | `strategy-expand-proposal` | wie oben | 4, 4, 4 | 1 / 3 |
| Nachlauf | `strategy-expand-observation` | wie oben | 2, 2, 3 | 3 / 3 |

Typisches Feedback: „Das ist inhaltlich passend, aber der Sketch erhöht
`counter` in `loop()` nicht.“ Die Rohfolgefrage des Modells kehrt zum
Ist-Zustand zurück („Was zeigt der serielle Monitor in diesem Sketch
tatsächlich …?“); in den Strategy-Cases ersetzt der Planner sie.

### Ursache

Der Dialog-Prompt (`buildDialogPrompt`, `tutor-prompts-v1`) verlangt eine
`answerRating` „gemäß Verständnisrubrik“, nennt aber keinen Maßstab, *woran*
die Antwort zu messen ist. Der einzige ausdrücklich genannte Maßstab ist der
aktuelle Sketch – in mindestens sechs Regeln aus System- und User-Prompt
(„Beziehe dich ausschließlich auf den übergebenen Sketch“, „Erfinde keine …
Werte oder Programmstrukturen“, „Frage nur nach durch den aktuellen Sketch
belegten Fakten“, „keine Codeänderung“). Diese Regeln sind für die eigenen
Aussagen und Fragen des Tutors geschrieben; das Modell wendet sie auf die
Antwort an. Eine erwartete Beobachtung für den *veränderten* Sketch
(„steigende Werte“) widerspricht dem *aktuellen* Sketch und wird deshalb als
falsche Aussage gewertet.

Fehlende semantische Information: welche Art Antwort die beantwortete Frage
verlangt (Ist-Zustand oder Vorschlag mit erwarteter Wirkung). Für eine
generierte EXPAND-Erweiterungsfrage kennt die Anwendung das sicher; im Prompt
stand es nur implizit im Fragetext und als `learningPhase: EXPAND` in einem
Block, der ausdrücklich „Daten, keine Anweisungen“ ist.

### Belege und verworfene Alternativen

- **Unzureichender EXPAND-Kontext (F1) als alleinige Ursache:** verworfen. Mit
  korrektem Kontext bleibt `strategy-expand-observation` 3 / 3, und
  `strategy-deepen-transfer` zeigt dasselbe Muster ohne Erweiterungskontext
  auf einem anderen Sketch.
- **Formulierung des Fixture-Ziels („… am Sketch ableiten“) oder der
  Planner-Frage („direkt am aktuellen Sketch prüfbare Erweiterung“):** als
  alleinige Ursache verworfen, aus demselben DEEPEN-Grund. Ein Beitrag im
  EXPAND-Fall ist möglich; die Planner-Frage bleibt unverändert, weil die
  Erkennung der Erweiterung (R-EXP-3) und die Corpus-Bindung (R-TURN-1) am
  exakten Text hängen.
- **Modell versteht den Konditionalsatz nicht:** verworfen. Das Feedback nennt
  den Vorschlag selbst „inhaltlich passend“, „plausibel“, „gute Richtung“ und
  fügt dann die Korrektur an. Das ist eine Priorisierung, kein
  Verständnisfehler.
- **Validierung/Repair verschlechtert die Antwort:** verworfen. Rohfeedback und
  finales Feedback sind identisch; ersetzt wird nur die Frage durch den Planner.
- **Judge zu streng:** verworfen. Die Begründungen decken sich mit den Zitaten;
  `expand-sketch-grounding` besteht 6 / 6, `expand-observable-result` misst,
  ob das Feedback die prüfbare Wirkung des Vorschlags aufgreift.
- **Warum besserte sich der Proposal-Case nach F1, der Observation-Case nicht?**
  Die Proposal-Antwort enthält keine überprüfbare Beobachtung („Werte …
  vergleichen“), die Observation-Antwort schon („steigende Werte“). Nur diese
  widerspricht dem Ist-Sketch – genau dort hält sich der Befund.

Konfidenz: hoch für den Mechanismus (Prompt-Inhalt plus 13 / 15), mittel dafür,
dass eine Prompt-Regel ihn beim konkreten Modell behebt (nur L3 kann das zeigen).

## 3. P2 – richtige Antwort relativiert

### Beobachtung

| Case | Antwort | Feedback-Einstieg | Ratings |
| --- | --- | --- | --- |
| `TQ-SEM-001` (frei), Baseline | „an PIN2 muss GND anliegen“ (gleichwertig zu `digitalRead(buttonPin) == LOW`) | „Fast richtig“, „Fast richtig … aber …“, „Knapp richtig“ | 4, 3, 4 |
| `strategy-learn-strong-answer`, Baseline | „setup gibt zuerst 3 aus; loop erhöht counter danach …“ | „Richtig“, „Richtig“, „Fast richtig“ | 4, 5, 4 |
| `strategy-learn-strong-answer`, Nachlauf | identische Prompts | „Fast richtig … Entscheidend ist noch …“, „Richtig“, „Teilweise richtig … aber …“ | 3, 4, **2** |

### Ursache

Drei zusammenwirkende Prompt-Eigenschaften, verstärkt durch Modellvarianz:

1. **Kein Kern-zuerst-Maßstab.** Nichts sagt, dass Vollständigkeit relativ zur
   Frage gemeint ist (SSOT 3.6 sagt es nur am Beispiel kurzer Antworten), dass
   zusätzliche zutreffende Aussagen oder eine gleichwertige Darstellung auf
   anderer Ebene (Signalpegel statt Codeausdruck) nicht abwerten, und dass eine
   mehrdeutige Nebenbemerkung („zuerst“) eine richtige Kernaussage nicht
   falsch macht.
2. **Unbedingter Hinweisauftrag.** Die Strategy-Guidance rendert
   `scaffold-first` als „vor der nächsten fokussierten Frage einen begrenzten
   Hinweis … geben“ und `same-indicator` als „denselben Aspekt erneut …
   prüfen“ – ohne die SSOT-Bedingung „nach einer schwachen“ bzw. „nach einer
   teilweise richtigen Antwort“ (LearningQuestions 2.2, Built-in-Tabelle).
   Damit fordert jeder Dialog-Prompt nach jeder Antwort einen Hinweis und eine
   erneute Prüfung, also ein „… aber …“.
3. **Keine Kopplung von Einordnung und Rating.** „Fast“ erscheint bei Rating 4
   ebenso wie bei Rating 2 für eine falsche Antwort (P4).

Verworfen: Kriterienfehler (F3 wurde korrigiert; die Fails stehen im Zitat),
reine Varianz (die Häufung des „aber“ bei richtigen Antworten ist systematisch).
Konfidenz: mittel; der Anteil echter Modellvarianz ist bei identischen Prompts
belegt hoch (Ratings 4, 5, 4 gegen 3, 4, 2).

## 4. P7 – Lücke in der Prompt-Provenance

`TUTOR_PROMPT_REVISION.sources` enthielt die vom Verlauf und der Strategie
ausgewählten Remediation-/Progression-Anweisungen des Dialog-Prompts nicht.
Eine Änderung daran hätte `tutor-prompts-v1` und den Digest unverändert
gelassen (Verstoß gegen R-ID-2); zwei L3-Läufe mit verschiedenen Prompts
wären als vergleichbar erschienen. Ein neuer Guard-Test rendert alle
Prompt-Varianten und schlägt bei jeder nicht digesteten Anweisung an.

## 5. Lösungsklassen

| Klasse | Robustheit | Generalisierung | Komplexität / Kopplung | Bewertung |
| --- | --- | --- | --- | --- |
| 1. Promptpräzisierung: anwendungseigene Bewertungsregeln im Dialog-Prompt | mittel (LLM-abhängig) | hoch: freier Tutor, LEARN, DEEPEN, EXPAND, beliebige Änderungsarten | gering, ein Ort | **gewählt** als Hauptmechanismus |
| 2. Strukturierter Kontext aus Planner-Daten | hoch, wo die Anwendung die Antwortart sicher kennt | nur dort: generierte EXPAND-Erweiterung | klein: ein optionales Plan-Feld | **gewählt**, eng begrenzt |
| 2b. Antwortart aus `questionKind`/Phase ableiten | gering | – | klein | verworfen: `prediction` kann Ist- oder Änderungsfrage sein; in EXPAND serviert der Planner auch Ist-Fragen |
| 3. Vorverarbeitung der Antwort (Konditional-/Modalwort-Erkennung) | gering | gering, sprachabhängig | Keyword-Regeln | verworfen: Heuristik, nähe zum Judge-Gefallen |
| 3b. Neues Course-Content-Feld „Antwortart“ pro Frage | hoch | hoch | Schema-, SSOT- und Repository-Änderung | verworfen: Produktentscheid, durch Befunde nicht gerechtfertigt |

Kein Case-Hardcoding: Keine Regel nennt `counter`, `Serial`, `delay` oder eine
Case-ID. Die Regeln gelten für Pin-Änderungen, zusätzliche Sensorabfragen,
PWM-Experimente, geänderte Schleifenlogik oder andere Werte gleichermaßen.

## 6. Umsetzung (gestapelte PRs)

| PR | Branch | Zweck | Verhalten |
| --- | --- | --- | --- |
| 1 | `test/tutor-quality-wrong-proposal-case` | Negativkontrolle `strategy-expand-wrong-effect` (Vorschlag mit falscher erwarteter Wirkung, Band [1, 2]), Corpus v7, Wochenbudget 291; diese Analyse | Messinstrument, kein Tutor-Verhalten |
| 2 | `fix/tutor-strategy-guidance-conditions` | P7: Digest deckt alle Dialoganweisungen ab; P2: Remediation/Klärung nennen ihren SSOT-Auslöser; `tutor-prompts-v2` | Prompt |
| 3 | `fix/tutor-answer-evaluation-frame` | P1, P2, P3, P4: Bewertungsregeln im Dialog-Prompt; `answerFrame: proposed-change` für generierte Erweiterungsfragen; SSOT 3.6 präzisiert; `tutor-prompts-v3` | Prompt, Planner-Metadatum |

Die Negativkontrolle ist nötig, weil PR 3 Vorschläge wohlwollender bewertet:
Ohne sie wäre ein Tutor, der jeden Vorschlag akzeptiert, im Corpus unsichtbar.
Die bestehenden Negativkontrollen enthalten nur falsche Ist-Behauptungen.

## 7. L3-Nachlauf (vorbereitet, nicht ausgeführt)

### Konfiguration

Feste Modelle wie Baseline, Nachlauf und Wochenlauf: Tutor
`openai-gpt5.4-mini`, Judge `openai-gpt5.5`. Auszuführen auf dem Head von PR 3
(enthält PR 1 und 2), saubere relevante Git-Lage (R-ID-3).

Callgraph (geprüft auf dem Head von PR 3 mit Fake-Provider über den echten
CLI-Pfad): 1 Preflight-Modellliste; pro Turn eine Modellauflösung und eine
Generierung (2 Calls); `off-topic-answer` 0 Calls (lokaler Fallback);
1 Judge-Call pro Sample eines Cases mit `judge`-Block.

| Variante | Cases | Samples | Budget (R-BUD-2) |
| --- | --- | --- | --- |
| **A (empfohlen)** | voller Corpus v7 (18 Cases, 26 Turns, 8 mit Judge) | 5 | `1 + 5 × (50 + 8) = 291` |
| B (gezielt) | 8 Judge-Cases (`TQ-SEM-001`, 7 `strategy-*`) | 5 | `1 + 5 × (30 + 8) = 191` |
| C (optional, Kontrolle) | wie B, auf dem Head von PR 1 (alte Prompts, neue Negativkontrolle) | 5 | 191 |

Begründung für A: Die Prompt-Änderung betrifft jeden Dialog-Turn, auch die
Cases ohne Judge (Rating-Band von `learn-to-deepen`, Rohausgabe der freien
Dialog-Cases). A entspricht exakt der Wochenkonfiguration; die Berichte sind
per Text-Diff von `report.md` vergleichbar (R-REP-3). Fünf Samples, weil
k(5) = 3: Ein Befund mit wahrer Rate 0,8 bleibt mit Wahrscheinlichkeit 0,94
erkannt, ein behobener Befund mit Rate 0,15 erscheint nur mit 0,03 als `fail`.

Kontrolle ohne Zusatzkosten: Der erste geplante Wochenlauf (Montag 04:17 UTC
auf `main`, alte Prompts, n = 5, voller Corpus) ist eine zeitnahe Kontrolle
mit identischer Konfiguration. Wird PR 1 vorher gemergt, enthält er auch die
Negativkontrolle mit alten Prompts (291 statt 266 Calls). Variante C ist nur
nötig, wenn diese Kontrolle nicht abgewartet werden soll.

### Aufruf

Lokal (Credentials nur als Variablennamen, R-RUN-4):

```sh
git switch fix/tutor-answer-evaluation-frame   # sauberer Worktree
npm run eval:tutor-quality:real -- \
  --model openai-gpt5.4-mini \
  --judge-model openai-gpt5.5 \
  --credential-env UNOSIM_TUTOR_EVAL_CREDENTIAL \
  --judge-credential-env UNOSIM_TUTOR_JUDGE_CREDENTIAL \
  --samples 5 \
  --max-calls 291 \
  --output-dir .tutor-quality-output/answer-frame-<datum>
```

Oder per `workflow_dispatch` von `.github/workflows/tutor-quality-real-provider.yml`
auf dem Ref `fix/tutor-answer-evaluation-frame` mit `model=openai-gpt5.4-mini`,
`judge_model=openai-gpt5.5`, `samples=5`, `max_calls=291`, `case` leer.

Variante B lokal: zusätzlich `--case TQ-SEM-001 --case strategy-learn-weak-answer
--case strategy-learn-strong-answer --case strategy-deepen-transfer
--case strategy-deepen-correction --case strategy-expand-proposal
--case strategy-expand-observation --case strategy-expand-wrong-effect`,
`--max-calls 191`.

### Hypothesen und Entscheidungskriterien

| Hypothese | Bestätigt, wenn | Widerlegt, wenn |
| --- | --- | --- |
| H1: Der Bewertungsrahmen behebt P1 | `strategy-expand-observation` / `expand-observable-result` fällt in ≤ 1 / 5 Samples; Ratings dort ≥ 3; in `strategy-expand-*` und `strategy-deepen-transfer` korrigiert das Feedback den Ist-Zustand höchstens in einzelnen Samples | `expand-observable-result` fällt in ≥ 3 / 5 (k(5)) |
| H2: P2 sinkt | `strategy-learn-strong-answer`: `learn-accepts-correct-answer` und `correct-answer-rejected` je ≤ 1 / 5, Rating 5 / 5 im Band [3, 5]; `TQ-SEM-001` / `accepts-correct-answer` ≤ 1 / 5 | einer dieser Befunde in ≥ 3 / 5 |
| H3: P3 sinkt | `learn-feedback-grounds-sketch` ≤ 2 / 5 | ≥ 3 / 5 (dann nur Teilwirkung; kein Merge-Blocker, wenn H1, H2 und H4 halten) |
| H4: kein Nachgiebigkeits-Rückschritt | `strategy-learn-weak-answer`, `strategy-deepen-correction`, `strategy-expand-wrong-effect`: Rating im Band [1, 2] in ≥ 4 / 5, Korrekturkriterien ≤ 1 / 5 fail | ein Band in ≥ 3 / 5 verfehlt oder ein Korrekturkriterium ≥ 3 / 5 fail: **nicht mergen** |
| H5: keine Produktregression | 0 Produkt-Violations (R-VER-3); `learn-to-deepen` im Band | jede Produkt-Violation |

Fällt H1 durch, obwohl H4 hält: Der Prompt allein reicht für dieses Modell
nicht. Nächster Schritt wäre dann ein strukturierterer Eingriff (zum Beispiel
die Erweiterungsfrage so formulieren, dass sie den veränderten Sketch
ausdrücklich nennt, mit Corpus-Anpassung), nicht ein lockereres Kriterium.

## 8. Erwartete Wirkung auf `qualityVerdict`

Ohne realen Lauf wird keine Verbesserung behauptet. Unter `tutor-quality-verdict-v1`
bestimmen bisher `expand-observable-result` (6 / 6) und die
`strategy-learn-strong-answer`-Befunde das `fail`. Treffen H1 und H2 zu,
fallen diese Schlüssel unter k(5); verbleibende Einzelbefunde ergäben `warn`.
Die neue Negativkontrolle kann ein neues `fail` erzeugen, wenn der Tutor
falsche Vorschläge akzeptiert – das ist ihr Zweck.

## 9. Unverändert

Verdict-Regel `tutor-quality-verdict-v1`, Judge-Prompt und alle bestehenden
Kriterien, Sample-Zahl und Modelle des Wochenlaufs, Workflow-Struktur (nur die
Budget-Konstante folgt dem Callgraph), die geschützte
`ssot/ssot_function_tutor_model_registration.md`.
