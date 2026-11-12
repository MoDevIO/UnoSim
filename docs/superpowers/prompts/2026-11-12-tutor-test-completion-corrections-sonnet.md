# Nachbesserungsauftrag für Sonnet: unabhängige Tutor-Testprüfung

Du arbeitest in `/Users/to/Documents/TT_Web/UnoSim` auf dem tatsächlich vorhandenen Branch `feature/tutor-test-completion`. Behebe selbstständig die Befunde aus [der unabhängigen Prüfung vom 12.11.2026](../../proposals/review-tutor-test-completion-2026-11-12.md). Bewahre die bisherige Umsetzung und sämtliche fremden Änderungen. Kein Reset, Restore, Stash, Commit, Push oder Branchwechsel während der Korrektur.

Lies den Prüfbericht, den bisherigen Arbeitsbericht `docs/proposals/report-tutor-test-completion.md` und den ursprünglichen Sonnet-Auftrag. Dessen Testschutz, begrenzte Freigabe für Evaluatormigration und Arbeitsweise gelten weiter. Modellbudget weiterhin **0 Calls**; ausschließlich kontrollierte Provider und lokale Testserver.

## Sprache und Übergabe an Codex

Schreibe Fortschrittsmeldungen, neue Arbeitsberichte und Abschlussantwort auf **Deutsch**. Der Nutzer kann den Auftrag mit Sonnet oder Opus ausführen lassen; der Dateiname verlangt keinen Modellwechsel. Code, Bezeichner und zitierte Toolausgaben müssen nicht übersetzt werden.

Adressiere die Abschlussantwort als technische Übergabe an **Codex zur unabhängigen Nachprüfung**. Beginne direkt mit „Übergabe an Codex zur unabhängigen Nachprüfung.“ Keine zusätzliche Floskel wie „Written for: you“ und keine Commitentscheidung an den Nutzer auf Basis deiner Selbstprüfung auslagern. Nenne Änderungen je Befund, Datenwege, Gegenproben, genaue Testresultate, offene Punkte und Berichtspfade. Unterscheide Gate-Status von Kommando-Exitcode und Selbstprüfung von unabhängiger Prüfung.

Bericht und Dateien bilden die Übergabe; keine direkte Verbindung zwischen den Agenten oder bereits erfolgte Codex-Prüfung behaupten. Der Nutzer entscheidet über die Integration nach der Prüfung des übergebenen Stands.

## 1. Frühere Rückmeldung tatsächlich an das Tutor-Modell geben

- Erweitere die Evaluationshistorie um optionales begrenztes `feedback` und führe es durch Korpusparser, Materialisierung und Runner in den tatsächlichen Providerinput. Verwende die geltenden Grenzen und Validierung des vorhandenen Dialogvertrags. Übernimm keine beliebigen Zusatzfelder.
- `shared/tutor.ts` erlaubt Feedback schon heute; `buildDialogPrompt` nimmt es in frühere schwache Versuche auf. Deshalb weder den Haupt-Tutorprompt noch die Produkt-API für diese Korrektur umbauen.
- Hinterlege für `TQ-DICE-OBJECTION` die ausdrücklich synthetische frühere Falschbehauptung als Feedback des passenden früheren Schritts. Die Judge-Fakten müssen dieselbe tatsächlich übermittelte Vorgeschichte beschreiben.
- Ergänze einen Test mit dem echten Loader und Runner, der den aufgezeichneten Tutor-Providerprompt prüft: vorherige Falschbehauptung vorhanden, richtige aktuelle Frage/Antwort vorhanden, frühere schwache Bewertung weiterhin nicht als Bewertungsmaßstab in den aktuellen Versuch eingespeist. Nur eine Prüfung der Judge-Fakten reicht nicht.
- Prüfe auch die Gegenseite: Ohne dieses historische Feedback keine nicht belegte frühere Aussage behaupten. Kontext- und Befundzuordnung dürfen nicht vom Fake erfunden werden.

## 2. Fachlich gültiges Grafik-Testpaar bilden

- Ersetze das bisherige „good“-Beispiel, das zur Frage nach der Funktionsreihenfolge bereits `loop → run → show` zeichnet.
- Verwende eine eindeutig formulierte gemeinsame Frage und unabhängig passende Beispiele. Geeignet ist etwa: „Welche Funktion wird in loop bei erfüllter Tasterbedingung direkt aufgerufen?“ Die gesuchte Antwort ist `run`; eine Kontextgrafik stellt nur die Bedingung und eine unbenannte Aktion dar, eine verratende Grafik nennt `run()` an der gesuchten Stelle.
- Prüfe eine verratende Grafik **ohne** das Wort `Lösung:` und eine nicht verratende Kontextgrafik. Das Präfix allein darf das Ergebnis nicht bestimmen. Alle Beispiele müssen denselben Sketch und dieselbe Frage betreffen sowie die Syntax-/Sicherheitsprüfung tatsächlich passieren.
- Die Fake-Judge-Regel bleibt ein Testmittel für diese bekannten Beispiele, kein vorgetäuschter allgemeiner Semantikprüfer. Assertions müssen gültige Paarung, tatsächlich ausgeliefertes Mermaid und die genaue Befundzuordnung belegen.
- Erhalte die funktionierende Behandlung fehlender Grafik als `inconclusive`, Initialfragen, vierte Zitatquelle und die unveränderten Verdict-/Exitcode-Regeln.

