# Tutor-Testabdeckung vervollständigen – Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans`, sofern im jeweiligen Agenten verfügbar, to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Der [Sonnet-Arbeitsauftrag](../prompts/2026-11-11-tutor-test-completion-sonnet.md) legt selbstständige Ausführung, Prüfintervalle und Abbruchkriterien fest; ein fehlendes Skill-/Delegationswerkzeug ist allein kein Abbruchgrund. Diese Planerstellung führt keine Implementierung aus.

**Goal:** Die eigene Tutorlogik mit reproduzierbar ersetzten Modellantworten absichern und verbleibende Modellqualität als eigenen Prüfgegenstand sichtbar machen.

**Architecture:** Bestehende Vitest-, Routen-, Playwright- und Evaluationswege erweitern. In zentralen Servicetests werden nur der externe Provider und das Laden fester Test-Kursinhalte ersetzt; Service, Klassifikation, Referenzbewertung, Curriculum-Adapter und Stores bleiben echt. Ergänzende Modellmessungen verwenden den vorhandenen versionierten Evaluator.

**Tech Stack:** TypeScript, Vitest, React Testing Library, Express-Loopback-HTTP, Playwright, bestehende YAML-Korpusdateien; keine neue Testbibliothek.

**Spec:** [LearningQuestions-SSOT](../../../ssot/ssot_function_definition_LearningQuestions.md), [TutorQualityGates-SSOT](../../../ssot/ssot_function_definition_TutorQualityGates.md), [TutorQualityEvaluation-SSOT](../../../ssot/ssot_function_definition_TutorQualityEvaluation.md). Grundlage der Ergänzungen: [Testanalyse vom 11.11.2026](../../proposals/report-tutor-test-coverage-2026-11-11.md). Neue Vorschläge dieses Plans sind bis zur Umsetzung keine geänderten Produktverträge.

**Status:** Umgesetzt am 2026-11-11 durch Claude Sonnet (Aufgaben 1–8); Nachweise und Abweichungen in `docs/proposals/report-tutor-test-completion.md`. Modellmessung: nicht ausgeführt – kein Budget beauftragt. Die frühere Analyse beschreibt einen damaligen Arbeitsstand. Inzwischen liegt unter anderem `tests/client/tutor-review-structure.test.ts` vor; dessen tatsächlichen Stand in Aufgabe 1 neu prüfen. Alte Befunde weder ungeprüft als offen noch ungeprüft als behoben übernehmen.

## Global Constraints

- Vorhandene Tests bleiben erhalten. Nach `ssot/ssot_agent_policy.md` benötigen Änderungen bestehender Testdateien technische Begründung und explizite Nutzerfreigabe. Der zu übergebende Sonnet-Startprompt enthält dafür eine begrenzte Ausführungsfreigabe: zusätzliche Fälle und notwendige Versions-/Hash-/Fixtureanpassungen für die hier konkret beschriebene Evaluatorerweiterung. Jede solche Anpassung begründen; keine bestehenden fachlichen Prüfaussagen, Grenzen, Sperren oder Gegenbeispiele abschwächen. Ohne Übernahme dieses Startauftrags bleibt die bisherige Schutzregel unverändert.
- Änderungen anderer Arbeit im aktuellen Working Tree bewahren. Kein Restore, Reset, automatisches Stash oder Branchwechsel zum Herstellen einer vermeintlich sauberen Basis.
- Deterministische Prüfungen verwenden ausschließlich synthetische Credentials und kontrollierte Antworten. Keine KI:connect-Aufrufe, Modellkosten oder echten Zugangsdaten in diesen Tests.
- Der bestehende Tutor-Quality-Testbudgetwert bleibt `15000` ms. Mehr Laufzeit zuerst durch gezielte Fixtures und kontrollierte Promise-Freigaben vermeiden; keine unbegründete Budgeterhöhung.
- Kein kompletter C++-Interpreter, kein neues LLM-Bewertungsframework und keine zweite konkurrierende Live-Testpipeline.
- Eigene Fachregeln mit unabhängigen Referenzen prüfen. Eine vom Fake gelieferte Fünf-Sterne-Bewertung ist selbst kein Beweis für fachliche Richtigkeit.
- Lerninhalt, Diagnose und Review getrennt prüfen. Fehler optionaler Diagnose dürfen gültige Lernantworten nicht verändern oder verhindern.
- Echte Modellläufe sind eine separat budgetierte Ergänzung. Ihr Abschluss ist weder durch das Vorhandensein eines neuen Korpusfalls noch durch dessen Fake-Ausführung belegt.
- Commit/Push/Merge sind kein Teil dieser Planerstellung. Bei späterer Umsetzung gelten die bestehenden Hooks und erforderlichen Prüfungen; nur die jeweils geprüften Änderungen integrieren.

## Verbindlicher Ablauf für Sonnet

Arbeitsreihenfolge: **1 → 2 → 3 → 4 → 5 → 6 → 8 → 7**. Aufgabe 7 ist die Gesamtabnahme nach sämtlichen Änderungen, einschließlich der Evaluatorerweiterung. Nach Aufgabe 6 findet bereits ein Integrationscheckpoint statt.

Sonnet setzt Tests, nötige begrenzte Fehlerkorrekturen, Evaluatorerweiterung und Dokumentation um. Ein durch die neuen Tests belegter Verstoß gegen einen bestehenden Vertrag ist ein Reparaturauftrag, kein Anlass, bloß den Befund zu melden und den Rest liegenzulassen. Reine Modellschwächen werden als solche erfasst; sie rechtfertigen keine unbeauftragte Neugestaltung der Tutor-Didaktik oder der Verdict-Schwellen.

