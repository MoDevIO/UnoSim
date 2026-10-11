# Tutor Quality – Freetutor, Punkt B (Judge gegen Referenzbewertung)

Status: Auswertung, **nicht normativ**. Normativ ist
`ssot/ssot_function_definition_TutorQualityEvaluation.md`. Rohartefakte liegen nur
lokal unter `.tutor-quality-output/freetutor-B-2026-10-07/`. Die verdeckte
Referenzbewertung steht in `evals/tutor-quality/human-ratings/freetutor-B-2026-10-07.md`.
Sie stammt von einem LLM-Evaluator (nicht von einer Person); gemessen wird
Referenzmodell–Judge-Übereinstimmung.

## 1. Lauf

| Merkmal | Wert |
| --- | --- |
| Run-ID | `tq2a-20261007T062850800Z-65da2858-f7d6-4603-88ef-430564158fde` |
| Branch | `feat/freetutor-quality-criteria` (Corpus v9) |
| Tutor / Judge | `openai-gpt5.4-mini` / `openai-gpt5.5`, Prompt `tutor-prompts-v2` |
| Cases | `TQ-SEM-001`, `incorrect-answer-remediation`, `partial-answer-follow-up`, `strong-answer-progression`; 5 Samples |
| Calls | 61 von 61 (21 Modellliste, 20 Generierung, 20 Judge) |
| Status | `completed`, 20 von 20 Judge `evaluated`, kein technischer Fehler |
| `qualityVerdict` | `fail` (Regel `tutor-quality-verdict-v1`), getragen von `TQ-SEM-001` |

## 2. Judge gegen Referenz, je Kriterium (deskriptiv, ohne Schwelle)

„Verletzung“ = Referenz `nein` bzw. Judge `fail`. Kleine Zahlen: ein Fehler sind
10 bis 50 Prozentpunkte.

| Kriterium | Fälle | Ref. verletzt | Recall | Spezifität | Anmerkung |
| --- | ---: | ---: | ---: | ---: | --- |
| `no-unneeded-qualification` | 10 (5 `TQ-SEM-001`, 5 Kontrolle `strong-answer-progression`) | 5 | 5/5 | 5/5 | volle Übereinstimmung, Kontrolle blieb ruhig |
| `no-solution-revealed` | 10 (5 `incorrect-…`, 5 Kontrolle `partial-…`) | 2 | 2/2 | 8/8 | volle Übereinstimmung, Kontrolle blieb ruhig |
| `accepts-correct-answer` | 5 | 0 | – | 2/5 | 3 Judge-`fail` bei Referenz `ja` |
| `no-false-claim` | 5 | 1 (post hoc) | 1/1 | 4/4 | Referenz Eintrag 16 nach Sichtung des Judge-Ergebnisses korrigiert (3.3); keine Blindkalibrierung |
| `distinct-followup` | 5 | 0 | – | 5/5 | keine Verletzung auf beiden Seiten |

## 3. Befunde

### 3.1 Die beiden neuen Kriterien stimmen mit der Referenz überein

`no-unneeded-qualification` und `no-solution-revealed` haben in allen 20 Fällen
dasselbe Ergebnis wie die Referenz, einschließlich der beiden Kontrollgruppen. Der
deterministische Check `raw-provider/solution-revealed` trifft genau dieselben zwei
Samples (0 und 1 von `incorrect-answer-remediation`). Das Rating-Band `[4, 5]` von
`TQ-SEM-001` schlägt in 4 von 5 Samples an (Ratings 2, 3, 3, 3); das 5. Sample hat
Rating 4 und trägt in der Referenz nur `relativiert-korrekt` bei Gesamturteil
„akzeptabel“. Band und Referenz stimmen damit überein.

Grenze: 10 Fälle je Kriterium, ein einziger Tutor, ein Modell. Das ist ein erster
deskriptiver Befund, kein Nachweis der Zuverlässigkeit. Die Judge-Wiederholbarkeit
(gleiche Antwort mehrfach bewerten) wurde nicht gemessen.

### 3.2 `accepts-correct-answer` ist strenger als die Referenz

