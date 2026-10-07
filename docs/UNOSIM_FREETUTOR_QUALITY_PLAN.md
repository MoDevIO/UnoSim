# UnoSim – Freetutor-Qualität: Umsetzungsplan mit Referenzbewertung

Stand: 2026-10-06
Status: Plan, **nicht normativ**. Normativ ist
`ssot/ssot_function_definition_TutorQualityEvaluation.md` (Regeln `R-…`).
Baut auf `docs/UNOSIM_TUTOR_QUALITY_AUTOMATION_PLAN.md` und den Berichten vom
2026-10-03 auf. Scope: nur der **Freetutor** (kein aktives Topic, keine
Inline-Steuerung, keine Phasenstrategien).

## 1. Ziel

Belegen, ob der Freetutor Lernende gut unterstützt. Das heißt: Er bewertet
Antworten richtig, führt mit Hinweisen statt Lösungen, bleibt am Sketch und
bringt Lernende über mehrere Schritte weiter.

**Eine Referenzbewertung ist der Maßstab.** Der Judge ist ein Hilfsmittel und
wird an ihr kalibriert, nicht umgekehrt.

**Provenienz der Referenz (Korrektur vom 2026-10-07):** Die Referenzbewertung
von Punkt A stammt von einem LLM-Evaluator (nach Angabe der Projektleitung
GPT-5.6 Sol) und wurde von der Projektleitung als Referenz freigegeben. Sie ist
keine unabhängige menschliche Bewertung. Gemessen wird damit
Referenzmodell–Judge-Übereinstimmung. Eine echte menschliche Baseline würde
voraussetzen, dass eine Person die Samples unabhängig bewertet. Wo dieser Plan
„Sie bewerten“ oder „menschlich“ sagt, ist die Referenzbewertung gemeint, sofern
nicht ausdrücklich eine Person genannt wird. Der Ordner
`evals/tutor-quality/human-ratings/` heißt aus Kompatibilitätsgründen weiter so.

## 2. Ausgangslage (belegt)

- Corpus v8 hat fünf Cases mit `courseContent: free`: `TQ-SEM-001`,
  `incorrect-answer-remediation`, `partial-answer-follow-up`,
  `strong-answer-progression`, `off-topic-answer`.
- Judge-Kriterien hat nur `TQ-SEM-001`. Die anderen vier prüfen nur
  deterministisch.
- `unmatched-topic-free-tutor` läuft mit `courseContent: variables` und gehört
  nicht in die reine Freetutor-Gruppe.
- Der letzte Echtlauf nutzt Corpus v7. Für v8 gibt es keinen.
- Bekannte Schwächen: korrekte Antworten werden als „Fast richtig“ relativiert
  (`TQ-SEM-001`, 2 von 5 im v4-Lauf); verbal genannte Lösungen erkennt kein
  deterministischer Check; Rating und Text widersprechen sich teils, und der
  Judge erkennt das nicht zuverlässig.
- Nicht gemessen: Einstiegsfragen und mehrschrittige Verläufe.

## 3. Wie Sie eingebunden sind

Der Ablauf wiederholt sich in jeder Runde:

1. Ich lasse einen Testlauf laufen. Vorher nenne ich das berechnete Budget
   (R-BUD-2) und warte auf Ihre Freigabe.
2. Ich erzeuge daraus ein **Bewertungsblatt** (Markdown), ein Eintrag pro Sample:
   Sketch, Frage, Lerner-Antwort, Tutor-Antwort samt Rating. Das Judge-Urteil
   zeige ich bewusst **nicht** mit, damit Sie unbeeinflusst bewerten.
3. Sie bewerten jeden Eintrag:
   - **gut / akzeptabel / schlecht**
   - ein Satz, warum (Pflicht bei „schlecht“)
   - optional Markierungen: `relativiert-korrekt`, `lösung-verraten`,
     `falsch-bewertet`, `ablenkend`, `rating-widerspruch`
4. Ich vergleiche Ihre Urteile mit denen des Judges und nenne Abweichungen.
5. Daraus entscheiden wir gemeinsam: Tutor-Verhalten ändern, Judge-Kriterium
   ändern oder Case ändern.

Ihre Bewertungen werden als `evals/tutor-quality/human-ratings/<run-id>.md`
abgelegt (ohne Credentials, nur Transcript-Auszüge). Sie sind die Referenz für
die Judge-Kalibrierung.

