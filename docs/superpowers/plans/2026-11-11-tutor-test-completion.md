# Tutor-Testabdeckung vervollständigen – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Eine unabhängige Abschlussprüfung ist im Prüfauftrag vorzusehen; diese Planerstellung führt keine Implementierung aus.

**Goal:** Die eigene Tutorlogik mit reproduzierbar ersetzten Modellantworten absichern und verbleibende Modellqualität als eigenen Prüfgegenstand sichtbar machen.

**Architecture:** Bestehende Vitest-, Routen-, Playwright- und Evaluationswege erweitern. In zentralen Servicetests werden nur der externe Provider und das Laden fester Test-Kursinhalte ersetzt; Service, Klassifikation, Referenzbewertung, Curriculum-Adapter und Stores bleiben echt. Ergänzende Modellmessungen verwenden den vorhandenen versionierten Evaluator.

**Tech Stack:** TypeScript, Vitest, React Testing Library, Express-Loopback-HTTP, Playwright, bestehende YAML-Korpusdateien; keine neue Testbibliothek.

**Spec:** [LearningQuestions-SSOT](../../../ssot/ssot_function_definition_LearningQuestions.md), [TutorQualityGates-SSOT](../../../ssot/ssot_function_definition_TutorQualityGates.md), [TutorQualityEvaluation-SSOT](../../../ssot/ssot_function_definition_TutorQualityEvaluation.md). Grundlage der Ergänzungen: [Testanalyse vom 11.11.2026](../../proposals/report-tutor-test-coverage-2026-11-11.md). Neue Vorschläge dieses Plans sind bis zur Umsetzung keine geänderten Produktverträge.

**Status:** Plan auf ausdrücklichen Nutzerauftrag erstellt; keine neuen Tests oder Produktänderungen umgesetzt. Die frühere Analyse beschreibt einen damaligen Arbeitsstand. Inzwischen liegt unter anderem `tests/client/tutor-review-structure.test.ts` vor; dessen tatsächlichen Stand in Aufgabe 1 neu prüfen. Alte Befunde weder ungeprüft als offen noch ungeprüft als behoben übernehmen.

## Global Constraints

- Vorhandene Tests bleiben erhalten. Nach `ssot/ssot_agent_policy.md` benötigen Änderungen bestehender Testdateien technische Begründung und explizite Nutzerfreigabe. Dieser Plan bevorzugt zusätzliche Dateien; eine pauschale Erlaubnis zur Abschwächung bestehender Erwartungen entsteht nicht.
- Änderungen anderer Arbeit im aktuellen Working Tree bewahren. Kein Restore, Reset, automatisches Stash oder Branchwechsel zum Herstellen einer vermeintlich sauberen Basis.
- Deterministische Prüfungen verwenden ausschließlich synthetische Credentials und kontrollierte Antworten. Keine KI:connect-Aufrufe, Modellkosten oder echten Zugangsdaten in diesen Tests.
- Der bestehende Tutor-Quality-Testbudgetwert bleibt `15000` ms. Mehr Laufzeit zuerst durch gezielte Fixtures und kontrollierte Promise-Freigaben vermeiden; keine unbegründete Budgeterhöhung.
- Kein kompletter C++-Interpreter, kein neues LLM-Bewertungsframework und keine zweite konkurrierende Live-Testpipeline.
- Eigene Fachregeln mit unabhängigen Referenzen prüfen. Eine vom Fake gelieferte Fünf-Sterne-Bewertung ist selbst kein Beweis für fachliche Richtigkeit.
- Lerninhalt, Diagnose und Review getrennt prüfen. Fehler optionaler Diagnose dürfen gültige Lernantworten nicht verändern oder verhindern.
- Echte Modellläufe sind eine separat budgetierte Ergänzung. Ihr Abschluss ist weder durch das Vorhandensein eines neuen Korpusfalls noch durch dessen Fake-Ausführung belegt.
- Commit/Push/Merge sind kein Teil dieser Planerstellung. Bei späterer Umsetzung gelten die bestehenden Hooks und erforderlichen Prüfungen; nur die jeweils geprüften Änderungen integrieren.

## Review Focus

