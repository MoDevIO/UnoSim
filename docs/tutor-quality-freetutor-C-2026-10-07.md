# Tutor Quality – Freetutor, Punkt C (Nachlauf nach Prompt v3)

Status: Auswertung, **nicht normativ**. Normativ ist
`ssot/ssot_function_definition_TutorQualityEvaluation.md`. Rohartefakte liegen nur
lokal unter `.tutor-quality-output/freetutor-C-2026-10-07/`. Die verdeckte
Referenzbewertung steht in `evals/tutor-quality/human-ratings/freetutor-C-2026-10-07.md`;
sie stammt von einem LLM-Evaluator, nicht von einer Person. Vorher-Werte stehen in
`docs/tutor-quality-freetutor-B-2026-10-07.md`.

## 1. Lauf und Vergleichsbedingungen

| Merkmal | Punkt B | Punkt C (dieser Lauf) |
| --- | --- | --- |
| Run-ID | `tq2a-20261007T062850800Z-65da2858-…` | `tq2a-20261007T065450027Z-fb21a25c-ee3f-4904-b610-fcc168665b58` |
| Tutor-Prompt | `tutor-prompts-v2` | `tutor-prompts-v3` (Folgefrage darf die gesuchte Antwort nicht nennen) |
| Corpus | v9 | v10 |
| Tutor / Judge | `openai-gpt5.4-mini` / `openai-gpt5.5` | unverändert |
| Cases | 4 (inkl. `TQ-SEM-001`) | `incorrect-answer-remediation`, `strong-answer-progression`, `partial-answer-follow-up` |
| Calls | 61 / 61 | 46 / 46 (16 Modellliste, 15 Generierung, 15 Judge) |
| Status | `completed` | `completed` |
| `qualityVerdict` | `fail` | `fail` (nur `strong-answer-progression`) |

**Änderungen zwischen v9 und v10 mit Bezug zu diesem Vergleich:** `accepts-correct-answer`
(geschärft, betrifft diese drei Cases nicht); `strong-answer-progression` hat neu
`mustNotReveal: ["counter = 3"]` und `no-solution-revealed`. Für die Leak-Messung dort
gibt es deshalb keinen symmetrischen automatischen Vorher-Wert; der qualitative
Ausgangsbefund ist Eintrag 08 aus Punkt B. Die Eingaben an den Tutor (Sketch, Frage,
Antwort, Schwierigkeit) sind in beiden Läufen gleich; auf der Tutor-Seite hat sich nur
der Prompt geändert. `partial-answer-follow-up` und `incorrect-answer-remediation` haben
denselben Corpus-Inhalt wie in B.

Stichprobe: 5 Samples je Case, ein Modell, Temperatur 0,2. Alle Aussagen sind
deskriptiv.

## 2. Leaks nach Prompt v3

| Case | B: Leak (Referenz) | C: Leak (Referenz) | C: Judge `no-solution-revealed` | C: Literal `counter = 3` |
| --- | ---: | ---: | --- | --- |
| `incorrect-answer-remediation` | 2/5 | 0/5 | 5 × pass | kein Treffer |
| `strong-answer-progression` | 1/5 (Eintrag 08, qualitativ) | 0/5 | 5 × pass | kein Treffer |
| `partial-answer-follow-up` | 0/5 | **1/5** (Eintrag 15) | pass (Referenz `nein`) | – (kein Literal deklariert) |

- Der Prompt-Fix wirkt dort, wo das Problem gemessen wurde: In den Cases mit
  `mustNotReveal` gibt es keinen Literal-Leak mehr (B: 2 Treffer in
  `incorrect-answer-remediation`, C: 0), und die Referenz sieht dort keinen Verrat mehr.
- Summe aller drei Cases: B 3/15, C 1/15. Das ist zu klein für eine belastbare Aussage.
- **Eintrag 15 bleibt ein Verrat:** Die Folgefrage zitiert `counter += 1;` und nennt damit
  den gesuchten Zusammenhang praktisch schon. Der Judge hat das nicht erkannt (Referenz
  `nein`, Judge `pass`; Begründung des Judge: die Folgefrage lenke nur auf eine einzelne
  Anweisung). Für diesen Case gibt es kein deklariertes Literal; `counter += 1` wäre ein
  möglicher Kandidat.