Aufwand für Sie: etwa 15 bis 30 Einträge pro Runde, je ein bis zwei Minuten.

### 3.1 Bewertungsregeln (eingefroren am 2026-10-06, vor Bewertungspunkt A)

Diese Regeln gelten für Punkt A unverändert. Änderungen nur offen als neue
Version, nie rückwirkend nach Sicht der Antworten.

- **gut:** fachlich korrekt, didaktisch hilfreich, passend zum Sketch und zur
  Lernendenantwort; Rating passt zum Text; keine unnötige Lösungsvorgabe.
- **akzeptabel:** grundsätzlich korrekt und hilfreich, aber mit einer kleineren
  didaktischen oder sprachlichen Schwäche, die den Lernprozess nicht wesentlich
  stört. Kurze Begründung, wenn die Schwäche für die Judge-Kalibrierung
  relevant ist.
- **schlecht:** fachlich falsch, irreführend, wesentliche Lernerleistung falsch
  bewertet, Lösung unangemessen verraten, Antwort deutlich am Kontext vorbei
  oder Rating und Text in einem didaktisch relevanten Widerspruch.
  Begründung Pflicht.
- Tags: `relativiert-korrekt`, `lösung-verraten`, `falsch-bewertet`,
  `ablenkend`, `rating-widerspruch`.

### 3.2 Blindheit in Punkt A

- Kein Judge-Ergebnis, keine Pass/Fail-Markierung, keine Vorauswahl
  „auffälliger“ Samples, auch nicht indirekt.
- Alle Samples erscheinen in zufälliger, aber festgehaltener Reihenfolge. Die
  Zuordnung zu Case und Sample steht in einer getrennten Schlüsseldatei, die
  Sie erst nach der Bewertung sehen.

## 4. Schritte

Reihenfolge fest, jeder Schritt endet an einem **Bewertungspunkt**. Ein PR hat
einen Zweck, TDD, kein Push ohne Ihre Freigabe, geschützte Datei
`ssot/ssot_function_tutor_model_registration.md` bleibt unberührt.

### Schritt 1 – Ausgangsmessung (nur Lauf, kein Code)

- Die fünf `free`-Cases mit Corpus v8, Prompt wie aktuell auf `main`, mehrere
  Samples (Vorschlag 5), nur Tutor-Antworten, **ohne Judge**.
- Freigegeben am 2026-10-06: 5 Samples je Case, Tutor-Calls ja, Judge-Calls
  nein, Modell und Prompt unverändert (`openai-gpt5.4-mini`, `tutor-prompts-v1`
  wie in den früheren Läufen).
- Budget nach R-BUD-2: 1 + 5 × 4 Cases × 1 Turn × 2 = **41**. Obergrenze 51.
  `off-topic-answer` wird vom `TutorService` lokal beantwortet („Fußball“ und
  „Wetter“ lösen die Regel aus) und kostet 0 Calls; er prüft damit eine feste
  Regel, nicht das Modell.
- **Bewertungspunkt A:** Sie bewerten alle Samples. Ergebnis: eine
  menschliche Baseline, wie gut der Freetutor heute ist.

### Schritt 2 – Messlücken schließen (Code, ohne Provider-Calls)

Vorab Ihre Entscheidung zu den Kriterien, dann SSOT-Änderung vor Code (R-COR-1).

- Erkennung **verbal genannter Lösungen** als deterministischer Check
  (heute nur Code). Als Warnung, nicht als hartes Fail, bis sie kalibriert ist.
- Prüfung **Rating gegen Text** (z. B. Rating ≤ 2 bei Text „richtig“ oder
  umgekehrt) als deterministischer Check.
- Judge-Kriterien für die vier Cases ohne Judge. Entwurf auf Basis Ihrer
  Markierungen aus Punkt A, nicht aus meiner Vermutung.
- `corpusVersion` erhöhen.

### Schritt 3 – Neue Cases für Einstieg und Verlauf

- **Einstiegsfragen:** Der Tutor stellt die erste Frage zu einem Sketch ohne
  Topic. Kriterien: am Sketch verankert, offen statt Ja/Nein, nicht zu schwer.
- **Mehrschrittige Verläufe:** 3 bis 4 Turns mit simuliertem Lerner (falsch,
  teilweise richtig, richtig). Kriterien: Hinweis wird aufgegriffen, kein
  Wiederholen derselben Frage, Fortschritt sichtbar.
