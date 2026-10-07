# Menschliche Bewertung Punkt A – Freetutor-Baseline

- Run: `tq2a-20261006T172936116Z-db0b848f-39f7-4a7b-b8ae-7ccc40532c20` (Corpus v8, `openai-gpt5.4-mini`, `tutor-prompts-v2`, 5 Samples, ohne Judge, 41 Calls)
- Bewertungsregeln: `docs/UNOSIM_FREETUTOR_QUALITY_PLAN.md` §3.1 (eingefroren vor der Bewertung)
- Bewertet am 2026-10-06 von der Projektleitung. Hinweis zur Blindheit: Der Schlüssel Eintrag → Case wurde vor Abschluss der Bewertung geöffnet; Eintrag 02 wurde nach einer Konsistenzprüfung von „gut“ auf „schlecht“ korrigiert.
- Rohtranskripte liegen nur lokal (nicht im Repo). `Quelle` zeigt, ob die Antwort vom Modell (`provider`) oder von der Anwendung (`application-fallback`) stammt.

Verteilung: 12 gut, 3 akzeptabel, 10 schlecht.

| Eintrag | Case | Sample | Quelle | Urteil | Tags | Grund |
|---:|---|---:|---|---|---|---|
| 01 | incorrect-answer-remediation | 3 | provider | gut | – | Korrigiert die falsche Antwort, ohne die Lösung vorzugeben, und lenkt gezielt zur relevanten Programmstelle. |
| 02 | incorrect-answer-remediation | 0 | provider | schlecht | lösung-verraten | Die Folgefrage nennt mit `int counter = 3;` den gesuchten Wert bereits explizit; die Lernleistung reduziert sich auf Ablesen. (Zunächst als „gut“ bewertet, nach Konsistenzprüfung korrigiert.) |
| 03 | off-topic-answer | 2 | application-fallback | schlecht | ablenkend | Die „philosophische“ Formulierung ist unnötig verspielt und führt nur sehr indirekt zur Aufgabe zurück. |
| 04 | strong-answer-progression | 0 | application-fallback | gut | – | Richtige Antwort wird klar bestätigt; die Folgefrage führt sinnvoll weiter. |
| 05 | off-topic-answer | 3 | application-fallback | schlecht | ablenkend | Wie 03: unnötig abstrakter Kommentar statt kurzer, klarer Rückführung zum Sketch. |
| 06 | off-topic-answer | 0 | application-fallback | schlecht | ablenkend | Wie 03. |
| 07 | strong-answer-progression | 3 | application-fallback | gut | – | Richtige Antwort wird korrekt bestätigt und sinnvoll weitergeführt. |
| 08 | partial-answer-follow-up | 3 | provider | gut | – | Erkennt, dass die Antwort zu allgemein ist, und führt passend zur konkreten Änderung in `loop()`. |
| 09 | partial-answer-follow-up | 4 | provider | gut | – | Fachlich sauber, differenziert die teilweise richtige Aussage und fragt gezielt nach der Schleifenwirkung. |
| 10 | TQ-SEM-001 | 4 | provider | schlecht | relativiert-korrekt, falsch-bewertet | „GND an Pin 2“ beschreibt bei `INPUT_PULLUP` bereits die Einschaltbedingung; „Fast richtig“ und Rating 2 werten deutlich zu niedrig. |
| 11 | off-topic-answer | 1 | application-fallback | schlecht | ablenkend | Wie 03. |
| 12 | off-topic-answer | 4 | application-fallback | schlecht | ablenkend | Wie 03. |
| 13 | TQ-SEM-001 | 3 | provider | akzeptabel | relativiert-korrekt | Antwort inhaltlich richtig; „Fast richtig“ relativiert unnötig, die Folgefrage ist fachlich sinnvoll. |
| 14 | TQ-SEM-001 | 0 | provider | schlecht | relativiert-korrekt, falsch-bewertet, ablenkend | Richtige Einschaltbedingung wird unterbewertet; Ausweichen auf den ungedrückten HIGH-Zustand, obwohl nach dem Einschalten gefragt war. |
| 15 | strong-answer-progression | 4 | provider | gut | – | Richtige Antwort bestätigt; Folgefrage konkretisiert sinnvoll die beobachtbare Ausgabe. |
| 16 | TQ-SEM-001 | 1 | provider | akzeptabel | relativiert-korrekt | Aktiver LOW-Zustand wird erkannt und vertieft; „Fast richtig“ ist unnötig. |
| 17 | incorrect-answer-remediation | 2 | provider | gut | – | Korrigiert angemessen und lässt die lernende Person den Wert selbst bestimmen. |
| 18 | partial-answer-follow-up | 2 | provider | gut | – | Präzise Rückmeldung und sinnvolle Folgefrage zur Rolle von `counter` in der Schleife. |
| 19 | incorrect-answer-remediation | 1 | provider | akzeptabel | falsch-bewertet | Hilfreiche Korrektur; „Fast“ passt schlecht zur klar falschen Behauptung „immer 99“. |
| 20 | partial-answer-follow-up | 1 | provider | gut | – | Gute Rückmeldung auf die unvollständige Antwort, ohne die Lösung vorwegzunehmen. |
| 21 | strong-answer-progression | 2 | provider | gut | – | Richtige Antwort bestätigt und auf den konkreten Wert zugespitzt. |
| 22 | incorrect-answer-remediation | 4 | provider | schlecht | lösung-verraten | Die Folgefrage enthält mit `int counter = 3;` die gesuchte Lösung bereits explizit. |
| 23 | strong-answer-progression | 1 | provider | gut | – | Korrekte Bestätigung und einfache, passende Konkretisierung. |
| 24 | TQ-SEM-001 | 2 | provider | schlecht | relativiert-korrekt, falsch-bewertet | Antwort nennt bereits die richtige physische Bedingung; „Fast richtig“ und Rating 3 unterschätzen sie. |
| 25 | partial-answer-follow-up | 0 | provider | gut | – | Saubere Rückmeldung auf die zu allgemeine Antwort und sinnvolle Frage nach dem ersten Schleifendurchlauf. |