## 3. LC-02 wirklich nach der verspäteten Antwort prüfen

- Ersetze die Wartebedingung nach `slow.release()`: Der bisherige `calls`-Eintrag existiert bereits vor `hold.gate` und beweist keinen Abschluss.
- Ergänze einen kontrollierten Abschlussnachweis für die konkret gehaltene Anfrage. Warte nach Freigabe auf den vollständigen Route-/Transportabschluss und die relevante Browserverarbeitung beziehungsweise den nachgewiesenen Abbruch; prüfe erst danach den aktuellen Tutorzustand.
- Bei einem abgebrochenen Fetch den serverseitigen Abschluss und den Browserabbruch getrennt erfassen. Nicht auf ein Browser-Response-Ereignis warten, das bei einem korrekten Abbruch gar nicht kommen kann.
- Falls der reale Browserpfad durch Abbruch allein geschützt ist, ergänze einen kleinen Hook-/Clienttest, in dem der kontrollierte Transport das Abbruchsignal ignoriert und spät erfüllt wird. Er muss den aktuellen Zustand schützen, nachdem das alte Promise tatsächlich erfüllt und verarbeitet wurde.
- Keine festen Sleeps als Beweis. Zeige eine Gegenprobe, bei der ein gezielt defekter Schutz den Test zuverlässig rot macht; nach Wiederherstellung erneut grün. Fremde Änderungen bytegenau erhalten.

## 4. Den SD-Provider-Fake tatsächlich begrenzen

- Unbekannte Promptarten nicht pauschal als Erklärung behandeln. Erlaubte Aufrufarten und geplante Wiederholungen explizit festlegen; überschüssige Generierungen ablehnen beziehungsweise über eine abschließende Assertion als Fehler sichtbar machen.
- Zyklische unbegrenzte Erklärungsantworten durch ein begrenztes Script oder überprüfte Aufrufbudgets ersetzen. Positive Gegenkontrolle: Der reguläre Ablauf funktioniert; negative Gegenkontrolle: ein zusätzlicher oder unbekannter Aufruf scheitert.
- Klassifikation, Service, Planer, Referenzbewertung und Stores bleiben echt. Dokumentation und Matrix dürfen den Fake erst dann als strikt bezeichnen.

## 5. Verifikation und Dokumentation

Zuerst die betroffenen Tests und Gegenproben ausführen. Danach mindestens:

```bash
npx vitest run --project=unit-node tests/server/services/tutor/evaluation/tutor-dialog-regressions.test.ts tests/server/services/tutor/evaluation/tutor-judge-extended-evidence.test.ts tests/server/services/tutor/evaluation/anchor-corpus.test.ts tests/server/services/tutor/evaluation/http-replay.test.ts
npx vitest run --project=unit-node-http tests/server/routes/tutor-mocked-dialog.routes.test.ts
npm run test:tutor-quality
npm run test:unit
npm run check
npm run lint
npx knip
npm run check:docs
git diff --check
npm run build
npx playwright test --project=browser --retries=0 e2e/tutor-learning.spec.ts e2e/tutor-status-indicator.spec.ts e2e/tutor-debug-graphics.spec.ts e2e/tutor-review.spec.ts e2e/tutor-mocked-lifecycle.spec.ts
```

Eine neue Clienttestdatei zusätzlich im Projekt `unit-client` gezielt ausführen. Anschließend das Sonar-Gate frisch nachweisen; sein Kommando enthält bereits den Coverage-Lauf. Keine früheren grünen Gate-Ergebnisse als Nachweis für die neue Änderung ausgeben.

Korpus-/Digest-Pins und SSOT bei der Historienerweiterung nachvollziehbar aktualisieren. Versionsregeln beachten; nicht unabhängig gültige fachliche Erwartungen ändern. Prüfbericht um einen Abschnitt „Nachbesserung“ mit Zuordnung A–C und Fake-Abweichung ergänzen, historische Befunde erhalten. Arbeitsbericht und Matrix mit den wirklich ausgeführten Nachweisen aktualisieren.

Im vorbereiteten Live-Protokoll die Zahl der Modelllistenaufrufe aus dem tatsächlichen Runnerweg beziehungsweise einem kontrollierten Trockenlauf ableiten. Modellauflösung kann pro Tutoraktion eine Liste abrufen; zwei Listen insgesamt sind keine gesicherte Obergrenze für sieben mehrschrittige Fälle. Budget für Tutor-, Listen- und Judge-Aufrufe einschließlich begrenzter Wiederholungen gemeinsam ausweisen, ohne einen echten Call auszuführen.

Arbeite die Korrekturen ohne Routine-Zwischenfreigaben ab. Unterbrich nur bei den im ursprünglichen Auftrag benannten größeren Blockern; unabhängige Arbeit vorher abschließen. Liefere am Ende pro Befund den konkreten geschlossenen Datenweg, Gegenprobe und neue Prüfresultate. Behaupte weder eine unabhängige Nachprüfung noch reale Modellqualität, wenn diese nicht tatsächlich geprüft wurden.