Nach jedem Arbeitspaket: gezielte neue Tests und betroffene Nachbarsuiten ausführen, Befunde beheben, Matrix und Arbeitsbericht aktualisieren, kurz den Stand mitteilen und ohne Zwischenfreigabe fortfahren. Nach jeweils zwei Paketen zusätzlich `npm run test:tutor-quality`; bei Änderungen gemeinsamer Typen außerdem `npm run check`. Konkrete Endprüfungen und echte Abbruchgründe stehen im Sonnet-Arbeitsauftrag.

Der Arbeitsbericht ist `docs/proposals/report-tutor-test-completion.md`. Er enthält von Beginn an Ausgangsbranch/-commit, die vorgefundenen Änderungen, Aufgabenstatus, Entscheidungen, Testbefehle/-ergebnisse und den nächsten Schritt. Er dient auch zum Fortsetzen nach Kontextwechseln. Abgehakt wird nur nach Ausführung und Nachweis; bewusst nicht ausgeführte Modellaufrufe erhalten einen eigenen Status.

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
| C: Modellqualität ergänzen | 8, vor der Schlussprüfung in 7 | Neue fachliche Referenzfälle und ihre Fake-Prüfung sowie Initialfragen-/Grafik-Evidenz im vorhandenen Evaluator sind implementiert; tatsächliche Modellmessung und verbleibende Unsicherheit werden separat ausgewiesen. |

„Vervollständigt“ bedeutet hier die nachgewiesene Abdeckung dieser benannten Regeln und Risiken. Weder 100 % Code-Coverage noch eine beliebig große Testanzahl ist das Abnahmekriterium.

### Aufgabe 1: Ausgangsstand prüfen und Abdeckungsmatrix festhalten

**Files:** Create `docs/tutor-test-matrix.md`. Read die in diesem Plan genannten Tests, `package.json`, `vitest.config.ts` und die drei SSOTs. Noch keine bestehenden Testdateien ändern.

**Interfaces:** Consumes bestehende Regeln, Testtitel und Testkommandos. Produces eine Tabelle mit `Regel/Fall-ID`, `Quelle`, `Testdatei und Testname`, `ersetzte Komponente`, `Assertions`, `Gate`, `Status`. Status ausschließlich `belegt`, `zu ergänzen`, `Produktbefund` oder `Modellmessung offen`.

- [x] Für die Regeln der Aufgaben 2–8 vorhandene aussagekräftige Tests zuordnen. Vorhandene Abdeckung wiederverwenden; keine Kopie nur für eine höhere Testanzahl erzeugen.
- [x] Strukturcode-Korrektur mit den Review-Suites einschließlich `tests/client/tutor-review-structure.test.ts` prüfen. Gegenbeispiel: Key `answer`, gültige Klassifikation bleibt `answer`, freie Inhalte werden maskiert, Collector verliert deshalb keinen Eintrag, Export validiert. Falls noch offen: den fachlichen Inhalt des vorhandenen [Korrekturauftrags](../prompts/2026-11-11-tutor-review-structural-redaction-opus.md) selbst umsetzen; der historische Name „Opus“ ist keine Voraussetzung für Modellwechsel oder Unterbrechung. Bereits behobene Fälle mit Beleg schließen.
- [x] `npm run test:tutor-quality` ausführen; aktuellen Zähler und Laufzeit dokumentieren. Die früheren 764 Tests sind ein historischer Vergleichswert, keine vorgegebene neue Sollzahl.
- [x] `npx vitest run --project=unit-client tests/client/tutor-review-structure.test.ts tests/client/tutor-review-chain.test.ts tests/client/tutor-review-findings.test.ts` ausführen. Erwartet: alle Tests grün; fehlende Dateien oder echte Fehler als Befund behandeln.
- [x] `npm run check:docs` ausführen. Matrix und Anfangsstand als eigenes überprüfbares Ergebnis festhalten; ungelöste Tests nicht durch Status „belegt“ ersetzen.

### Aufgabe 2: Serviceentscheidungen mit gezielt widersprüchlichen Modellantworten prüfen

**Files:** Create `tests/server/services/tutor/tutor-response-contract.test.ts`. Reuse `support/tutor-quality-scenario-runner.ts`; Read `tutor-service.ts`, `curriculum-tutor-adapter.ts`, `tutor-quality-scenarios.test.ts`, `session-question-repetition.test.ts` und `mastery-progression.test.ts`.

**Interfaces:** Consumes `runTutorQualityScenario(scenario: TutorQualityScenario): Promise<TutorQualityScenarioTrace>` mit `provider.result`, `stateBefore`, `stateAfter`, `providerRequests`. Produces zusätzliche Assertions auf öffentliche Serviceergebnisse und echte Progression. Für Fälle, die der Einzelrequest-Runner nicht abbildet, einen kleinen lokalen Fake in der neuen Datei verwenden; kein Umbau des vorhandenen Runners erforderlich.

