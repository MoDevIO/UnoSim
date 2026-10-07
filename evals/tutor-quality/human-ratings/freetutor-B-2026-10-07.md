# Referenzbewertung Punkt B – Freetutor (verdeckt, mit Kriterienfragen)

- Run: `tq2a-20261007T062850800Z-65da2858-f7d6-4603-88ef-430564158fde` (Corpus v9, `openai-gpt5.4-mini`, `tutor-prompts-v2`, Judge `openai-gpt5.5`, 5 Samples, 61 Calls)
- **Provenienz:** Referenzbewertung durch einen LLM-Evaluator (nach Angabe der Projektleitung GPT-5.6 Sol), von der Projektleitung als Referenz freigegeben. Keine unabhängige menschliche Bewertung (siehe `freetutor-baseline-A-2026-10-06.md`).
- **Blindheit:** bewertet allein anhand des Bewertungsblatts, ohne Judge-Ergebnis, Schlüssel und Quelle. Regeln für Gesamturteil und Tags wie in Punkt A.
- Kriterienfragen: `ja` = erfüllt, `nein` = verletzt.
- **Post-hoc-Korrektur (2026-10-07):** Eintrag 16, `no-false-claim`, wurde von `ja` auf `nein` korrigiert, **nachdem** das Judge-Ergebnis bekannt war. Das Feedback „Der Zustandswechsel am Taster ist der entscheidende Punkt“ ist technisch irreführend (der Sketch reagiert auf den aktuellen LOW-Pegel). Für `no-false-claim` ist diese Referenz deshalb keine unabhängige Blindkalibrierung. Alle anderen Urteile sind unverändert blind.

Verteilung Gesamturteil: {'gut': 12, 'schlecht': 7, 'akzeptabel': 1}. Kriterienfragen: 27 ja, 8 nein (nach der Post-hoc-Korrektur; blind waren es 28 ja, 7 nein).

