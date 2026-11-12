# Unabhängige Prüfung: Tutor-Testergänzungen

Stand: 2026-11-12, Branch `feature/tutor-test-completion`, Basis `c60eac9d8` (Merge PR #378), aktueller uncommitteter Working Tree einschließlich neuer Dateien. Geprüft gegen den [Arbeitsplan](../superpowers/plans/2026-11-11-tutor-test-completion.md) und [Sonnet-Auftrag](../superpowers/prompts/2026-11-11-tutor-test-completion-sonnet.md).

**Ergebnis: vor Commit als vollständig umgesetzter Auftrag nachbessern.** Drei wesentliche Lücken betreffen die Gültigkeit zweier Qualitätsproben und die Synchronisation eines Browsernachweises. Kein Critical-/Sicherheitsbefund am neuen Evaluator wurde festgestellt. Der Implementierungsbericht ist eine nachvollziehbare Selbstprüfung; seine grünen Läufe ersetzen diese fachlichen Gegenbeispiele nicht.

## 1. Belegte Stärken

- Die zentralen neuen Tests verwenden echte Services, Planer, Routen und Stores mit kontrollierten Providern. Die neue Client-/Browserabdeckung ergänzt diese technischen Regeln sinnvoll.
- Initialfragen sind ohne erfundene Lernendenantwort oder Rückmeldung beurteilbar. Grafikfokus ohne tatsächlich ausgeliefertes Mermaid führt ohne Judge-Aufruf zu `graphic-not-provided` und `inconclusive`.
- Der Judge bekommt tatsächlich ausgeliefertes Mermaid als vierte Zitatquelle; verworfene Providerentwürfe bleiben getrennt. Die Begrenzung auf ein exaktes Zitat innerhalb einer Quelle ist erhalten.
- Die Änderungen an bestehenden Tests betreffen die beauftragte Korpus-/Judge-Migration. Die Mehrheitsregel und die Exitcodes sind unverändert; die zusätzliche Sichtbarkeit schwerer Befunde ist nachvollziehbar.

## 2. Wesentliche Befunde

### A. Der Selbstkorrekturfall enthält für den Tutor die frühere Falschbehauptung nicht

Fundstellen: [anchor-corpus.yaml](../../evals/tutor-quality/anchor-corpus.yaml#L747), [Korpus-Historientyp](../../server/services/tutor/evaluation/anchor-corpus.ts#L18), [Regression](../../tests/server/services/tutor/evaluation/tutor-dialog-regressions.test.ts#L187).

`TQ-DICE-OBJECTION` verlangt unter `self-correction`, dass der Tutor eine frühere falsche Aussage ausdrücklich zurücknimmt. In der gesendeten Historie stehen jedoch nur Frage, Antwort `Keine.` und Bewertung 2. Die Behauptung, `show` gebe seriell aus, steht ausschließlich unter `judge.facts`. Diese Fakten werden dem Judge gegeben, nicht dem Tutor.

Der Hauptagent und die separate Prüfinstanz haben den tatsächlichen Providerinput unabhängig mit einem kontrollierten Provider durch den echten Runner geprüft. Ergebnis der Hauptagentenprobe:

```json
{
  "case": "TQ-DICE-OBJECTION",
  "providerRequests": 1,
  "historyFeedback": null,
  "earlierAttempts": "[{\"answer\":\"Keine.\"}]",
  "judgeAssumesEarlierFalseClaim": true,
  "requiresSelfCorrection": true
}
```

Damit misst der Fall nicht die vorgesehene Selbstkorrektur nach einer konkret bekannten falschen Rückmeldung. Ein Modell kann dem Einwand fachlich zustimmen und dennoch am vom Judge zusätzlich vorausgesetzten Zurücknehmen einer unsichtbaren Aussage scheitern.

Korrektur: Das frühere Feedback als begrenzten, validierten Inhalt der Evaluationshistorie übernehmen und nachweislich bis in den Providerprompt führen. Der Produktionsvertrag `TutorDialogTurn` unterstützt `feedback` bereits; `buildDialogPrompt` übernimmt es auch in die getrennten früheren schwachen Versuche. Ein Umbau des Produktdialogs ist dafür nicht nötig. Der Korpusloader/Materialisierung und die neue Regression müssen diesen tatsächlich verwendeten Kontext prüfen.

### B. Die positive Grafikprobe gibt bereits die abgefragte Aufrufkette vor

Fundstelle: [tutor-dialog-regressions.test.ts](../../tests/server/services/tutor/evaluation/tutor-dialog-regressions.test.ts#L255).

Die als „good: a graphic of the context only“ deklarierte Probe fragt nach der Funktionsreihenfolge nach einem Tastendruck und zeigt gleichzeitig `loop → run → show`. Damit zeigt sie gerade die wesentliche abgefragte Aufrufkette. Der Fake-Judge unterscheidet dagegen nur danach, ob das Diagramm `Lösung:` enthält. Die negative Grafik enthält weiterhin diese Kette mit einem zusätzlichen Serial-Text im letzten Label.

Das positive Beispiel ist somit kein belastbarer unabhängiger Beleg für „Kontext ohne Antwort“, und das Wort `Lösung:` allein trennt fachlich guten Kontext nicht von Lösungsverrat. Dass diese Fake-Regel mechanisch einen Befund erzeugen kann, ist belegt; die fachliche Eignung des Testpaares ist es nicht.

Korrektur: Eine eindeutige gemeinsame Frage und handgeprüfte Gegenbeispiele verwenden. Beispielsweise fragt „Welche Funktion wird in loop bei erfüllter Tasterbedingung direkt aufgerufen?“ eindeutig nach `run`. Eine Kontextgrafik kann die Bedingung und eine unbenannte Aktion darstellen; eine Grafik mit `run()` an der gesuchten Stelle verrät die Antwort auch ohne das Wort `Lösung`. Die Fake-Erwartungen müssen die bekannten Beispiele korrekt zuordnen; sie bleiben keine allgemeine semantische Bewertungsmaschine.

### C. LC-02 wartet nur auf den schon vor der Freigabe vorhandenen Aufrufzähler

Fundstellen: [Providerstart](../../e2e/tutor-mocked-lifecycle.spec.ts#L74), [LC-02](../../e2e/tutor-mocked-lifecycle.spec.ts#L275).

Nach `slow.release()` wartet der Test auf genau einen `calls`-Eintrag zur späten Antwort. Dieser Eintrag wird schon vor `await hold.gate` geschrieben und ist wegen des vorigen `await slow.started` bereits garantiert vorhanden. Die Wartebedingung synchronisiert also keinen neuen Zustand.

Die folgenden negativen DOM-Assertions können vor Abschluss der verspäteten Antwort passieren. Ein Fehler, der erst bei ihrer Zustellung beziehungsweise Verarbeitung sichtbar wird, muss den Test daher nicht zuverlässig scheitern lassen.

Korrektur: Einen expliziten Abschluss der gehaltenen Provider-/API-/Browserstrecke abwarten und erst danach den unveränderten Tutor prüfen. Bei absichtlich abgebrochener Browseranfrage Abbruch und Abschluss des serverseitigen Versuchs getrennt nachweisen. Ein bloßes `response`-Headerereignis oder ein neuer fester Sleep ersetzt keinen Verarbeitungsnachweis. Falls nötig einen zusätzlichen kontrollierten Hook-Test ergänzen, dessen Transport ein Abbruchsignal ignoriert und trotzdem spät erfüllt wird; so lässt sich auch der Schutz gegen wirklich verarbeitbare verspätete Ergebnisse beweisen.

## 3. Kleinere Planabweichung

[tutor-mocked-dialog.routes.test.ts](../../tests/server/routes/tutor-mocked-dialog.routes.test.ts#L64) bezeichnet den Fake als strikt, behandelt aber jeden sonstigen Prompt als Erklärung und liefert unbegrenzt zyklische Standardantworten. Aufrufzahlen werden in vielen, jedoch nicht allen relevanten Fällen ausdrücklich geprüft. Der Implementierungsbericht benennt diese Grenze; der Auftrag verlangte ausdrücklich das Scheitern unerwarteter weiterer Generierungen.

Erlaubte Aufrufarten/-anzahlen oder ein begrenztes Script ergänzen und unbekannte Prompts ablehnen. Dabei legitime begrenzte Wiederholungen explizit einplanen. Keine fremde Produktfunktion für den Fake austauschen.

## 4. Frische Prüfungen und Reichweite

Durch den Hauptagenten:

- `npm run test:unit` mit erlaubten lokalen IPC-/Loopback-Sockets: **App 4.540 bestanden / 1 übersprungen; Emulator 697 bestanden**. Exitcode 0; Laufzeit App etwa 40 s, Emulator etwa 8 s.
- `npm run check`: Exitcode 0, die vier konfigurierten TypeScript-Prüfungen bestanden.
- `npm run check:docs` und `git diff --check`: vor diesen Berichtsergänzungen bestanden; die Dokumente werden anschließend erneut geprüft.
- Kontrollierte Runnerprobe zu A, ohne Netzwerk oder echte Modelle.

Durch die separate read-only-Prüfinstanz:

- Judge-, erweiterte Evidenz- und Korpus-Suites: **143 Tests bestanden**.
- Selektierte Einwands-, Grafik- und Severe-Findings-Tests: **18 bestanden**, 10 wegen des Auswahlfilters nicht ausgeführt.
- Eigene kontrollierte Providerinput-Probe zu A.
- Ein zusätzlicher vollständiger fokussierter HTTP-Lauf scheiterte in der eingeschränkten Prüfumgebung an lokalen Socketrechten (`listen EPERM`). Die erfolgreiche vollständige Unit-Suite des Hauptagenten lief mit erlaubten Sockets. Der Umgebungsfehler ist kein Produktbefund.

Keine echten Tutor-/Judge-Anfragen. Browserlauf, Build, Coverage und Sonar wurden in dieser unabhängigen Prüfung nicht erneut vollständig ausgeführt; deren Implementierungsnachweise bleiben entsprechend gekennzeichnet. Die Feststellungen B und C folgen aus den konkreten Testdaten und der Reihenfolge im Test, nicht aus einem behaupteten neuen Modell- oder Browserfehlschlag. Produktcode und vorhandene Tests wurden bei dieser Prüfung nicht verändert.

## 5. Konsequenz

Kein Commit als vollständig abgenommene Testergänzung und keine Git-Integration in diesem Prüflauf. Der [gezielte Nachbesserungsauftrag](../superpowers/prompts/2026-11-12-tutor-test-completion-corrections-sonnet.md) schließt A–C und die kleinere Fake-Abweichung, ohne die bereits belegte Umsetzung erneut aufzubauen. Danach fokussiert nachprüfen und erst bei geschlossenem Befundstand die Commitentscheidung erneuern.

## 6. Nachbesserung

Stand: 2026-11-12, gleicher Branch, weiterhin uncommittet. Umgesetzt nach dem [Nachbesserungsauftrag](../superpowers/prompts/2026-11-12-tutor-test-completion-corrections-sonnet.md) durch den implementierenden Agenten. Die Befunde in Abschnitt 2 und 3 bleiben als historischer Stand erhalten. Dies ist **keine** erneute unabhängige Prüfung. Modellbudget: 0 Calls.

| Befund | Geschlossener Datenweg beziehungsweise Nachweis | Gegenprobe (Schutz kurz deaktiviert, danach bytegenau wiederhergestellt) |
| --- | --- | --- |
| A Selbstkorrektur | Korpus `history[].feedback` → `parseHistory` (nicht leer, höchstens `INPUT_LIMITS.tutor.maxFeedbackChars` = 1000 Zeichen, fremde Felder abgelehnt) → `historyEntry` im Loader (übernahm `feedback` bisher nicht) → `TutorDialogTurn` → `tutorDialogTurnSchema.parse` im Service → `buildDialogPrompt` gibt sie im Block „Frühere Versuche zur aktuellen Frage“ ohne Bewertung weiter. `TQ-DICE-OBJECTION` sendet die synthetische Falschbehauptung als Feedback; der Judge-Fakt zitiert sie wörtlich (Korpus v17). Der Test mit echtem Loader und Runner prüft den aufgezeichneten Tutorprompt: frühere Rückmeldung vorhanden, bewerteter Verlauf leer, kein `answerRating: 2`, aktuelle Frage und Antwort vorhanden. Gegenseite: Ohne Historien-Feedback steht keine frühere Behauptung im Prompt, und ein korpusweiter Test verlangt für jeden Fakt über eine frühere Rückmeldung das wörtlich gesendete Feedback. | A1 Loader ohne `feedback`: 2 rot; A2 Grenzprüfung aus: 3 rot; A3 fremde Felder zugelassen: 1 rot; A4 schwache Bewertung im bewerteten Verlauf (`tutor-service.ts`): 1 rot |
| B Grafikpaar | Eine Frage mit eindeutiger Antwort: „Welche Funktion wird in loop bei erfüllter Tasterbedingung direkt aufgerufen?“ (`run`, am Sketch geprüft). Die Kontextgrafik zeigt Bedingung und unbenannte Aktion. Die verratende Grafik nennt `C["run()"]` am gefragten Knoten, ohne „Lösung“, und unterscheidet sich nur dort. Beide bestehen die echte Mermaid-Prüfung und werden unverändert ausgeliefert und als `tutor.mermaid` beurteilt. Befund genau `criterion/context-without-answer` mit Zitat `C["run()"]`. Die Fake-Regel ist ausdrücklich nur für dieses Paar gedacht. Fehlende Grafik bleibt `inconclusive`. | B1 alte Präfixregel (`Lösung:`) zusätzlich verlangt: 1 rot (die verratende Grafik ginge durch) |
| C LC-02 | E2E: Der Browser meldet für die gehaltene Anfrage genau `failed: net::ERR_ABORTED` und kein `finished`. Nach `release()` wartet der Test auf den Routenabschluss dieser Anfrage mit Providerantwort `finish`, API-Status 200 und beendetem `route.fulfill`. Erst danach prüft er den Tutorzustand. Es gibt keinen Sleep und kein Warten auf ein Response-Ereignis, das bei einem korrekten Abbruch nicht kommen kann. Weil der Browserpfad durch den Abbruch geschützt ist, kam der Hooktest `tests/client/tutor-late-dialog-answer.test.tsx` hinzu: Der Transport ignoriert das Abbruchsignal und erfüllt spät mit einer gültigen Antwort, der Body wird nachweislich gelesen, und Frage, Verlauf, Transkript und Fehler des neuen Kontexts bleiben unverändert. | C1 `if (signal.aborted) return null` in `postDialogAnswer` entfernt: Hooktest rot; C2 Abbruch in `abortPendingTutorRequests` entfernt (Client neu gebaut): LC-02 rot (`finished` statt `ERR_ABORTED`) |
| SD-Fake | Er erkennt nur die vier Produktionsprompts (Initialfrage, Dialog, Klärung, Hinweis) und hat je Test einen expliziten Aufrufplan. Ein Aufruf über den Plan oder unbekannter Art wird abgelehnt und als Verstoß erfasst; nach jedem Test müssen die Aufrufe exakt dem Plan entsprechen. Das Erklärungsskript ist begrenzt und hat keine zyklische Wiederholung. Dieselbe Strenge gilt für den gestubbten Modellendpunkt in SD-02 und den Provider in SD-05. Positive und negative Kontrollen stehen in „the strict provider fake itself“. | D1 Planprüfung aus: 1 rot; D2 unbekannte Art als Klärung behandelt: 1 rot |

Ergebnisse der Prüfläufe nach der Nachbesserung stehen im [Arbeitsbericht, Abschnitt 13](report-tutor-test-completion.md#13-nachbesserung-am-2026-11-12).

## 7. Unabhängige Nachprüfung der Korrekturen

Stand: 2026-11-12, gleicher Branch und Basiscommit `c60eac9d8`. Der koordinierende Agent und eine frische separate Prüfinstanz haben die Korrekturen unabhängig von der Implementierung nachgeprüft. **A, B, C und die SD-Fake-Abweichung sind geschlossen. Keine verbleibenden Critical-/Important-Befunde im geprüften Umfang; der Stand ist commitfähig.** Die historischen Feststellungen in Abschnitt 2 und 3 beziehen sich auf die Fassung vor der Nachbesserung.

| Befund | Unabhängig geprüfter Abschluss |
| --- | --- |
| A | Der Korpus begrenzt und validiert `history[].feedback`; der Loader übernimmt es. Die Regression über den echten Loader und Runner prüft den tatsächlichen Tutorprompt: frühere Falschbehauptung vorhanden, frühere schwache Bewertung getrennt, aktuelle Frage und Antwort korrekt. Die Gegenseite ohne Feedback ist ebenfalls geprüft. |
| B | Die gemeinsame Frage sucht eindeutig `run`. Das Kontextdiagramm nennt die Aktion nicht; das verratende Diagramm unterscheidet sich durch `C["run()"]`, ohne „Lösung“-Präfix. Die bekannte Paarung ist fachlich passend, beide Diagramme werden unverändert ausgeliefert, der Befund ist richtig zugeordnet. |
| C | LC-02 wartet vor Freigabe auf den tatsächlichen Browserabbruch und danach auf Providerfinish, vollständig gelesene API-Antwort und beendeten Routehandler. Der ergänzende Hooktest erfüllt ein altes Promise trotz ignoriertem Abbruchsignal, weist das Lesen des Bodys nach und prüft erst danach den unveränderten neuen Kontext. |
| SD-Fake | Vier explizite Promptarten mit Test-Aufrufplänen, Ablehnung unbekannter/überschüssiger Aufrufe und abschließender Prüfung nicht abgearbeiteter Pläne. Das Erklärungsscript ist endlich. Die gesonderten Providerwege in SD-02 und SD-05 verwenden dieselbe Begrenzung. |

Frische Nachweise des koordinierenden Agenten auf dem nachgebesserten Stand:

| Prüfung | Ergebnis |
| --- | --- |
| `npm run test:unit` | App **4.554 bestanden / 1 übersprungen**, Emulator **697 bestanden**; Exitcode 0 |
| `npm run test:tutor-quality` | **65 Dateien, 892 Tests bestanden**; 2.378 ms bei 15.000-ms-Budget |
| `npm run check` | Vier TypeScript-Prüfungen bestanden |
| `npm run lint`, `npx knip` | Exitcode 0; Knip nennt ausschließlich vorhandene Konfigurationshinweise |
| Fünf Tutor-Browsersuites mit `--retries=0` | **29 bestanden**, keine Retries; Playwright baut den eigenen Client/Server vor dem Start neu und verwendet keinen vorhandenen Server |
| `npm run check:bundle` | Bestanden: `initialBytes` 450.677, `initialPathJsBytes` 728.052, 11 Startpfad-Chunks |
| Dokumentation und Diff | `npm run check:docs` bestanden (114 Markdown-Dateien), `git diff --check` sauber; die Prüfunterlagen selbst enthalten keine Produktcodeänderung |

Das gemeldete Sonar-Ergebnis wurde lesend über den lokalen Server der konkreten Analyse zugeordnet: CE-Task `d95237c5-b937-4e88-85b8-68ae4d8d9618` erfolgreich, Analyse `f3fecd9a-c663-4f3e-94d8-cb509846451f` vom 2026-11-12 09:19:29 UTC, Gate **OK**, neue Verstöße **0**, Coverage neuer Code **86,6 %**. Dies ist eine unabhängige Überprüfung des vorhandenen Scans, kein neu gestarteter Scan. Gate-Status und Shell-Exitcode wurden getrennt beurteilt.

Die separate Prüfinstanz führte ergänzend eine A/B/Korpus-Auswahl aus (**26 bestanden, 78 durch Filter ausgelassen**), den Late-Promise-Hooktest (**1 bestanden**) und die reine SD-Negativkontrolle für unbekannte Prompts (**1 bestanden, 18 gefiltert**). Sie hat keine Dateien geändert. Die dokumentierten Mutationsproben wurden bei dieser read-only-Nachprüfung nicht nochmals ausgeführt; ihre Ergebnisse sind als Implementierungsnachweise gekennzeichnet. Die neuen positiven und negativen Datenwege wurden dagegen direkt nachgeprüft.

Keine echten Tutor-/Judge-Aufrufe. Der Abschluss betrifft die deterministische Testabdeckung und die technisch geprüfte Evaluatorerweiterung. Die fachliche Qualität echter Modelle und die Kalibrierung des Judge v3 bleiben mangels beauftragter Modellmessung offen. Diese Grenze ist ausdrücklich dokumentiert und kein versteckter erfolgreicher Modelltest.