- [x] Fall `RC-01`: Provider liefert eine schemafähige, aber fremde Topic-/Question-/Strategy-Zuordnung. Assertions: Ergebnis und State entsprechen dem tatsächlichen Plan; Providerkennungen werden nicht zur Autorität. Mindestens eine Kennung bewusst verschieden wählen.
- [x] Fälle `RC-02a/b`: Exakt beziehungsweise heuristisch wiederholte Frage nach erfolgreicher Antwort; als Gegenkontrolle schwache Antwort auf weiterhin offene Frage. Assertions: erfolgreicher Fall ersetzt die erkannte Wiederholung; offener schwacher Fall darf die aktuelle Frage behalten. Keine allgemeine Erkennung jeder semantischen Paraphrase behaupten.
- [x] Fälle `RC-03a/b`: Echter Plan mit Frage versus Transition/Blocked ohne Ersatzfrage. Assertions: Planfrage ersetzt; Transition/Blocked behält die bereits geprüfte/reparierte Frage. Nicht nur `question !== oldQuestion`, sondern erwarteten Text beziehungsweise exakte Herkunft prüfen.
- [x] Fälle `RC-04a/b`: Abbruch oder Providerfehler nach Beginn der Planung. Assertion: gesamter Progression-State bleibt gegenüber `structuredClone(before)` unverändert. Die erfolgreiche Gegenkontrolle muss die erwartete Evidenz genau einmal hinzufügen.
- [x] Fall `RC-05`: Fehlende versus ausreichende Mastery-Evidenz bei identischer Schwierigkeit; danach identische Evidenz bei zwei zulässigen Schwierigkeitswerten. Kontrollierte Mini-Topic-Fixture ohne Auswahlengpass verwenden. Assertions: genaue Mastery-Entscheidung folgt den Indikatoren und unterschiedlichen Fragearten; Difficulty allein erklärt kein Thema für gemeistert. Damit die bekannte schwache Einzelassertion durch einen zusätzlichen starken Test ergänzen.
- [x] `npx vitest run --project=unit-node tests/server/services/tutor/tutor-response-contract.test.ts` ausführen. Neue Defekttests müssen vor einem nötigen Fix aus fachlichem Grund fehlschlagen. Bereits korrektes Verhalten darf sofort grün sein; dessen Erkennungskraft durch die Gegenkontrollen belegen. Keine künstliche rote Phase durch eine fehlende Importdatei als Produktnachweis ausgeben.

### Aufgabe 3: Klassifikation, Bewertung und Hilfeschritte als echte Zustandsfolge prüfen

**Files:** Create `tests/server/routes/tutor-mocked-dialog.routes.test.ts`. Modify `vitest.config.ts` nur zur Einordnung in `serializedHttpUnitTests`. Read `server/routes/tutor-support.routes.ts`, `server/services/tutor/learning-support.ts`, `learning-support-store.ts`, bestehende Lernhilfe-Routentests und die geprüfte IT06.4-Fixture.

**Interfaces:** Consumes `registerTutorRoutes`, echter `TutorService`, echter `CurriculumTutorAdapter`, `TutorSupportStore` sowie `tutorResponseSchema`/`tutorSupportResponseSchema`. Produces eine sequenzielle HTTP-Strecke; ausschließlich Provider und fester Kurs-Resolver sind Fakes. Der Testclient übernimmt die tatsächlich ausgegebenen Bindungen und verwendet für Retries dieselbe Aktionskennung.

- [x] Lokalen Testserver nach vorhandenem Muster auf `127.0.0.1` starten und zuverlässig schließen. Fake-Provider-Aufrufe mitzählen; unerwartete weitere Generierungen müssen den Test scheitern lassen, statt beliebige Defaultantworten zu bekommen. Keine gemockten Klassifikatoren, Bewertungsfunktionen oder Stores.
- [x] Kontrastpaare `SD-01`: „Welche Variable meinst du?“ → `clarification`; „Ich brauche einen Tipp“ → `help`; „Ist es 1?“ und „Meine Erklärung: Bit 7 ist gesetzt, also 1.“ → `answer`. Jede Klärung/Hilfe behält die Frage, trägt keine Sterne, erhöht `answerAttempts` nicht und verändert keine Mastery-Evidenz. Fachliche Antwortversuche werden dagegen als Versuche gezählt.
- [x] `SD-02`: Fake bewertet die handgeprüft richtige IT06.4-Antwort `1` mit 1 und „falsch“. Assertions: ausgelieferte Referenzkorrektur bestätigt die Antwort, Bewertung liegt im erwarteten Band 4–5; Review beziehungsweise Evaluation bewahrt Rohbewertung und Korrekturentscheidung getrennt. Gegenkontrolle `0`: trotz Fake-Bewertung 5 keine Anerkennung als richtig.
- [x] `SD-03`: Zwei Klärungen erlauben Überspringen, aber keine Musterantwort; drei eigene erfolglose Antworten erlauben die vorhandene Referenz. Nach gezeigter Referenz erzeugt eine wiederholte Antwort keine neue unabhängige Kompetenzbewertung. Alle Zähler und Sperren vor und nach der Grenze prüfen, nicht nur die finale Schaltfläche.
- [x] `SD-04`: Identischer Retry zählt einmal und liefert Replay; andere Nutzdaten mit derselben Aktionskennung erzeugen Konflikt. Bei Retry weder zusätzliche Provider-Generierung noch doppelte Evidenz; zwei verschiedene echte Aktionen bleiben zwei Aktionen.
- [x] `SD-05`: Ohne passende Referenz bleibt die Antwort modellabhängig. Kein Test darf aus einem Fake-Rating eine allgemeine fachliche Korrekturfähigkeit der Anwendung ableiten.
- [x] `npx vitest run --project=unit-node-http tests/server/routes/tutor-mocked-dialog.routes.test.ts` ausführen. Erwartet: keine übersprungenen Fälle, gültige Antwortschemas, exakte Zustands- und Aufrufzahlen. Fehlende Vertragserfüllung als Produktbefund bearbeiten, ohne den Fake nachträglich passend zu machen.

### Aufgabe 4: Sketchvarianten und Referenzbindung prüfen

**Files:** Create `tests/server/services/tutor/tutor-context-variants.test.ts` und `tests/fixtures/tutor-quality/TQ-REG-002-dice-context.ino`. Reuse vorhandene Faktenextraktion und Projekt-/Board-Fixtures. Read `curriculum/sketch-facts.ts`, `question-reference.ts`, `tutor-board-context.test.ts`, `planner-project-files.test.ts` und `learning-support.test.ts`.

