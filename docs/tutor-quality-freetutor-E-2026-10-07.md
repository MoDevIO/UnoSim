# Tutor Quality – Freetutor, Punkt E (Klärungslauf `incorrect-answer-remediation`)

Status: Auswertung, **nicht normativ**. Rohartefakte liegen nur lokal unter
`.tutor-quality-output/freetutor-E-2026-10-07/`. Die verdeckte Referenzbewertung steht in
`evals/tutor-quality/human-ratings/freetutor-E-2026-10-07.md`; sie stammt von einem
LLM-Evaluator, nicht von einer Person. Vorläufer:
`docs/tutor-quality-freetutor-D-2026-10-07.md` (dort steht die vorab festgelegte
Entscheidungsregel).

## 1. Lauf

| Merkmal | Wert |
| --- | --- |
| Run-ID | `tq2a-20261007T072914991Z-bde03457-1b9c-43f8-9c04-dcc955bfacf1` |
| Prompt / Corpus | `tutor-prompts-v4` / v12 (neu: `answerRating: [1, 2]`) |
| Tutor / Judge | `openai-gpt5.4-mini` / `openai-gpt5.5` |
| Case, Samples | `incorrect-answer-remediation`, 10 |
| Calls | 31 / 31 (11 Modellliste, 10 Generierung, 10 Judge) |
| Status, Urteil | `completed`; `qualityVerdict` **`warn`** (ein Befund, unter der Schwelle k = 6) |

Der Lauf zeigt, ob das Verhalten unter Prompt v4 wiederholt auftritt. Er zeigt nicht, ob v4
es verursacht; dafür bräuchte es einen kontrollierten Vergleich.

## 2. Ergebnis nach der vorab festgelegten Regel

- Klar falsch bewertete Fälle (Rating 3 bis 5 oder Textfehler laut Referenz): **1 von 10**
  (Eintrag 08, Sample 8: Rating 3, „Der Wert wird in `setup()` korrekt gelesen; die
  Begründung stimmt noch nicht“, die Antwort „99“ wird nicht klar korrigiert). Referenz:
  `schlecht`, `falsch-bewertet`.
- Rating-Band `[1, 2]` (deterministisch): genau dieser eine Fall verletzt es
  (`final-tutor/answer-rating-out-of-band`, Sample 8). Die anderen neun Ratings liegen bei
  1 oder 2. Das Band stimmt mit der Referenz überein.
- Judge `no-solution-revealed`: 10 von 10 `pass`, Referenz 10 von 10 `ja`, kein Leak.
  Keine kritischen Probleme des Judge.
- Nach der Regel: **1 von 10 = selten, kein automatischer Merge-Blocker, als Restrisiko zu
  dokumentieren.**

## 3. Einordnung und Grenzen

- **Weichmacher im Text:** Die Referenz bewertet vier weitere Einträge als „akzeptabel“,
  weil „Fast …“ oder „Nicht ganz …“ die klar falsche Antwort 99 unnötig abschwächen
  (Einträge 01, 03, 06, 07; 01 und 07 mit Tag `falsch-bewertet`). Das sind keine Fälle
  von Rating 3 bis 5 und nach der Regel keine „klar falsch bewerteten“ Fälle. Wer
  den Textweichmacher mitzählt, käme auf mehr als 2 von 10; die Regel wurde vorab für
  „klar falsch bewertet“ formuliert, und die Referenz selbst zählt diese vier nicht dazu.
  Das ist eine Auslegungsfrage, die die Projektleitung entscheidet.
- **Gesamtbild unter Prompt v4 für diesen Case** (Referenz, D und E zusammen, 15 Samples):
  Rating 5 (D, Eintrag 11), Rating 3 (E, Eintrag 08) und die falsche Zusage „korrekt
  erkannt“ (D, Eintrag 04) sind drei Ereignisse, das sind 3 von 15. In B und C (v2 und v3)
  gab es keines (0 von 10). Dieser Unterschied ist nicht signifikant (Fisher exakt,
  zweiseitig, p ≈ 0,25) und die Ereignisse sind verschiedener Art. Er stützt die
  Annahme, dass v4 die Wahrscheinlichkeit erhöht, **nicht** und widerlegt sie nicht.
- **Messung:** Das neue Band hätte zwei der drei Ereignisse deterministisch gefunden
  (Rating 5 und 3); die falsche Zusage im Text (Eintrag 04 aus D) findet es nicht.
- Stichprobe: ein Modell, Temperatur 0,2, 10 Samples; keine Aussage über andere Modelle.

## 4. Offene Entscheidung

Merge-Freigabe für Prompt v3 + v4 (`fix/tutor-prompt-no-answer-in-question`): Nach der
vorab festgelegten Regel ist das Restrisiko dokumentiert und kein Blocker. Zu entscheiden
bleibt die Auslegung der Weichmacher aus Abschnitt 3 und ob 3 von 15 gegenüber 0 von 10
als Warnsignal gelesen wird.