| Eintrag | Case | Sample | Quelle | Urteil | Tags | Kriterien | Grund |
|---:|---|---:|---|---|---|---|---|
| 01 | partial-answer-follow-up | 4 | provider | gut | – | no-solution-revealed=ja | Die unvollständige Antwort wird passend eingeordnet; die Folgefrage lenkt auf die konkrete Änderung in loop(), ohne sie vorwegzunehmen. |
| 02 | strong-answer-progression | 0 | application-fallback | gut | – | no-unneeded-qualification=ja | Die korrekte Antwort wird klar bestätigt und sinnvoll weitergeführt. |
| 03 | partial-answer-follow-up | 2 | provider | gut | – | no-solution-revealed=ja | Die Lücke der Antwort wird präzise benannt; die Folgefrage verlangt einen eigenen Denkschritt und verrät die Schleifenwirkung nicht. |
| 04 | incorrect-answer-remediation | 1 | provider | schlecht | lösung-verraten | no-solution-revealed=nein | Die Folgefrage enthält mit `int counter = 3;` den gesuchten Ausgabewert bereits unmittelbar; die Lernleistung reduziert sich auf Ablesen. |
| 05 | partial-answer-follow-up | 0 | provider | gut | – | no-solution-revealed=ja | Die teilweise richtige Aussage wird angemessen eingeordnet; die Folgefrage führt zur Schleifenwirkung, ohne `+1` oder das Ergebnis vorzugeben. |
| 06 | incorrect-answer-remediation | 0 | provider | schlecht | lösung-verraten | no-solution-revealed=nein | Die Folgefrage nennt in `int counter = 3;` den gesuchten Anfangswert bereits explizit. |
| 07 | TQ-SEM-001 | 0 | provider | schlecht | relativiert-korrekt, falsch-bewertet | accepts-correct-answer=ja, no-false-claim=ja, distinct-followup=ja, no-unneeded-qualification=nein | Die Kernaussage der Lernendenantwort ist korrekt. „Fast richtig“ relativiert sie unnötig; Rating 2 bewertet sie deutlich zu niedrig. |
| 08 | strong-answer-progression | 4 | provider | schlecht | lösung-verraten | no-unneeded-qualification=ja | Die Folgefrage soll zum konkreten Wert weiterführen, nennt mit `int counter = 3;` aber bereits genau die gesuchte Information. |
| 09 | strong-answer-progression | 1 | application-fallback | gut | – | no-unneeded-qualification=ja | Die richtige Antwort wird ohne Relativierung bestätigt und die Folgefrage eröffnet einen weiteren Schritt. |
| 10 | TQ-SEM-001 | 1 | provider | schlecht | relativiert-korrekt, falsch-bewertet | accepts-correct-answer=ja, no-false-claim=ja, distinct-followup=ja, no-unneeded-qualification=nein | GND an Pin 2 beschreibt bei INPUT_PULLUP bereits die relevante Einschaltbedingung. „Fast richtig“ relativiert unnötig; Rating 3 ist zu niedrig. |
| 11 | strong-answer-progression | 3 | application-fallback | gut | – | no-unneeded-qualification=ja | Die Kernaussage wird eindeutig und ohne unnötige Einschränkung bestätigt. |
| 12 | incorrect-answer-remediation | 3 | provider | gut | – | no-solution-revealed=ja | Die falsche 99-Antwort wird korrigiert, ohne den Wert 3 zu nennen; die Folgefrage lässt ihn selbst aus dem Sketch bestimmen. |
| 13 | strong-answer-progression | 2 | provider | gut | – | no-unneeded-qualification=ja | Die korrekte Antwort wird klar bestätigt; die Folgefrage konkretisiert sinnvoll den Wert, ohne ihn vorzugeben. |
| 14 | partial-answer-follow-up | 3 | provider | gut | – | no-solution-revealed=ja | Die Antwort wird als knapp und unvollständig eingeordnet; die Folgefrage führt gezielt zur Schleifenwirkung, ohne die Lösung zu nennen. |
| 15 | TQ-SEM-001 | 4 | provider | schlecht | relativiert-korrekt, falsch-bewertet | accepts-correct-answer=ja, no-false-claim=ja, distinct-followup=ja, no-unneeded-qualification=nein | Die Antwort nennt die richtige physische Bedingung. Der Tutor erklärt den LOW-Zustand korrekt, relativiert aber unnötig mit „Fast richtig“; Rating 3 ist zu niedrig. |
| 16 | TQ-SEM-001 | 3 | provider | schlecht | relativiert-korrekt, falsch-bewertet | accepts-correct-answer=ja, no-false-claim=nein (post hoc), distinct-followup=ja, no-unneeded-qualification=nein | Die Lernendenantwort beschreibt die richtige Bedingung, wird aber nur als „Fast richtig“ behandelt und mit 3 zu niedrig bewertet. |
| 17 | incorrect-answer-remediation | 4 | provider | gut | – | no-solution-revealed=ja | Die falsche Antwort wird angemessen korrigiert; der gesuchte Wert wird nicht verraten, sondern über die relevante Programmstelle erschlossen. |
| 18 | TQ-SEM-001 | 2 | provider | akzeptabel | relativiert-korrekt | accepts-correct-answer=ja, no-false-claim=ja, distinct-followup=ja, no-unneeded-qualification=nein | Fachlich sind Feedback und Folgefrage passend und Rating 4 ist vertretbar; „Fast richtig“ relativiert die bereits richtige Kernaussage dennoch unnötig. |
| 19 | partial-answer-follow-up | 1 | provider | gut | – | no-solution-revealed=ja | Die Unvollständigkeit wird knapp benannt; die Folgefrage fordert eine eigene Ableitung und nennt die Schleifenwirkung nicht. |
| 20 | incorrect-answer-remediation | 2 | provider | gut | – | no-solution-revealed=ja | Die falsche 99-Antwort wird korrigiert, ohne den tatsächlichen Wert zu nennen; die Folgefrage verweist nur auf die relevante Stelle. |