**Interfaces:** Consumes echte Kontextaufbereitung, Faktenextraktion und Referenzauflösung sowie mitgeschnittene `providerRequests`. Produces deterministische Varianten derselben fachlichen Ausgangslage. Der Würfel-Sketch aus Anhang A ist eine neue, ausdrücklich zu prüfende Fixture; keine Behauptung, dass jeder historische Request exakt diesen Code enthielt.

- [x] `CV-01`: Würfel-Sketch aus Anhang A übernehmen und unabhängig festhalten: `show` enthält keinen Serial-Ausgabeaufruf; `Serial.begin` initialisiert; die `Serial.println`-Zeile ist auskommentiert. `t` ist lokal `static unsigned long`, wird im gezeigten Code nicht aktualisiert; `switchInit` wird dort nicht aufgerufen. Keine Musterfakten aus einer früheren Tutorbehauptung übernehmen. Diese manuellen Referenzfakten müssen nicht sämtlich neue Felder der bewusst begrenzten Faktenextraktion werden: vorhandene Fakten und tatsächlich gesendeten Kontext prüfen, die weitergehenden Aussagen als unabhängige Judge-Referenz verwenden.
- [x] `CV-02`: Kommentare ergänzen/entfernen und Variablennamen konsistent ändern. Assertions: ausgeblendete Aufrufe bleiben inaktiv; relevante Typ-/Aufruffakten und Aktivierung bleiben bei semantisch gleicher Variante gleich. Der Providerprompt enthält den richtigen aktuellen Kontext und nicht den alten Variablennamen.
- [x] `CV-03`: Tatsächlich einen Serial-Ausgabeaufruf aktivieren. Gegenkontrolle: der passende Fakt und gegebenenfalls die Frageanwendbarkeit ändern sich. Ein Test, der alle Varianten immer gleich akzeptiert, reicht nicht.
- [x] `CV-04`: Dieselbe relevante Deklaration zwischen Hauptdatei und Header verschieben; doppelte oder veraltete Angaben ausschließen. Danach einen bedeutungsverändernden Header ergänzen: eine vorher gültige Referenz darf nicht weiterhin automatisch angewandt werden.
- [x] `CV-05`: Referenz unter passendem Sketch/Board verfügbar, nach relevanter Code-/Boardänderung nicht anwendbar. Dieselbe Modellbewertung verwenden, damit die Gegenüberstellung wirklich die Bindung prüft. Eine unbekannte Spracheigenschaft darf nicht durch optimistische Gleichsetzung als „gleicher Code“ durchgehen.
- [x] `npx vitest run --project=unit-node tests/server/services/tutor/tutor-context-variants.test.ts` ausführen. Assertions betreffen konkrete Fakten, Bindungen und gesendeten Kontext; ein Prompt-Satz „Erfinde nichts“ allein erfüllt keinen Faktentest.

### Aufgabe 5: Grafik und endgültige Frage gemeinsam prüfen

**Files:** Create `tests/server/services/tutor/tutor-graphic-question-contract.test.ts` und `tests/client/tutor-graphic-contract.test.tsx`. Reuse die Grafikmatrix, Rendererregressionen und Lebenszyklustests. Read `tutor-service.ts`, `shared/tutor-mermaid-rules.ts`, `client/src/lib/tutor-mermaid.ts` und `tutor-mermaid-preview.tsx`.

**Interfaces:** Consumes echte Provideradapter-/Serviceverarbeitung und `renderMermaidDiagram`; Provider-HTTP ist kontrolliert. Produces Prüfungen von endgültiger Frage, ausgeliefertem Mermaid, Diagnoseentscheid und DOM; kein neuer Diagrammparser.

- [x] `GQ-01`: Providerfrage mit gültiger Grafik wird durch eine fachlich andere echte Planerfrage ersetzt. Erwartung anhand des geltenden Grafikvertrags prüfen: eine nicht mehr passende Providergrafik wird nicht kommentarlos zur neuen Frage gezeigt; Verwerfen und Auslöser sind nachvollziehbar.
- [x] `GQ-02`: Keine Frageersetzung als Gegenkontrolle. Die gültige Grafik bleibt erhalten; geprüft werden konkrete Knoten/Kanten und die zugeordnete Grafikkennung, nicht nur irgendein vorhandenes SVG.
- [x] `GQ-03`: Fehlend, leer, sichere unterstützte Grafik, nicht unterstützte Syntax und gesperrte Direktive als getrennte Fälle. Ablehnung verändert weder gültigen Fragetext noch Bewertung; Server und Renderer verwenden denselben einschlägigen festen Grund. Keine künstliche Sicherheitsablehnung für bloß fehlende Grafik.
- [x] `GQ-04`: Gehaltene Folgefrage bleibt bis „Weiter“ einschließlich ihrer Grafik unsichtbar; danach werden Frage und Grafik zusammen sichtbar und nur einmal als angezeigt erfasst. Hilfen bleiben gemäß Vertrag textbasiert.
- [x] `npx vitest run --project=unit-node tests/server/services/tutor/tutor-graphic-question-contract.test.ts tests/server/services/tutor/tutor-graphic-matrix.test.ts tests/server/services/tutor/tutor-graphic-finalization.test.ts` ausführen. Danach `npx vitest run --project=unit-client tests/client/tutor-graphic-contract.test.tsx tests/client/tutor-mermaid-regressions.test.ts tests/client/tutor-graphic-lifecycle.test.tsx`. Erwartet: alle Fälle grün, einschließlich der Gegenkontrollen.
- [x] Eine technisch sichere, aber fachlich falsche Grafik ausdrücklich als Modellqualitätsfall in Aufgabe 8 weiterführen. Ohne vorhandenen semantischen Wächter darf dieser Test keine automatische fachliche Korrektur des Renderers voraussetzen.