1. Eine fachlich formulierte Antwort wie „Ist es 1?“ darf nicht allein wegen ihres Fragezeichens zur unbewerteten Klärung werden; eine echte Bitte um Präzisierung darf keinen Fehlversuch erzeugen. Aufgabe 3 prüft kontrastierende Paare.
2. Dieselbe offene Frage nach schwacher Antwort ist beabsichtigt; dieselbe bereits beantwortete Frage nach erfolgreichem Abschluss kann eine unzulässige Wiederholung sein. Aufgabe 2 prüft beide Zustände.
3. Ein Header-, Board- oder Codewechsel kann eine geprüfte Referenz ungültig machen. Aufgabe 4 prüft die Referenzbindung, Aufgabe 6 die Oberfläche.
4. Eine sichere Grafik kann nach Ersetzung der zugehörigen Frage inhaltlich veraltet sein. Aufgabe 5 prüft ihre tatsächliche Auslieferung und den Diagnosegrund.
5. Ein altes Requestergebnis nach Leeren, DEBUG-Wechsel oder „Weiter“ darf keinen neuen Mitschnitt erzeugen; ein frischer Request muss weiterhin erfasst werden. Aufgabe 6 prüft Ablauf und Gegenkontrolle.

## Vorhandene Mock-Tests: Ausgangspunkt

| Beispiel | Ersetzt | Echt ausgeführt | Konkrete Aussage |
| --- | --- | --- | --- |
| `tests/server/services/tutor/support/tutor-quality-scenario-runner.ts` und `tutor-quality-scenarios.test.ts` | `LLMProvider` liefert vorbereitete Ergebnisse oder Fehler | `TutorService`, bei Kursinhalt `CurriculumTutorAdapter` | Planerautorität, reparierte Wiederholung, Metadaten und Zustandsänderungen |
| `tests/server/services/tutor/tutor-graphic-matrix.test.ts` | `fetch` liefert kontrollierte OpenAI-kompatible Modellantworten | `KiconnectProvider`, `TutorService`, Grafikprüfung und Diagnose | Grafik fehlt, wird angenommen oder mit festem Grund verworfen |
| `tests/server/routes/tutor-learning-support.routes.test.ts` | Provider und Kursinhalte-Resolver | Produktionsrouten, Service, Planer und Stores über HTTP | Lernhilfe, Versuche, Referenzbindung und Wiederholungen von Requests |
| `tests/client/tutor-learning-support.test.tsx` | HTTP-Antworten | Hook und Oberfläche | Sterne, Retry, Entwurf, gehaltene Folgefrage und „Weiter“ |
| `e2e/tutor-debug-graphics.spec.ts`, `e2e/tutor-review.spec.ts` | Lokaler Provider mit festgelegten Antworten | Browser, Tutor-API, Service und Provideradapter | Technische Strecke bis zur Grafik beziehungsweise Kopie |

Nicht alle Tests müssen dieselbe Tiefe haben. Ein UI-Test darf HTTP ersetzen, wenn er Anzeigeverhalten prüft. Die Aussage über den gesamten Lernablauf muss zusätzlich durch eine integrierte Strecke belegt sein.

## Aufgabenfolge und Abnahme

| Abschnitt | Aufgaben | Abnahmekriterium |
| --- | --- | --- |
| A: Eigene Logik | 1–5 | Für jede aufgeführte Regel gibt es einen aussagekräftigen deterministischen Test oder einen konkret benannten offenen Befund. |
| B: Zusammenspiel und CI | 6–7 | Mindestens ein vollständiger Lernverlauf samt Fehler-/Resetpfaden läuft durch echte Routen und Oberfläche; alle neuen Tests werden von den vorgesehenen Gates gefunden. |
| C: Modellqualität ergänzen | 8 | Neue fachliche Referenzfälle und ihre Fake-Prüfung sind vorhanden; tatsächliche Modellmessung und verbleibende Unsicherheit werden separat ausgewiesen. |

„Vervollständigt“ bedeutet hier die nachgewiesene Abdeckung dieser benannten Regeln und Risiken. Weder 100 % Code-Coverage noch eine beliebig große Testanzahl ist das Abnahmekriterium.

### Aufgabe 1: Ausgangsstand prüfen und Abdeckungsmatrix festhalten

**Files:** Create `docs/tutor-test-matrix.md`. Read die in diesem Plan genannten Tests, `package.json`, `vitest.config.ts` und die drei SSOTs. Noch keine bestehenden Testdateien ändern.

**Interfaces:** Consumes bestehende Regeln, Testtitel und Testkommandos. Produces eine Tabelle mit `Regel/Fall-ID`, `Quelle`, `Testdatei und Testname`, `ersetzte Komponente`, `Assertions`, `Gate`, `Status`. Status ausschließlich `belegt`, `zu ergänzen`, `Produktbefund` oder `Modellmessung offen`.

