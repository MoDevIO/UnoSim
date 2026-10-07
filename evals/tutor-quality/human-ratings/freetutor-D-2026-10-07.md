# Referenzbewertung Punkt D – Freetutor-Nachlauf nach Prompt v4 (verdeckt, mit Kriterienfragen)

- Run: `tq2a-20261007T070948306Z-e6f53e88-e561-490e-aac9-27adcf4fb102` (Corpus v11, Prompt `tutor-prompts-v4`, `openai-gpt5.4-mini`, Judge `openai-gpt5.5`, 5 Samples, 46 Calls; Integrationsbranch `wip/freetutor-rerun-v11-prompts-v4`, lokal)
- **Provenienz:** Referenzbewertung durch einen LLM-Evaluator (nach Angabe der Projektleitung GPT-5.6 Sol), von der Projektleitung als Referenz freigegeben. Keine unabhängige menschliche Bewertung.
- **Blindheit:** bewertet allein anhand des Bewertungsblatts, ohne Judge-Ergebnis, Run-Verdict, Quelle und Schlüssel. Keine Post-hoc-Korrektur. Zusätzlich beachtet: Überkompensation und Übervorsicht bei `strong-answer-progression`. Regeln wie in Punkt A.
- Kriterienfragen: `ja` = erfüllt, `nein` = verletzt.

Verteilung Gesamturteil: {'gut': 11, 'akzeptabel': 1, 'schlecht': 3}. Kriterienfragen: 19 ja, 1 nein.

| Eintrag | Case | Sample | Quelle | Urteil | Tags | Kriterien | Grund |
|---:|---|---:|---|---|---|---|---|
| 01 | incorrect-answer-remediation | 1 | provider | gut | – | no-solution-revealed=ja | Die klar falsche 99-Antwort wird angemessen korrigiert. Die Folgefrage führt gezielt zur Deklaration, ohne den gesuchten Wert vorzugeben. |
| 02 | partial-answer-follow-up | 1 | provider | gut | – | no-solution-revealed=ja | Die Antwort wird passend als zu allgemein eingeordnet; die Folgefrage lenkt konkret auf die Rolle von counter in loop(), ohne die Lösung zu nennen. |
| 03 | strong-answer-progression | 0 | application-fallback | akzeptabel | – | no-solution-revealed=ja, no-unneeded-qualification=ja | Die korrekte Antwort wird eindeutig bestätigt und nicht relativiert. Die Folgefrage verrät nichts, ist aber recht allgemein und stößt nur einen schwach konkreten nächsten Denkschritt an. |
| 04 | incorrect-answer-remediation | 2 | provider | schlecht | falsch-bewertet | no-solution-revealed=ja | Die Lernendenantwort nennt 99, trotzdem behauptet das Feedback, der Anfangswert von counter sei korrekt erkannt. Das ist eine sachlich falsche Bewertung der gegebenen Antwort; die Folgefrage selbst verrät den Wert nicht. |
| 05 | strong-answer-progression | 2 | provider | gut | – | no-solution-revealed=ja, no-unneeded-qualification=ja | Die richtige Antwort wird klar bestätigt. Die Folgefrage vertieft sinnvoll zum konkreten Wert, ohne ihn selbst zu nennen. |
| 06 | partial-answer-follow-up | 3 | provider | gut | – | no-solution-revealed=ja | Der richtige Teil der Antwort wird anerkannt und die fehlende Beziehung zur Schleife klar benannt. Die Folgefrage bleibt konkret, ohne die Lösung vorwegzunehmen. |
| 07 | incorrect-answer-remediation | 3 | provider | gut | – | no-solution-revealed=ja | Die falsche Antwort wird eindeutig korrigiert. Die Folgefrage verweist auf den Ausdruck in setup und lässt die lernende Person den Zusammenhang selbst bestimmen. |
| 08 | strong-answer-progression | 1 | provider | gut | – | no-solution-revealed=ja, no-unneeded-qualification=ja | Die korrekte Antwort wird ohne Relativierung bestätigt; die Folgefrage fordert einen konkreten neuen Denkschritt zur Anzahl der Ausführungen. |
| 09 | partial-answer-follow-up | 4 | provider | schlecht | lösung-verraten | no-solution-revealed=nein | Die Folgefrage zitiert mit `counter += 1;` genau den Code-Ausdruck, aus dem der gesuchte Zusammenhang zur Schleife unmittelbar abgelesen werden kann. |
| 10 | incorrect-answer-remediation | 0 | provider | gut | – | no-solution-revealed=ja | Die 99 wird klar verworfen, ohne den tatsächlichen Wert zu nennen. Die Folgefrage führt auf die relevante Stelle in setup. |
| 11 | incorrect-answer-remediation | 4 | provider | schlecht | falsch-bewertet | no-solution-revealed=ja | Die Lernendenantwort ist klar falsch, wird aber mit Rating 5 bewertet. Das widerspricht der fachlichen Qualität der Antwort deutlich; die Folgefrage selbst verrät den Wert nicht. |
| 12 | strong-answer-progression | 3 | provider | gut | – | no-solution-revealed=ja, no-unneeded-qualification=ja | Die korrekte Antwort wird klar bestätigt und die Folgefrage fragt nach einem konkreten Wert, ohne ihn vorzugeben. |
| 13 | strong-answer-progression | 4 | provider | gut | – | no-solution-revealed=ja, no-unneeded-qualification=ja | Die korrekte Antwort wird ohne unnötige Relativierung bestätigt; die Folgefrage bleibt konkret und verrät den Wert nicht. |
| 14 | partial-answer-follow-up | 0 | provider | gut | – | no-solution-revealed=ja | Die Antwort wird als unzureichend für die gestellte Beziehungsfrage eingeordnet; die Folgefrage fordert genau den fehlenden Zusammenhang, ohne ihn zu nennen. |
| 15 | partial-answer-follow-up | 2 | provider | gut | – | no-solution-revealed=ja | Die fehlende Rolle von counter im Ablauf wird präzise benannt; die Folgefrage bleibt konkret und verrät die Schleifenwirkung nicht. |