### Aufgabe 6: Vollständigen Mock-Lernlauf einschließlich verspäteter Antworten absichern

**Files:** Create `e2e/tutor-mocked-lifecycle.spec.ts` und, soweit noch fehlend, `tests/client/tutor-review-state-machine.test.ts`. Read bestehende Tutor-Review-/Grafik-E2Es und `client/src/lib/tutor-diagnostic-runtime.ts`. Vorhandene Testservermuster verwenden, keinen zweiten Anwendungspfad bauen.

**Interfaces:** Consumes Browser → echte Tutor-API → echter Service/Adapter → lokaler kontrollierter OpenAI-kompatibler Provider. Produces sichtbare Zustände und einen über den echten Kopierknopf exportierten, schemafähigen Review. Providerantworten durch Promise-/HTTP-Freigabe steuern, nicht durch lange feste Sleeps.

- [x] `LC-01`: Frage → Klärungsbedarf → schwacher Antwortversuch → passender Referenzfall mit absichtlich falscher Modellbewertung → korrekt ausgelieferte Bewertung → „Weiter“. Assertions: aktuelle Frage, Sterne, Zähler, Fokus, erhaltene Antwort und nächste Frage entsprechen jedem Schritt. „Weiter“ löst keine neue Provideranfrage aus.
- [x] `LC-02`: Eine Antwort offen halten, dann Kontext wechseln oder neue Runde beginnen. Späteres Ergebnis darf die aktuelle Lernfrage nicht überschreiben. Browser- und Serverzustand getrennt beurteilen: Ein lokaler Reset ist nicht automatisch ein serverseitiger Abbruch.
- [x] `LC-03`: Request → Debug leeren → verspätete Antwort; außerdem DEBUG aus/ein. Das alte Ergebnis erzeugt weder neuen Review-Schritt noch technische Grafik-/Abschlussereignisse in der neuen Erfassungsepoche. Frischer Request danach wird wieder vollständig erfasst. DEBUG aus stoppt neue Aufnahme; es bedeutet nach aktuellem Vertrag nicht automatisch Löschen des vorhandenen Mitschnitts.
- [x] `LC-04`: Filter setzen und technischen Puffer überfüllen; der separate Review enthält trotzdem alle tatsächlich aufgenommenen fachlichen Schritte. Kopie mit `tutorReviewExportSchema` prüfen und bekannten synthetischen Schlüssel in freien Inhalten ausschließen. Öffentliche Codes, die zufällig dem Schlüssel gleichen, nicht als Secretleck fehlinterpretieren.
- [x] `LC-05`: Fehlender/ungültiger Review-Block lässt gültige Frage und Bewertung nutzbar. Für Erfassungsgrenzen bleibt Unvollständigkeit sichtbar; kein schrittweises Wiederauffüllen gelöschter Daten.
- [x] `npx vitest run --project=unit-client tests/client/tutor-review-state-machine.test.ts` für eine tatsächlich ergänzte Clientdatei ausführen. Danach `npx playwright test --project=browser e2e/tutor-mocked-lifecycle.spec.ts` gegen frisch gebauten Client. Erwartet: alle fachlichen Assertions im ersten Versuch erfüllt; erfolgreiche Wiederholung nach einem fehlgeschlagenen Erstversuch gesondert dokumentieren.

### Aufgabe 7: Erkennungskraft und CI-Abdeckung nachweisen

**Files:** Update `docs/tutor-test-matrix.md` und `docs/proposals/report-tutor-test-completion.md`; Modify `vitest.config.ts` nur für neue serialisierte Routenfälle. Änderungen an `package.json` oder `.github/workflows/ci.yml` nur, wenn eine nachgewiesene Entdeckungslücke besteht.

**Interfaces:** Consumes neue und bestehende Testfälle sowie echte Runner-Ergebnisse. Produces eine nachvollziehbare Abnahme, die feste Anwendungsregeln und offene Modellfragen unterscheidet.

- [x] Mit `npx vitest list --project=unit-node --project=unit-node-http --project=unit-client` nachweisen, dass neue Testdateien dem richtigen Projekt zugeordnet sind. Kein Routenfall darf versehentlich außerhalb des vorgesehenen seriellen Projekts verbleiben.
- [x] Neue Tests auf falsche Sicherheit prüfen: keine ausschließlich breiten Regex-/`toBeTruthy`-Assertions für konkrete Fachregeln; keine vom selben Produktalgorithmus berechnete Sollbewertung; keine stillen Fake-Defaultantworten; kein unnötiges Ersetzen von Service/Planer/Store im integrierten Test.
- [x] Für jeden neuen wesentlichen Schutz eine gezielte Gegenprobe dokumentieren. Zuerst auf bereits defektem Stand beobachtetes Rot verwenden. Wo das Verhalten schon korrekt war, in isolierter Arbeitskopie einen passenden Schutz kurz deaktivieren und den betroffenen Test rot sehen; Änderung vollständig zurücknehmen. Keine Schwächung produktiver Tests oder unerlaubte Änderung fremder Arbeit. Vorhandene unterschiedliche Positiv-/Negativfälle bleiben Pflicht.
- [x] Neue Fälle in der Matrix mit tatsächlichen Assertions und Gate eintragen. Nicht implementierte Tutoranforderungen als `Produktbefund`, nicht als grünen Mockbeleg oder unbegründetes Skip ausweisen.
- [x] `npm run test:tutor-quality`, `npm run test:unit`, `npm run check`, `npm run lint`, `npx knip`, `npm run check:docs` und `git diff --check` ausführen. Bei UI-/Laufzeitänderung Build und sämtliche Tutor-Browsertests ausführen; vor einem späteren Push zusätzlich die nach Repository-Policy vorgeschriebene Gesamtprüfung.
- [x] Bei Produktcodeänderungen Coverage und Sonar-Gate frisch dem geprüften Stand zuordnen. Unterschied zwischen bestanden/übersprungen, kontrollierten Providern und echtem Modell explizit dokumentieren. Ein grüner Code-Check ersetzt Aufgabe 8 nicht.