- [ ] Für die Regeln der Aufgaben 2–8 vorhandene aussagekräftige Tests zuordnen. Vorhandene Abdeckung wiederverwenden; keine Kopie nur für eine höhere Testanzahl erzeugen.
- [ ] Strukturcode-Korrektur mit den Review-Suites einschließlich `tests/client/tutor-review-structure.test.ts` prüfen. Gegenbeispiel: Key `answer`, gültige Klassifikation bleibt `answer`, freie Inhalte werden maskiert, Collector verliert deshalb keinen Eintrag, Export validiert. Falls noch offen: den vorhandenen [Opus-Auftrag](../prompts/2026-11-11-tutor-review-structural-redaction-opus.md) abschließen, statt einen zweiten Fix zu erfinden.
- [ ] `npm run test:tutor-quality` ausführen; aktuellen Zähler und Laufzeit dokumentieren. Die früheren 764 Tests sind ein historischer Vergleichswert, keine vorgegebene neue Sollzahl.
- [ ] `npx vitest run --project=unit-client tests/client/tutor-review-structure.test.ts tests/client/tutor-review-chain.test.ts tests/client/tutor-review-findings.test.ts` ausführen. Erwartet: alle Tests grün; fehlende Dateien oder echte Fehler als Befund behandeln.
- [ ] `npm run check:docs` ausführen. Matrix und Anfangsstand als eigenes überprüfbares Ergebnis festhalten; ungelöste Tests nicht durch Status „belegt“ ersetzen.

### Aufgabe 2: Serviceentscheidungen mit gezielt widersprüchlichen Modellantworten prüfen

**Files:** Create `tests/server/services/tutor/tutor-response-contract.test.ts`. Reuse `support/tutor-quality-scenario-runner.ts`; Read `tutor-service.ts`, `curriculum-tutor-adapter.ts`, `tutor-quality-scenarios.test.ts`, `session-question-repetition.test.ts` und `mastery-progression.test.ts`.

**Interfaces:** Consumes `runTutorQualityScenario(scenario: TutorQualityScenario): Promise<TutorQualityScenarioTrace>` mit `provider.result`, `stateBefore`, `stateAfter`, `providerRequests`. Produces zusätzliche Assertions auf öffentliche Serviceergebnisse und echte Progression. Für Fälle, die der Einzelrequest-Runner nicht abbildet, einen kleinen lokalen Fake in der neuen Datei verwenden; kein Umbau des vorhandenen Runners erforderlich.

- [ ] Fall `RC-01`: Provider liefert eine schemafähige, aber fremde Topic-/Question-/Strategy-Zuordnung. Assertions: Ergebnis und State entsprechen dem tatsächlichen Plan; Providerkennungen werden nicht zur Autorität. Mindestens eine Kennung bewusst verschieden wählen.
- [ ] Fälle `RC-02a/b`: Exakt beziehungsweise heuristisch wiederholte Frage nach erfolgreicher Antwort; als Gegenkontrolle schwache Antwort auf weiterhin offene Frage. Assertions: erfolgreicher Fall ersetzt die erkannte Wiederholung; offener schwacher Fall darf die aktuelle Frage behalten. Keine allgemeine Erkennung jeder semantischen Paraphrase behaupten.
- [ ] Fälle `RC-03a/b`: Echter Plan mit Frage versus Transition/Blocked ohne Ersatzfrage. Assertions: Planfrage ersetzt; Transition/Blocked behält die bereits geprüfte/reparierte Frage. Nicht nur `question !== oldQuestion`, sondern erwarteten Text beziehungsweise exakte Herkunft prüfen.
- [ ] Fälle `RC-04a/b`: Abbruch oder Providerfehler nach Beginn der Planung. Assertion: gesamter Progression-State bleibt gegenüber `structuredClone(before)` unverändert. Die erfolgreiche Gegenkontrolle muss die erwartete Evidenz genau einmal hinzufügen.
- [ ] Fall `RC-05`: Fehlende versus ausreichende Mastery-Evidenz bei identischer Schwierigkeit; danach identische Evidenz bei zwei zulässigen Schwierigkeitswerten. Kontrollierte Mini-Topic-Fixture ohne Auswahlengpass verwenden. Assertions: genaue Mastery-Entscheidung folgt den Indikatoren und unterschiedlichen Fragearten; Difficulty allein erklärt kein Thema für gemeistert. Damit die bekannte schwache Einzelassertion durch einen zusätzlichen starken Test ergänzen.
- [ ] `npx vitest run --project=unit-node tests/server/services/tutor/tutor-response-contract.test.ts` ausführen. Neue Defekttests müssen vor einem nötigen Fix aus fachlichem Grund fehlschlagen. Bereits korrektes Verhalten darf sofort grün sein; dessen Erkennungskraft durch die Gegenkontrollen belegen. Keine künstliche rote Phase durch eine fehlende Importdatei als Produktnachweis ausgeben.

