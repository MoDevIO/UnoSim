# Referenzbewertung Punkt E – Klärungslauf incorrect-answer-remediation (verdeckt)

- Run: `tq2a-20261007T072914991Z-bde03457-1b9c-43f8-9c04-dcc955bfacf1` (Corpus v12, Prompt `tutor-prompts-v4`, `openai-gpt5.4-mini`, Judge `openai-gpt5.5`, 10 Samples, 31 Calls; Integrationsbranch `wip/freetutor-rerun-v12-prompts-v4`, lokal)
- **Provenienz:** Referenzbewertung durch einen LLM-Evaluator (nach Angabe der Projektleitung GPT-5.6 Sol), von der Projektleitung als Referenz freigegeben. Keine unabhängige menschliche Bewertung.
- **Blindheit:** bewertet allein anhand des Bewertungsblatts, ohne Judge-Ergebnis, Run-Verdict, Quelle und Schlüssel. Keine Post-hoc-Korrektur. Regeln wie in Punkt A.
- Kriterienfrage `no-solution-revealed`: `ja` = erfüllt.

Verteilung Gesamturteil: {'akzeptabel': 4, 'gut': 5, 'schlecht': 1}. Kriterienfrage: 10 ja.

| Eintrag | Case | Sample | Quelle | Urteil | Tags | no-solution-revealed | Grund |
|---:|---|---:|---|---|---|---|---|
| 01 | incorrect-answer-remediation | 2 | provider | akzeptabel | falsch-bewertet | ja | Die Antwort „99“ ist klar falsch. „Fast, aber nicht korrekt“ korrigiert sie zwar, relativiert den Fehler aber unnötig; Rating 2 ist noch plausibel. Die Folgefrage verrät den Wert nicht. |
| 02 | incorrect-answer-remediation | 1 | provider | gut | – | ja | Die falsche Antwort wird klar zurückgewiesen; Feedback und Folgefrage führen zur relevanten Stelle, ohne den Wert vorzugeben. |
| 03 | incorrect-answer-remediation | 3 | provider | akzeptabel | – | ja | Inhaltlich führt der Tutor korrekt zur Deklaration zurück und verrät nichts. „Nicht ganz“ ist für die klar falsche 99-Antwort etwas zu weich formuliert, ohne die Bewertung wesentlich zu verfälschen. |
| 04 | incorrect-answer-remediation | 5 | provider | gut | – | ja | Die 99 wird ausdrücklich verworfen; die Folgefrage lässt den tatsächlichen Wert selbst aus der Deklaration bestimmen. |
| 05 | incorrect-answer-remediation | 4 | provider | gut | – | ja | Die falsche Antwort wird eindeutig korrigiert und der relevante Ursprung des Werts genannt, ohne die Lösung selbst vorzugeben. |
| 06 | incorrect-answer-remediation | 9 | provider | akzeptabel | – | ja | Fachlich ist die Rückführung korrekt und die Folgefrage verrät nichts. „Nicht ganz“ untertreibt jedoch, dass 99 als Ausgabewert klar falsch ist. |
| 07 | incorrect-answer-remediation | 7 | provider | akzeptabel | falsch-bewertet | ja | Der Tutor stellt klar, dass der genannte Wert falsch ist, aber „Fast richtig“ suggeriert bei der Antwort 99 eine unangebrachte Nähe zur richtigen Lösung. Rating 2 selbst ist plausibel. |
| 08 | incorrect-answer-remediation | 8 | provider | schlecht | falsch-bewertet | ja | Die Antwort 99 ist klar falsch, trotzdem behandelt das Feedback sie so, als sei im Wesentlichen nur die Begründung unvollständig. Rating 3 ist zu hoch und die Rückmeldung korrigiert den falschen Wert nicht klar. |
| 09 | incorrect-answer-remediation | 0 | provider | gut | – | ja | Die falsche Antwort wird eindeutig zurückgewiesen; die Folgefrage führt zur richtigen Programmstelle, ohne den Wert zu nennen. |
| 10 | incorrect-answer-remediation | 6 | provider | gut | – | ja | Feedback und Folgefrage lenken präzise auf die Deklaration und geben den gesuchten Wert nicht vor. Rating 1 passt zur klar falschen Antwort. |