### Aufgabe 8: Echte Modellqualität auf denselben Referenzfällen ergänzen

**Files:** Extend `evals/tutor-quality/anchor-corpus.yaml`; Reuse neue Würfel-Fixture. Create `tests/server/services/tutor/evaluation/tutor-dialog-regressions.test.ts`, `tests/server/services/tutor/evaluation/tutor-judge-extended-evidence.test.ts` und `server/services/tutor/evaluation/dice-context-fixture.ts`. Modify `evaluation/anchor-corpus.ts`, `anchor-course-content.ts`, `real-provider-evaluation.ts`, `judge.ts`, `ssot/ssot_function_definition_TutorQualityEvaluation.md` und erforderliche Report-Metadaten. Die Versions-/Hash-/Zitatquellen-Pins in `tests/server/services/tutor/evaluation/anchor-corpus.test.ts` und `judge.test.ts` nachvollziehbar auf den neuen Vertrag migrieren, sofern der Sonnet-Startauftrag erteilt wurde. Keine davon unabhängigen Assertions löschen.

**Interfaces:** Consumes vorhandene `TutorQualityEvaluationScenario`-Struktur, Korpusloader, `runTutorQualityEvaluation`, feste fachliche Referenzen und getrennte Fake-/Real-Provider. Produces versionierte Fälle mit klarer Aussage, welche Modellqualität überhaupt beobachtet werden kann. Keine automatische neue Ausgabe von Lösungstexten oder vollständigen Prompts an den Produktbrowser.