### Aufgabe 3: Klassifikation, Bewertung und Hilfeschritte als echte Zustandsfolge prüfen

**Files:** Create `tests/server/routes/tutor-mocked-dialog.routes.test.ts`. Modify `vitest.config.ts` nur zur Einordnung in `serializedHttpUnitTests`. Read `server/routes/tutor-support.routes.ts`, `server/services/tutor/learning-support.ts`, `learning-support-store.ts`, bestehende Lernhilfe-Routentests und die geprüfte IT06.4-Fixture.

**Interfaces:** Consumes `registerTutorRoutes`, echter `TutorService`, echter `CurriculumTutorAdapter`, `TutorSupportStore` sowie `tutorResponseSchema`/`tutorSupportResponseSchema`. Produces eine sequenzielle HTTP-Strecke; ausschließlich Provider und fester Kurs-Resolver sind Fakes. Der Testclient übernimmt die tatsächlich ausgegebenen Bindungen und verwendet für Retries dieselbe Aktionskennung.

- [ ] Lokalen Testserver nach vorhandenem Muster auf `127.0.0.1` starten und zuverlässig schließen. Fake-Provider-Aufrufe mitzählen; unerwartete weitere Generierungen müssen den Test scheitern lassen, statt beliebige Defaultantworten zu bekommen. Keine gemockten Klassifikatoren, Bewertungsfunktionen oder Stores.
- [ ] Kontrastpaare `SD-01`: „Welche Variable meinst du?“ → `clarification`; „Ich brauche einen Tipp“ → `help`; „Ist es 1?“ und „Meine Erklärung: Bit 7 ist gesetzt, also 1.“ → `answer`. Jede Klärung/Hilfe behält die Frage, trägt keine Sterne, erhöht `answerAttempts` nicht und verändert keine Mastery-Evidenz. Fachliche Antwortversuche werden dagegen als Versuche gezählt.
- [ ] `SD-02`: Fake bewertet die handgeprüft richtige IT06.4-Antwort `1` mit 1 und „falsch“. Assertions: ausgelieferte Referenzkorrektur bestätigt die Antwort, Bewertung liegt im erwarteten Band 4–5; Review beziehungsweise Evaluation bewahrt Rohbewertung und Korrekturentscheidung getrennt. Gegenkontrolle `0`: trotz Fake-Bewertung 5 keine Anerkennung als richtig.
- [ ] `SD-03`: Zwei Klärungen erlauben Überspringen, aber keine Musterantwort; drei eigene erfolglose Antworten erlauben die vorhandene Referenz. Nach gezeigter Referenz erzeugt eine wiederholte Antwort keine neue unabhängige Kompetenzbewertung. Alle Zähler und Sperren vor und nach der Grenze prüfen, nicht nur die finale Schaltfläche.
- [ ] `SD-04`: Identischer Retry zählt einmal und liefert Replay; andere Nutzdaten mit derselben Aktionskennung erzeugen Konflikt. Bei Retry weder zusätzliche Provider-Generierung noch doppelte Evidenz; zwei verschiedene echte Aktionen bleiben zwei Aktionen.
- [ ] `SD-05`: Ohne passende Referenz bleibt die Antwort modellabhängig. Kein Test darf aus einem Fake-Rating eine allgemeine fachliche Korrekturfähigkeit der Anwendung ableiten.
- [ ] `npx vitest run --project=unit-node-http tests/server/routes/tutor-mocked-dialog.routes.test.ts` ausführen. Erwartet: keine übersprungenen Fälle, gültige Antwortschemas, exakte Zustands- und Aufrufzahlen. Fehlende Vertragserfüllung als Produktbefund bearbeiten, ohne den Fake nachträglich passend zu machen.

### Aufgabe 4: Sketchvarianten und Referenzbindung prüfen

