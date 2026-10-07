# Tutor Quality – Freetutor, Punkt D (Nachlauf nach Prompt v4) und Verlauf B → C → D

Status: Auswertung, **nicht normativ**. Rohartefakte liegen nur lokal unter
`.tutor-quality-output/freetutor-D-2026-10-07/`. Die verdeckte Referenzbewertung steht in
`evals/tutor-quality/human-ratings/freetutor-D-2026-10-07.md`; sie stammt von einem
LLM-Evaluator, nicht von einer Person. Vorläufer:
`docs/tutor-quality-freetutor-B-2026-10-07.md`, `…-C-2026-10-07.md`.

## 1. Lauf und Vergleichsbedingungen

| | B | C | D (dieser Lauf) |
| --- | --- | --- | --- |
| Run-ID | `…-65da2858-…` | `…-fb21a25c-…` | `tq2a-20261007T070948306Z-e6f53e88-e561-490e-aac9-27adcf4fb102` |
| Tutor-Prompt | v2 | v3 | v4 |
| Corpus | v9 | v10 | v11 |
| Cases | 4 | 3 | 3 (dieselben wie C) |
| Calls | 61 | 46 | 46 / 46 (16 Modellliste, 15 Generierung, 15 Judge) |
| `qualityVerdict` | `fail` | `fail` | **`warn`** (vier vereinzelte Befunde, keiner an der Schwelle k = 3) |

Corpus-Änderung zwischen C und D: nur `partial-answer-follow-up` (`mustNotReveal:
["counter += 1"]`, geschärftes `no-solution-revealed`). Tutor-Seite: nur Prompt v4 (Antwort
wird ausschließlich gegen die gestellte Frage bewertet). Stichprobe: 5 Samples je Case,
ein Modell, Temperatur 0,2; alle Aussagen sind deskriptiv. Referenz D: 11 gut,
1 akzeptabel, 3 schlecht.

## 2. Verlauf B → C → D (Referenz, je 5 Samples)

| Messgröße | B (v2) | C (v3) | D (v4) |
| --- | ---: | ---: | ---: |
| Leak `incorrect-answer-remediation` | 2/5 | 0/5 | 0/5 |
| Leak `strong-answer-progression` | 1/5 (qualitativ) | 0/5 | 0/5 |
| Leak `partial-answer-follow-up` | 0/5 | 1/5 | 1/5 |
| Leaks gesamt (3 Cases) | 3/15 | 1/15 | 1/15 |
| Relativierung korrekter Antwort, `strong-answer-progression` | 0/5 | **4/5** | 0/5 |
| Ratings `strong-answer-progression` | 4, 5, 5, 5, 5 | 3, 5, 2, 3, 2 | 5, 4, 4, 5, 5 |
| Ratings `incorrect-answer-remediation` | 2, 2, 2, 2, 2 | 2, 1, 2, 2, 1 | 2, 1, 2, 2, **5** |
| Ratings `partial-answer-follow-up` | 2, 2, 2, 2, 2 | 2, 2, 2, 2, 2 | 1, 2, 1, 2, 1 |

- Prompt v4 behebt die Nebenwirkung von v3: `strong-answer-progression` ist mit
  Ratings und Wortlaut wieder auf dem Stand von B (0/5 Relativierung). Der Leak-Fix aus v3
  bleibt in den Cases mit Literal erhalten (0 Treffer für `counter = 3`).
- Der Leak in `partial-answer-follow-up` (Eintrag 09, Folgefrage mit `counter += 1;`) tritt
  weiter auf, wird aber jetzt vom Literal und vom Judge erkannt (siehe 3).
- Die Einzelzahlen sind klein; ein Unterschied von 1 Sample ist kein Beleg.

## 3. Judge und Literal gegen Referenz

| Kriterium / Check | D: Fälle | Referenz verletzt | Recall | Spezifität |
| --- | ---: | ---: | ---: | ---: |
| `no-solution-revealed` (Judge) | 15 | 1 | 1/1 | 14/14 |
| `no-unneeded-qualification` (Judge, `strong-answer-progression`) | 5 | 0 | – | 5/5 |
| Literal `counter += 1` (`partial-answer-follow-up`) | 5 | 1 | 1/1 | 4/4 |
| Literal `counter = 3` (`incorrect-…`, `strong-…`) | 10 | 0 | – | 10/10 |