- [x] Fälle für unklare Variablenbezüge, Bitte um Präzisierung, Wiederholung nach gelöstem Ziel, erfundene aktive Serial-Ausgabe und begründeten Einwand mit nötiger Selbstkorrektur anlegen. Dafür Anhang B verwenden. Erwartete Klassifikation nur festlegen, soweit der aktuelle Produktvertrag sie trägt; keine zusätzliche Einwandspolitik oder neue Klassifikation erfinden.
- [x] Fallfakten unabhängig am Sketch prüfen. Beispiel: Im geposteten `show` steht kein Serial-Aufruf. Ein „guter“ Fake bestätigt diese Fakten nicht wissenschaftlich, sondern liefert einen bekannten Auswertungseingang.
- [x] Jeden neuen Auswertungspfad mit mindestens einer bekannten guten und einer absichtlich schlechten Fake-Antwort durchlaufen. Assertions: gute Antwort besteht die betreffende Prüfung; falsche Rückmeldung beziehungsweise ein Fake-Judge-`fail` erscheint als genau zugeordneter Befund. Damit wird der Evaluator geprüft, nicht bereits das echte Modell.
- [x] Die folgende begrenzte Erweiterung umsetzen und im Evaluations-SSOT festhalten: Der Judge bewertet weiterhin nur den letzten Turn eines Falls. Für frühe Schritte separate Szenarien mit dem passenden Gesprächspräfix verwenden; kein frei wählbarer Turnindex und kein weiterer Runner. Zusätzlich zum bisherigen Dialog-/Hilfefall darf ein abschließender `initial`-Turn beurteilt werden. `reveal` und `skip` bleiben ausgeschlossen.
- [x] In `TutorQualityJudgeInput` das optionale `turnKind?: "initial" | "dialog" | "clarify" | "hint"` und in `tutor` das optionale `mermaid?: string` ergänzen. `buildJudgeInput` setzt die tatsächliche Art des bewerteten Turns. Bei `initial` ist `question` die wirklich ausgelieferte Frage, `learnerAnswer` leer und fehlendes Feedback leer; `tutor.followUpQuestion` trägt diese ausgelieferte Frage als vorhandene Zitatquelle. Keine Lernendenantwort, Bewertung oder Rückmeldung erfinden. Alte manuell gebaute Judge-Inputs ohne `turnKind` bleiben für Dialogtests gültig.
- [x] `TutorQualityJudgeSource` um `focus?: "response" | "graphic"` ergänzen; Default `response`, ungültige Fokuswerte im Korpusparser ablehnen. Bei `graphic` und fehlendem oder leerem tatsächlich ausgeliefertem Mermaid keine semantische Grafikprüfung behaupten: `status: "not-evaluated"`, `reason: "graphic-not-provided"`, kein Judge-Call. Der bestehende Verdictpfad kann das als `inconclusive` ausweisen. Es ist kein technischer Produktfehler, wenn bei einer Frage keine Grafik nötig ist; diese Fälle getrennt von einem Grafikprüffall führen.
- [x] `tutor.mermaid` als vierte feste Zitatquelle ergänzen; optional fehlende Grafik ist eine leere Quelle. Exakte Zitate aus einer einzigen Quelle bleiben Pflicht; keine Zitate aus zusammengefügtem Feedback und Grafik, keine Ausweitung auf beliebige Rohfelder. Nur tatsächlich ausgeliefertes Mermaid als Text einbeziehen, kein SVG rendern und keine bereits verworfene Providergrafik als sichtbare Grafik beurteilen. Bestehende Erfassung der Providerentwürfe getrennt erhalten.
- [x] Judge-Promptrevision gegenüber dem vorgefundenen Stand erhöhen; aktuell ist das `tutor-quality-minimal-criteria-v2`, entsprechend ist die nächste Revision v3. Korpusversion ebenfalls einmal gegenüber dem Startstand erhöhen, Digests aus den tatsächlich geänderten Inhalten berechnen. Versions-/Hash-Pins und die bekannte Zitatquellen-Fixture gemeinsam migrieren. In Tests dokumentieren, dass eine absichtlich hinzugefügte vierte Quelle den alten Drei-Quellen-Vertrag ersetzt; die alten drei Quellen und sämtliche Ablehnungen bleiben geprüft. Haupt-Tutorprompt und dessen Revision für diese Evaluatoränderung unverändert lassen.
- [x] Neue Regressionen: Initialfrage ohne Feedback ist auswertbar; Dialog bleibt auswertbar; Support `clarify`/`hint` bleibt auswertbar; `skip`/`reveal` bleibt ausgeschlossen. Exaktes Grafikzitat wird akzeptiert; erfundenes und quellenübergreifendes Zitat wird abgelehnt. Fehlende Grafik im Grafikfokus wird nicht bewertet und verursacht keinen Judge-Call. Modelldaten mit eingebetteten Anweisungen bleiben Daten, keine Promptanweisungen. Fokus und tatsächliche Turnart müssen dem Szenario beziehungsweise Transcript nachvollziehbar zugeordnet bleiben.
- [x] Schwere Einzelbefunde im Abschlussbericht unabhängig vom Prozess-Exitcode sichtbar machen. `warn`, `not-run` und `inconclusive` sind keine uneingeschränkte Modellfreigabe. Die bestehende Mehrheitsregel nicht stillschweigend durch neue Test-Sollwerte ändern; eine strengere Freigaberegel erfordert eine explizite Vertragsentscheidung.
- [x] `npx vitest run --project=unit-node tests/server/services/tutor/evaluation/tutor-dialog-regressions.test.ts tests/server/services/tutor/evaluation/tutor-judge-extended-evidence.test.ts tests/server/services/tutor/evaluation/judge.test.ts tests/server/services/tutor/evaluation/anchor-corpus.test.ts tests/server/services/tutor/evaluation/http-replay.test.ts` und anschließend `npm run test:tutor-quality` ausführen. Ergebnis ist zunächst deterministisch abgesicherte Evaluationsfähigkeit.
- [x] Anschließend ein separates Live-Protokoll festlegen: feste angefragte und tatsächlich zurückgegebene Modelle, sauberer relevanter Git-Stand, identische Prompt-/Korpusrevision, vorab ausgewählte Fälle, zunächst 3–5 Stichproben pro Fall als Screening und ein genehmigtes Callbudget einschließlich Listen/Judge. Ohne festgelegtes Budget keine echten Aufrufe starten. Technische Ausfälle nicht durch neue Glückstreffer ersetzen. **Status: Protokoll festgelegt (Bericht, Abschnitt 10); keine Aufrufe ohne genehmigtes Budget.**
- [ ] Live-Bericht je Fall mit geplant/ausgeführt/auswertbar, Rohmodellfehlern, ausgelieferten Fehlern, Anwendungskorrekturen und ungültigen Judge-Ergebnissen erstellen. Strittige und kritische Beurteilungen menschlich nachprüfen. Ein zweiter kalibrierter Beurteiler und Untersuchungen mit Lernenden bleiben gesonderte Qualitätsarbeit; weder Fake-Pass noch 3/3 Live-Pass sind ein allgemeiner Lerneffekt-Nachweis. **Status: nicht ausgeführt – kein Budget beauftragt.** Die Berichtsstruktur steht in `docs/proposals/report-tutor-test-completion.md`, Abschnitt 10.

## Abschlussentscheidung

- **Eigene Logik abgedeckt:** A und B abgeschlossen, benannte Regeln mit aussagekräftigen Tests belegt und keine wesentlichen offenen Produktbefunde. Vorhandene grüne Tests bleiben grün; neue Tests laufen im Gate.
- **Modellqualität erweitert prüfbar:** neue C-Fälle mit guten und schlechten kontrollierten Antworten validiert. Das ist noch keine positive Messung des echten Modells.
- **Modelllauf durchgeführt:** tatsächliche Stichproben samt Revisionen, Befunden und Ausfällen dokumentiert. Offene Grafik-/Judge-Verträge, fachliche Schwächen und verbleibende Unsicherheit werden explizit ausgewiesen.

Die Ausführung endet nach Aufgabe 7, nachdem auch Aufgabe 8 umgesetzt ist. Ohne genehmigtes Modellbudget werden sämtliche lokalen Arbeiten einschließlich Evaluator und Live-Protokoll abgeschlossen; tatsächliche Modellaufrufe sind ausdrücklich `nicht ausgeführt – kein Budget beauftragt`. Das ist kein Grund, andere Aufgaben zu unterbrechen, und kein Nachweis echter Modellqualität.

## Anhang A: Eigenständige Regression-Fixture

Quelle: der vom Nutzer bereitgestellte Würfel-Sketch. Als `tests/fixtures/tutor-quality/TQ-REG-002-dice-context.ino` anlegen; Kommentare und auffällige Ausdrücke nicht „nebenbei“ reparieren. Sie gehören zum zu prüfenden Kontext.