**Files:** Create `tests/server/services/tutor/tutor-context-variants.test.ts` und `tests/fixtures/tutor-quality/TQ-REG-002-dice-context.ino`. Reuse vorhandene Faktenextraktion und Projekt-/Board-Fixtures. Read `curriculum/sketch-facts.ts`, `question-reference.ts`, `tutor-board-context.test.ts`, `planner-project-files.test.ts` und `learning-support.test.ts`.

**Interfaces:** Consumes echte Kontextaufbereitung, Faktenextraktion und Referenzauflösung sowie mitgeschnittene `providerRequests`. Produces deterministische Varianten derselben fachlichen Ausgangslage. Der gepostete Würfel-Sketch ist eine neue, ausdrücklich zu prüfende Fixture; keine Behauptung, dass jeder historische Request exakt diesen Code enthielt.

- [ ] `CV-01`: Würfel-Sketch wörtlich übernehmen und unabhängig festhalten: `show` enthält keinen Serial-Ausgabeaufruf; `Serial.begin` initialisiert; die `Serial.println`-Zeile ist auskommentiert. `t` ist lokal `static unsigned long`, wird im gezeigten Code nicht aktualisiert; `switchInit` wird dort nicht aufgerufen. Keine Musterfakten aus einer früheren Tutorbehauptung übernehmen.
- [ ] `CV-02`: Kommentare ergänzen/entfernen und Variablennamen konsistent ändern. Assertions: ausgeblendete Aufrufe bleiben inaktiv; relevante Typ-/Aufruffakten und Aktivierung bleiben bei semantisch gleicher Variante gleich. Der Providerprompt enthält den richtigen aktuellen Kontext und nicht den alten Variablennamen.
- [ ] `CV-03`: Tatsächlich einen Serial-Ausgabeaufruf aktivieren. Gegenkontrolle: der passende Fakt und gegebenenfalls die Frageanwendbarkeit ändern sich. Ein Test, der alle Varianten immer gleich akzeptiert, reicht nicht.
- [ ] `CV-04`: Dieselbe relevante Deklaration zwischen Hauptdatei und Header verschieben; doppelte oder veraltete Angaben ausschließen. Danach einen bedeutungsverändernden Header ergänzen: eine vorher gültige Referenz darf nicht weiterhin automatisch angewandt werden.
- [ ] `CV-05`: Referenz unter passendem Sketch/Board verfügbar, nach relevanter Code-/Boardänderung nicht anwendbar. Dieselbe Modellbewertung verwenden, damit die Gegenüberstellung wirklich die Bindung prüft. Eine unbekannte Spracheigenschaft darf nicht durch optimistische Gleichsetzung als „gleicher Code“ durchgehen.
- [ ] `npx vitest run --project=unit-node tests/server/services/tutor/tutor-context-variants.test.ts` ausführen. Assertions betreffen konkrete Fakten, Bindungen und gesendeten Kontext; ein Prompt-Satz „Erfinde nichts“ allein erfüllt keinen Faktentest.

### Aufgabe 5: Grafik und endgültige Frage gemeinsam prüfen

**Files:** Create `tests/server/services/tutor/tutor-graphic-question-contract.test.ts` und `tests/client/tutor-graphic-contract.test.tsx`. Reuse die Grafikmatrix, Rendererregressionen und Lebenszyklustests. Read `tutor-service.ts`, `shared/tutor-mermaid-rules.ts`, `client/src/lib/tutor-mermaid.ts` und `tutor-mermaid-preview.tsx`.

**Interfaces:** Consumes echte Provideradapter-/Serviceverarbeitung und `renderMermaidDiagram`; Provider-HTTP ist kontrolliert. Produces Prüfungen von endgültiger Frage, ausgeliefertem Mermaid, Diagnoseentscheid und DOM; kein neuer Diagrammparser.