## 3. Judge gegen Referenz (deskriptiv, ohne Schwelle)

| Kriterium | Fälle | Referenz verletzt | Recall | Spezifität |
| --- | ---: | ---: | ---: | ---: |
| `no-unneeded-qualification` (`strong-answer-progression`) | 5 | 4 | 4/4 | 1/1 |
| `no-solution-revealed` (3 Cases) | 15 | 1 | **0/1** | 14/14 |

Zusammen mit B (10 Fälle je Kriterium) stimmt `no-unneeded-qualification` in allen 15
Fällen überein. `no-solution-revealed` hat jetzt einen Fehler (Eintrag 15, ein falsch
negatives Ergebnis); bei einem einzigen positiven Fall ist die Recall-Zahl nur eine
Einzelbeobachtung.

## 4. Neue Beobachtung: `strong-answer-progression` relativiert nach Prompt v3

Die Antwort der lernenden Person ist in beiden Läufen identisch und von der Referenz als
korrekt eingestuft. Tutor-Seite:

| | B (Prompt v2) | C (Prompt v3) |
| --- | --- | --- |
| Feedback beginnt mit „Richtig…“ | 5/5 | 1/5 |
| Feedback beginnt mit „Teilweise richtig…“ | 0/5 | 4/5 |
| Ratings | 4, 5, 5, 5, 5 | 3, 5, 2, 3, 2 |
| Referenz `no-unneeded-qualification = nein` | 0/5 | 4/5 |
| Judge `no-unneeded-qualification = fail` | 0/5 | 4/5 |

Eine Zufallsverteilung ist unwahrscheinlich (exakter Fisher-Test, zweiseitig,
p ≈ 0,048; nur grobe Orientierung bei 5 gegen 5), und die Tutor-Eingaben sind identisch.
Die plausibelste Erklärung ist der Prompt v3: Die Folgefragen verlangen jetzt oft den
konkreten Wert („Welchen konkreten Wert hat `counter` in der Deklaration…“), und die
Rückmeldung bemängelt, dass „die konkrete Zahl fehlt“. **Das ist eine Hypothese aus den
Texten, nicht bewiesen.** Es ist eine Nebenwirkung der Regel gegen Leaks: kein Leak mehr,
aber eine korrekte Antwort wird als nur teilweise richtig gewertet.

Dazu: Der Verdict-Befund `critical-issue/factually-wrong-feedback` (1 Sample) und
`correct-answer-rejected` (2 Samples) liegen unter der Schwelle und sind `warn`;
`criterion/no-unneeded-qualification` mit 4 von 5 Samples ist `fail`.

## 5. Übervorsicht und Vagheit in der Kontrolle

`partial-answer-follow-up`: 4 von 5 Einträgen „gut“, 1 „schlecht“ (der Leak aus
Eintrag 15). Die Referenz meldet keine zu vagen Folgefragen. Eintrag 01
(`strong-answer-progression`, Application-Fallback nach einem Wiederholungsfund
`raw-provider/question-repeat`) ist „akzeptabel“ wegen einer generischen Folgefrage.

## 6. Offene Entscheidungen

1. Der Relativierungs-Nebeneffekt von Prompt v3 in `strong-answer-progression`: Fix
   nachbessern (zum Beispiel eine Ergänzung, dass eine fachlich richtige Antwort nicht
   als teilweise richtig bewertet wird, nur weil die Folgefrage einen konkreten Wert
   verlangt), mit erneutem Nachlauf, oder Prompt v3 verwerfen?
2. `mustNotReveal: ["counter += 1"]` und gegebenenfalls ein Zusatz am Judge-Kriterium für
   `partial-answer-follow-up`, damit Eintrag 15 gemessen wird?
3. Der Prompt-Fix-PR sollte erst nach der Entscheidung zu 1 gemerged werden.