Über B, C und D zusammen stimmen die beiden Judge-Kriterien in 59 von 60 Fällen mit der
Referenz überein (`no-unneeded-qualification` 20 von 20, `no-solution-revealed` 39 von 40).
Der eine Fehler ist der falsch negative Fall aus C (Eintrag 15), den die Schärfung des
Kriteriums in v11 und das Literal in D abdecken. Das Literal fand das Leak in D unabhängig
vom Judge.

## 4. Neue Befunde in D

### 4.1 Rating 5 für eine klar falsche Antwort (Eintrag 11)

`incorrect-answer-remediation`, Sample 4: Die Antwort „Der Sketch gibt immer 99 aus“ erhält
Rating 5 mit dem Feedback „Der Wert wird beim Start korrekt ausgegeben; …“. In B und C
(zehn Samples) kam das nicht vor. **Weder Judge noch ein deterministischer Check haben es
gemeldet.** Der Case hat kein `answerRating`-Band, obwohl die SSOT genau dieses Beispiel
nennt (R-RAT-1: „a wrong answer must not be rated as correct“). Beobachtete Ratings der
Fälle in B, C, D: 2, 2, 2, 2, 2, 2, 1, 2, 2, 1, 2, 1, 2, 2, 5; ein Band `[1, 2]` hätte
genau diesen einen Fall deterministisch erfasst. Ob Prompt v4 die Ursache ist, lässt sich
mit 1 Ereignis in 15 Samples nicht sagen.

### 4.2 Falsche Zusage im Feedback (Eintrag 04)

Derselbe Case, Sample 2: „Der Anfangswert von `counter` ist korrekt erkannt…“ bei der
Antwort „99“. Rating 2, aber der Text behauptet Richtiges. Der Judge hat es als kritisches
Problem `factually-wrong-feedback` gemeldet (kein Kriterium, vereinzelt = `warn`); die
Referenz bewertet den Eintrag als `schlecht` mit `falsch-bewertet`.

### 4.3 Nebenwirkungen, auf die ausdrücklich geachtet wurde

- Überkompensation („Richtig, und …“, übermäßiges Lob) bei `strong-answer-progression`:
  laut Referenz nicht aufgetreten.
- Übervorsicht (zu allgemeine Folgefrage): ein Fall, Eintrag 03, „akzeptabel“. Es ist eine
  Application-Fallback-Antwort (ersetzte wiederholte Frage), kein Modelleffekt von v4.

## 5. Einordnung

Prompt v4 erreicht, was beabsichtigt war: weniger Leaks als in B, keine Relativierung
korrekter Antworten mehr. Offen sind zwei vereinzelte Befunde in `incorrect-answer-
remediation` (Rating 5 und falsche Zusage), die mit der heutigen Messung nur über einen
Zufallstreffer des Judge sichtbar wurden, und der Leak in `partial-answer-follow-up`.
Dass sie mit v4 zusammenhängen, ist nicht belegt; B und C haben dafür 0 von 10 bzw. 0 von
10 Samples.

## 6. Offene Entscheidungen

1. Corpus v12 mit `answerRating: [1, 2]` für `incorrect-answer-remediation`, damit eine
   Bewertung 3 bis 5 einer klar falschen Antwort deterministisch auffällt (R-RAT-1/R-RAT-4).
2. Ein weiterer Lauf, um zu prüfen, ob Eintrag 11 Varianz oder ein v4-Effekt ist (zum
   Beispiel nur `incorrect-answer-remediation` mit 10 Samples: 1 + 10 × (2 + 1) = 31 Calls).
3. Prompt-PR (v3 + v4) erst nach Entscheidung zu 1 und 2 zur Prüfung freigeben.
4. Modellvergleich für `TQ-SEM-001` bleibt offen (32 Calls).