- [ ] `GQ-01`: Providerfrage mit gültiger Grafik wird durch eine fachlich andere echte Planerfrage ersetzt. Erwartung anhand des geltenden Grafikvertrags prüfen: eine nicht mehr passende Providergrafik wird nicht kommentarlos zur neuen Frage gezeigt; Verwerfen und Auslöser sind nachvollziehbar.
- [ ] `GQ-02`: Keine Frageersetzung als Gegenkontrolle. Die gültige Grafik bleibt erhalten; geprüft werden konkrete Knoten/Kanten und die zugeordnete Grafikkennung, nicht nur irgendein vorhandenes SVG.
- [ ] `GQ-03`: Fehlend, leer, sichere unterstützte Grafik, nicht unterstützte Syntax und gesperrte Direktive als getrennte Fälle. Ablehnung verändert weder gültigen Fragetext noch Bewertung; Server und Renderer verwenden denselben einschlägigen festen Grund. Keine künstliche Sicherheitsablehnung für bloß fehlende Grafik.
- [ ] `GQ-04`: Gehaltene Folgefrage bleibt bis „Weiter“ einschließlich ihrer Grafik unsichtbar; danach werden Frage und Grafik zusammen sichtbar und nur einmal als angezeigt erfasst. Hilfen bleiben gemäß Vertrag textbasiert.
- [ ] `npx vitest run --project=unit-node tests/server/services/tutor/tutor-graphic-question-contract.test.ts tests/server/services/tutor/tutor-graphic-matrix.test.ts tests/server/services/tutor/tutor-graphic-finalization.test.ts` ausführen. Danach `npx vitest run --project=unit-client tests/client/tutor-graphic-contract.test.tsx tests/client/tutor-mermaid-regressions.test.ts tests/client/tutor-graphic-lifecycle.test.tsx`. Erwartet: alle Fälle grün, einschließlich der Gegenkontrollen.
- [ ] Eine technisch sichere, aber fachlich falsche Grafik ausdrücklich als Modellqualitätsfall in Aufgabe 8 weiterführen. Ohne vorhandenen semantischen Wächter darf dieser Test keine automatische fachliche Korrektur des Renderers voraussetzen.

### Aufgabe 6: Vollständigen Mock-Lernlauf einschließlich verspäteter Antworten absichern

**Files:** Create `e2e/tutor-mocked-lifecycle.spec.ts` und, soweit noch fehlend, `tests/client/tutor-review-state-machine.test.ts`. Read bestehende Tutor-Review-/Grafik-E2Es und `client/src/lib/tutor-diagnostic-runtime.ts`. Vorhandene Testservermuster verwenden, keinen zweiten Anwendungspfad bauen.

**Interfaces:** Consumes Browser → echte Tutor-API → echter Service/Adapter → lokaler kontrollierter OpenAI-kompatibler Provider. Produces sichtbare Zustände und einen über den echten Kopierknopf exportierten, schemafähigen Review. Providerantworten durch Promise-/HTTP-Freigabe steuern, nicht durch lange feste Sleeps.

- [ ] `LC-01`: Frage → Klärungsbedarf → schwacher Antwortversuch → passender Referenzfall mit absichtlich falscher Modellbewertung → korrekt ausgelieferte Bewertung → „Weiter“. Assertions: aktuelle Frage, Sterne, Zähler, Fokus, erhaltene Antwort und nächste Frage entsprechen jedem Schritt. „Weiter“ löst keine neue Provideranfrage aus.
- [ ] `LC-02`: Eine Antwort offen halten, dann Kontext wechseln oder neue Runde beginnen. Späteres Ergebnis darf die aktuelle Lernfrage nicht überschreiben. Browser- und Serverzustand getrennt beurteilen: Ein lokaler Reset ist nicht automatisch ein serverseitiger Abbruch.
- [ ] `LC-03`: Request → Debug leeren → verspätete Antwort; außerdem DEBUG aus/ein. Das alte Ergebnis erzeugt weder neuen Review-Schritt noch technische Grafik-/Abschlussereignisse in der neuen Erfassungsepoche. Frischer Request danach wird wieder vollständig erfasst. DEBUG aus stoppt neue Aufnahme; es bedeutet nach aktuellem Vertrag nicht automatisch Löschen des vorhandenen Mitschnitts.
- [ ] `LC-04`: Filter setzen und technischen Puffer überfüllen; der separate Review enthält trotzdem alle tatsächlich aufgenommenen fachlichen Schritte. Kopie mit `tutorReviewExportSchema` prüfen und bekannten synthetischen Schlüssel in freien Inhalten ausschließen. Öffentliche Codes, die zufällig dem Schlüssel gleichen, nicht als Secretleck fehlinterpretieren.
- [ ] `LC-05`: Fehlender/ungültiger Review-Block lässt gültige Frage und Bewertung nutzbar. Für Erfassungsgrenzen bleibt Unvollständigkeit sichtbar; kein schrittweises Wiederauffüllen gelöschter Daten.
- [ ] `npx vitest run --project=unit-client tests/client/tutor-review-state-machine.test.ts` für eine tatsächlich ergänzte Clientdatei ausführen. Danach `npx playwright test --project=browser e2e/tutor-mocked-lifecycle.spec.ts` gegen frisch gebauten Client. Erwartet: alle fachlichen Assertions im ersten Versuch erfüllt; erfolgreiche Wiederholung nach einem fehlgeschlagenen Erstversuch gesondert dokumentieren.