- Dafür ist eine Runner-Erweiterung für mehr als 2 Turns nötig. Ich prüfe zuerst,
  was der Runner heute kann (der Katalog-Evaluator macht es schon, der
  Anchor-Runner nicht).
- `unmatched-topic-free-tutor` wird separat geführt und nicht in die Gruppe
  gemischt.

### Schritt 4 – Lauf mit Judge und menschlicher Sichtung

- Alle Freetutor-Cases, Tutor plus Judge (`openai-gpt5.5` wie bisher).
- **Bewertungspunkt B:** Sie bewerten wieder verdeckt. Danach rechne ich die
  Übereinstimmung Mensch–Judge pro Kriterium aus.
- **Kalibrierung kriteriumsweise**, nicht gegen die Gesamturteile gut/akzeptabel/
  schlecht: Der Judge bewertet Kriterien, also wird er an Ihren Tags gemessen.
  Je Kriterium: Recall (erkennt er Ihre bestätigten Verstöße), Spezifität (lässt er
  Ihre unauffälligen Kontrollen in Ruhe), ergänzend Precision und Balanced
  Accuracy = (Recall + Spezifität) / 2.
  - `no-unneeded-qualification`: Positive sind Einträge mit `relativiert-korrekt`;
    Negativkontrolle ist `strong-answer-progression`.
  - `no-solution-revealed`: Positive sind Einträge mit `lösung-verraten`;
    Kontrolle ist `partial-answer-follow-up`.
- **Keine harte Schwelle zunächst.** Bei 5 Samples je Case sind 20 Prozentpunkte
  ein einzelner Fehler. Erst deskriptiv messen und die Fehlermuster ansehen; eine
  Schwelle wird danach gemeinsam festgelegt.

### Schritt 5 – Verbesserung und Nachlauf

- Nur für Befunde, die Sie als echte Schwäche bestätigt haben: Prompt- oder
  Produktänderung, jeweils ein PR.
- Der Nachlauf wiederholt nur die betroffenen Cases. **Bewertungspunkt C** zum
  Vergleich vorher–nachher.
- Optional (Variante D): ein anderes Tutor-Modell, falls die Relativierung
  korrekter Antworten bleibt. Dafür brauche ich von Ihnen eine feste
  Modell-ID. Das Schema steht in
  `docs/tutor-quality-next-architecture-2026-10-03.md` §5.

### Schritt 6 – Verstetigen

- Das Qualitätsurteil (pass/warn/fail) auf die kalibrierten Kriterien anwenden.
- Eine Checkliste „vor einer Tutor-Änderung L3 laufen lassen“. Der Workflow
  bleibt manuell.
- Ihre Bewertungsblätter bleiben als Regressionsreferenz erhalten.

## 5. Entscheidungen, die ich von Ihnen brauche

| Wann | Entscheidung |
| --- | --- |
| Vor Schritt 1 | Freigabe von Budget und Provider-Calls; Anzahl Samples (5) |
| Vor Schritt 2 | Soll der Check für verbale Lösungen anfangs nur warnen? |
| Vor Schritt 4 | Kennzahl und Schwelle für „Judge ist brauchbar“ (nach Punkt A) |
| Schritt 5 | Nur bei Bedarf: feste Modell-ID für den Vergleich |

## 6. Risiken und Grenzen

- **Ihr Urteil ist subjektiv.** Bei Unsicherheit markieren Sie „akzeptabel“ und
  schreiben den Grund. Bei weniger als 15 Einträgen sind Quoten nur ein
  Richtwert.
- **Modellvarianz:** Wenige Samples zeigen Häufigkeiten nur grob. Deshalb
  Samples pro Case auf mindestens 5.
- **Simulierter Lerner:** Scripted Antworten sind kein echtes Lernverhalten.
  Echte Lernende bleiben ein späterer, eigener Schritt.
- **Kosten:** Jeder Lauf wird vorab berechnet und freigegeben. Die Serie bisher
  lag bei rund 146 Calls für die Topic-Cases.

## 7. Nicht im Scope

Inline-Fokus, Topic-Strategien (LEARN, DEEPEN, EXPAND), Course-Content-Authoring,
periodische Automatisierung, neue Prompt-Varianten ohne bestätigten Befund.