Bei 3 von 5 `TQ-SEM-001`-Samples sagt der Judge `fail` („das Feedback stuft sie nur
als beinahe richtig ein“), die Referenz `ja`. Der Judge liest „Fast richtig“ als
Nichtanerkennung, die Referenz als Anerkennung mit Relativierung (R-CRT-5: Annehmen
und Relativieren sind verschiedene Verhalten). Dieselben drei Samples erzeugen das
kritische Problem `correct-answer-rejected`. Das Kriterium doppelt damit
`no-unneeded-qualification`. Entscheidung offen: den Text von
`accepts-correct-answer` schärfen („auch wenn zusätzlich relativiert wird“), oder
das Kriterium streichen, oder die Referenz anpassen.

### 3.3 Korrektur der Referenz bei Eintrag 16 (post hoc)

Eintrag 16 (`TQ-SEM-001`, Sample 3): Feedback „Der Zustandswechsel am Taster ist der
entscheidende Punkt“. Der Judge bewertet `no-false-claim = fail` (die LED hängt vom
aktuellen LOW-Pegel ab, nicht von einem Wechsel). Die Referenz hatte blind `ja`
gesagt und wurde am 2026-10-07 **nach Kenntnis des Judge-Ergebnisses** auf `nein`
korrigiert. Für `no-false-claim` ist die Referenz deshalb keine unabhängige
Blindkalibrierung; sie steht mit diesem Vermerk in der Referenzdatei.

### 3.4 Kritisches Problem `complete-solution` ist zu grob

Der Judge meldet für die beiden Lösungsverrat-Samples das kritische Problem
`complete-solution`. Die Folgefrage nennt aber nur den einen Wert `int counter = 3;`,
keine vollständige Lösung. Der Name `complete-solution` passt nur grob; hier ist
ein einzelner Wert verraten. Die Wirkung bleibt `warn` (2 von 5 Samples, unter
der Schwelle `k = 3`).

### 3.5 Lücke: Lösungsverrat in `strong-answer-progression`

Eintrag 08 (`strong-answer-progression`, Sample 4): Die Folgefrage nennt
`int counter = 3;`. Die Referenz markiert das als `lösung-verraten`, aber in diesem
Case gibt es weder ein `mustNotReveal` noch das Kriterium `no-solution-revealed`.
Beide Prüfungen laufen nicht und der Befund bleibt ohne Messung. Vorschlag: nicht
jetzt ausdehnen, erst nach Ihrer Entscheidung (Punkt A hat es nicht gestützt, dieser
Lauf schon).

### 3.6 Zwei weitere Beobachtungen

- Tutorverhalten: `TQ-SEM-001` bleibt das auffälligste Muster (Relativierung bei
  fachlich korrekter Antwort in 5 von 5 Samples). Hier wirkt das Modell, nicht der
  Judge.
- Der Lösungsverrat durch `int counter = 3;` in der Folgefrage trat in 2 von 5
  Samples von `incorrect-answer-remediation` und 1 von 5 in
  `strong-answer-progression` auf.

## 4. Entscheidungen vom 2026-10-07

1. `accepts-correct-answer` wird geschärft („…, auch wenn es sie zusätzlich unnötig
   relativiert“) und bleibt orthogonal zu `no-unneeded-qualification`; die Referenz
   bleibt unverändert. Wirkung erst nach einem neuen Lauf messbar.
2. Eintrag 16 auf `nein` (post hoc, siehe 3.3).
3. `mustNotReveal` (`counter = 3`) und `no-solution-revealed` auch in
   `strong-answer-progression` (Corpus v10).
4. Enger Prompt-Fix gegen den Lösungsverrat in der Folgefrage, als eigener PR, mit
   gezieltem Nachlauf (`incorrect-answer-remediation`, `strong-answer-progression`,
   Kontrolle `partial-answer-follow-up`).
5. Modellvergleich `openai-gpt5.4-mini` gegen `openai-gpt5.5` nur für `TQ-SEM-001`,
   getrennt vom Prompt-Fix. Mögliche Selbstbewertungs-Verzerrung ist zu dokumentieren,
   weil `openai-gpt5.5` auch Judge ist. `complete-solution` bleibt unverändert.