### Aufgabe 7: Erkennungskraft und CI-Abdeckung nachweisen

**Files:** Update `docs/tutor-test-matrix.md`; Modify `vitest.config.ts` nur für neue serialisierte Routenfälle. Änderungen an `package.json` oder `.github/workflows/ci.yml` nur, wenn eine nachgewiesene Entdeckungslücke besteht. Create bei Bedarf `docs/proposals/report-tutor-test-completion.md` als Abschlussnachweis.

**Interfaces:** Consumes neue und bestehende Testfälle sowie echte Runner-Ergebnisse. Produces eine nachvollziehbare Abnahme, die feste Anwendungsregeln und offene Modellfragen unterscheidet.

- [ ] Mit `npx vitest list --project=unit-node --project=unit-node-http --project=unit-client` nachweisen, dass neue Testdateien dem richtigen Projekt zugeordnet sind. Kein Routenfall darf versehentlich außerhalb des vorgesehenen seriellen Projekts verbleiben.
- [ ] Neue Tests auf falsche Sicherheit prüfen: keine ausschließlich breiten Regex-/`toBeTruthy`-Assertions für konkrete Fachregeln; keine vom selben Produktalgorithmus berechnete Sollbewertung; keine stillen Fake-Defaultantworten; kein unnötiges Ersetzen von Service/Planer/Store im integrierten Test.
- [ ] Für jeden neuen wesentlichen Schutz eine gezielte Gegenprobe dokumentieren. Zuerst auf bereits defektem Stand beobachtetes Rot verwenden. Wo das Verhalten schon korrekt war, in isolierter Arbeitskopie einen passenden Schutz kurz deaktivieren und den betroffenen Test rot sehen; Änderung vollständig zurücknehmen. Keine Schwächung produktiver Tests oder unerlaubte Änderung fremder Arbeit. Vorhandene unterschiedliche Positiv-/Negativfälle bleiben Pflicht.
- [ ] Neue Fälle in der Matrix mit tatsächlichen Assertions und Gate eintragen. Nicht implementierte Tutoranforderungen als `Produktbefund`, nicht als grünen Mockbeleg oder unbegründetes Skip ausweisen.
- [ ] `npm run test:tutor-quality`, `npm run test:unit`, `npm run check`, `npm run lint`, `npx knip`, `npm run check:docs` und `git diff --check` ausführen. Bei UI-/Laufzeitänderung Build und sämtliche Tutor-Browsertests ausführen; vor einem späteren Push zusätzlich die nach Repository-Policy vorgeschriebene Gesamtprüfung.
- [ ] Bei Produktcodeänderungen Coverage und Sonar-Gate frisch dem geprüften Stand zuordnen. Unterschied zwischen bestanden/übersprungen, kontrollierten Providern und echtem Modell explizit dokumentieren. Ein grüner Code-Check ersetzt Aufgabe 8 nicht.

### Aufgabe 8: Echte Modellqualität auf denselben Referenzfällen ergänzen

**Files:** Extend `evals/tutor-quality/anchor-corpus.yaml`; Reuse neue Würfel-Fixture. Create `tests/server/services/tutor/evaluation/tutor-dialog-regressions.test.ts`. Read `evaluation/anchor-corpus.ts`, `real-provider-evaluation.ts`, `judge.ts` und den Evaluations-SSOT. Neue Erwartungsfelder oder Judge-Evidenzfelder nur gemeinsam mit deren Schema, Vertrag und zusätzlichen Tests einführen.

**Interfaces:** Consumes vorhandene `TutorQualityEvaluationScenario`-Struktur, Korpusloader, `runTutorQualityEvaluation`, feste fachliche Referenzen und getrennte Fake-/Real-Provider. Produces versionierte Fälle mit klarer Aussage, welche Modellqualität überhaupt beobachtet werden kann. Keine automatische neue Ausgabe von Lösungstexten oder vollständigen Prompts an den Produktbrowser.