```cpp
const byte PINS[]={2,3,4,5,8,10,11,12,13};
const byte P[][9]=
{{0,0,0,0,1,0 ,0 ,0, 0},
{0,0,1,0,0,0 ,1 ,0 ,0},
{0,0,1,0,1,0 ,1 ,0 ,0},
{1,0,1,0,0,0 ,1 ,0 ,1},
{1,0,1,0,1,0 ,1 ,0 ,1},
{1,1,1,0,0,0 ,1 ,1 ,1}};
const byte BTN = 7;
bool state = 0;
const bool DICING = 1;
const bool WAITING = 0;
void setup()
{
  Serial.begin(115200);
  for (byte i: PINS)
    pinMode(i, OUTPUT);
  pinMode(BTN, INPUT_PULLUP);
}
void loop()
{
//Serial.println(state);
  if ((state==WAITING)&&(digitalRead(BTN)==LOW))
  {
    run();
    digitalWrite(BTN, HIGH);
    state=WAITING;
  }
  delay(250);
}
void run()
{
  switch_all(0);
  delay(1000);
  for (unsigned int ms=50; ms<1000; ms+=200)
  {
    show(random(6));
    delay(ms);
  }
}
void show(const byte x)
{
  byte idx=0;
  for (byte i: PINS)
  {
    digitalWrite(i, P[x][idx]);
    idx++;
  }
}
void switch_all(bool v)
{
  for (byte i: PINS)
    digitalWrite(i, v);
}
void switchInit()
{
  static unsigned long t;
  static bool state;
  if (millis()-t>100)
    switch_all(state!=state);
}
```

## Anhang B: Konkrete zusätzliche Evaluationsfälle

Stabile Fall-IDs verwenden, bestehende IDs und Fälle bewahren. Die Fälle sind synthetische Regressionen auf Grundlage des Nutzerverlaufs; sie rekonstruieren keinen vermeintlich vollständig bekannten historischen Request.

| Fall-ID | Kontext und Eingabe | Unabhängige Prüfkriterien |
| --- | --- | --- |
| `TQ-DICE-INITIAL` | Anhang A, freier Tutor, `initial` | Frage nennt ihren konkreten Bezug; keine erfundene aktive Serial-Ausgabe oder bereits gespeicherter, laufend aktualisierter Zeitstempel in `t`. |
| `TQ-DICE-CLARIFY` | Fest gebundene Frage zum Typ von `t`; Eingabe „Welche Variable meinst du?“ | `clarification`, keine Sterne/Versuchserhöhung; Erklärung benennt `t` und `switchInit`, ohne eine fachliche Antwort zu erfinden. |
| `TQ-DICE-SERIAL` | Frage „Welche serielle Ausgabe wird in show(const byte x) ausgeführt?“; Antwort „Keine, in show steht kein Serial-Aufruf.“ | Richtige Kernaussage anerkannt; keine Behauptung einer aktiven Ausgabe in `show`; `Serial.begin` nicht mit Datenausgabe verwechseln. |
| `TQ-DICE-OBJECTION` | Vorangehender, als solcher gekennzeichneter synthetischer Verlauf mit falscher Tutorbehauptung zur Ausgabe; Einwand „Zeig mir den Serial-Aufruf in show; dort ist keiner.“ | Fachliche Selbstkorrektur statt erneuter falscher Behauptung. Keine neue unbewertete Einwandsklasse voraussetzen; Bewertungsfragen getrennt vom Fakt beurteilen. |
| `TQ-DICE-FOLLOWUP` | Richtige Erklärung des Wertebereichs von `unsigned long`, im Uno-Kontext 32 Bit einschließlich 0 | Rückmeldung bestätigt den Kern; Folgefrage verlangt einen neuen Denkschritt. Keine wortgleiche Textvorgabe für freie Modellfragen. |
| `TQ-GRAPH-PROCESS` | Vorhandene kleine Blink-/Ablauf-Fixture, freier Tutor, `initial`, Judge-Fokus `graphic` | Tatsächlich ausgelieferte Grafik ist zum Sketch und zur ausgelieferten Frage passend; Kanten-/Zustandsbehauptungen stimmen. Fehlende Grafik ergibt fehlende Grafikevidenz, keinen stillen Erfolg. |
| `TQ-GRAPH-NO-SOLUTION` | Frage nach einer noch herzuleitenden Abfolge, bekannte gute und schlechte Diagrammentwürfe in Fake-Proben; für Live-Ausführung nur tatsächlich ausgeliefertes Mermaid bewerten | Diagramm erklärt den Kontext, ohne die gesuchte Antwort vollständig vorzugeben. Eine bloß sichere Syntax reicht nicht. |

Für `TQ-DICE-CLARIFY` eine kleine feste Kurs-/Fokus-Fixture `dice-context` nach dem bestehenden `it064Content`-Muster registrieren. Sie bindet eine erste Frage zum Typ der lokalen Variable `t` und eine zweite zum Fehlen serieller Ausgabe in `show`. Keine Musterantwort beziehungsweise Referenzkorrektur für diese Fixture erfinden; die Fakten kommen aus Anhang A. Der HTTP-Fall startet regulär mit `initial` und übernimmt die tatsächlich ausgegebenen Bindungen; eine geskriptete Antwort auf eine andere Frage ist weiterhin ein Bindungsfehler.

Die Fälle `TQ-DICE-SERIAL`, `TQ-DICE-OBJECTION` und `TQ-DICE-FOLLOWUP` können als direkte Servicefälle mit den passenden expliziten Fragen und synthetisch gekennzeichneter Historie laufen. Sie prüfen dann Modellrückmeldung, nicht zusätzlich die HTTP-Klassifikation. Gute und schlechte Antworten samt Fake-Judge-Ergebnissen für jeden neuen Prüfweg vorbereiten. Fake-Judge-Ergebnisse beweisen die Zuordnung und Auswertung von Befunden; die tatsächliche fachliche Beurteilung des echten Judges bleibt eine getrennte Messung.