- [ ] Fälle für unklare Variablenbezüge, Bitte um Präzisierung, Wiederholung nach gelöstem Ziel, erfundene aktive Serial-Ausgabe und begründeten Einwand mit nötiger Selbstkorrektur anlegen. Erwartete Klassifikation nur festlegen, soweit der aktuelle Produktvertrag sie trägt; zusätzliche Einwandspolitik gegebenenfalls zuerst als Vertragsänderung ausweisen.
- [ ] Fallfakten unabhängig am Sketch prüfen. Beispiel: Im geposteten `show` steht kein Serial-Aufruf. Ein „guter“ Fake bestätigt diese Fakten nicht wissenschaftlich, sondern liefert einen bekannten Auswertungseingang.
- [ ] Jeden neuen Auswertungspfad mit mindestens einer bekannten guten und einer absichtlich schlechten Fake-Antwort durchlaufen. Assertions: gute Antwort besteht die betreffende Prüfung; falsche Rückmeldung beziehungsweise ein Fake-Judge-`fail` erscheint als genau zugeordneter Befund. Damit wird der Evaluator geprüft, nicht bereits das echte Modell.
- [ ] Anfangsfragen und Grafiken derzeit nicht als semantisch mitgeprüft darstellen: Der bestehende Judge betrachtet den letzten geeigneten Turn und bekommt keine Grafikquelle. Für Grafiksemantik und Initialfragen zuerst die erforderliche kleine Vertragserweiterung entwerfen: geeignete Turn-Auswahl, Mermaid als Text-Evidenz, feste Zitatquellen, Promptrevision und Parsertests. Keine Zeichnung oder untrusted SVG-Ausführung für den Judge einführen. Erst danach entsprechende Fälle als semantisch abgedeckt markieren.
- [ ] Schwere Einzelbefunde im Abschlussbericht unabhängig vom Prozess-Exitcode sichtbar machen. `warn`, `not-run` und `inconclusive` sind keine uneingeschränkte Modellfreigabe. Die bestehende Mehrheitsregel nicht stillschweigend durch neue Test-Sollwerte ändern; eine strengere Freigaberegel erfordert eine explizite Vertragsentscheidung.
- [ ] `npx vitest run --project=unit-node tests/server/services/tutor/evaluation/tutor-dialog-regressions.test.ts` und anschließend `npm run test:tutor-quality` ausführen. Ergebnis ist zunächst deterministisch abgesicherte Evaluationsfähigkeit.
- [ ] Anschließend ein separates Live-Protokoll festlegen: feste angefragte und tatsächlich zurückgegebene Modelle, sauberer relevanter Git-Stand, identische Prompt-/Korpusrevision, vorab ausgewählte Fälle, zunächst 3–5 Stichproben pro Fall als Screening und ein genehmigtes Callbudget einschließlich Listen/Judge. Ohne festgelegtes Budget keine echten Aufrufe starten. Technische Ausfälle nicht durch neue Glückstreffer ersetzen.
- [ ] Live-Bericht je Fall mit geplant/ausgeführt/auswertbar, Rohmodellfehlern, ausgelieferten Fehlern, Anwendungskorrekturen und ungültigen Judge-Ergebnissen erstellen. Strittige und kritische Beurteilungen menschlich nachprüfen. Ein zweiter kalibrierter Beurteiler und Untersuchungen mit Lernenden bleiben gesonderte Qualitätsarbeit; weder Fake-Pass noch 3/3 Live-Pass sind ein allgemeiner Lerneffekt-Nachweis.

## Abschlussentscheidung

- **Eigene Logik abgedeckt:** A und B abgeschlossen, benannte Regeln mit aussagekräftigen Tests belegt und keine wesentlichen offenen Produktbefunde. Vorhandene grüne Tests bleiben grün; neue Tests laufen im Gate.
- **Modellqualität erweitert prüfbar:** neue C-Fälle mit guten und schlechten kontrollierten Antworten validiert. Das ist noch keine positive Messung des echten Modells.
- **Modelllauf durchgeführt:** tatsächliche Stichproben samt Revisionen, Befunden und Ausfällen dokumentiert. Offene Grafik-/Judge-Verträge, fachliche Schwächen und verbleibende Unsicherheit werden explizit ausgewiesen.

Für die Umsetzung empfiehlt sich diese Reihenfolge: erst Aufgaben 1–7 als deterministische Absicherung, danach Aufgabe 8 als Ergänzung der fachlichen Modellmessung. So lässt sich ein Fehler zunächst der eigenen Logik oder dem Modell zuordnen, bevor schwankende Modellantworten in die Bewertung eingehen.
