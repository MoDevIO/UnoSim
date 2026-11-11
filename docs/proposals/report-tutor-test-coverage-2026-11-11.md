# Wie belastbar sind die Tutor-Tests?

Stand: 2026-11-11, Working Tree auf `feature/tutor-debug-graphics`.

## 1. Ergebnis und Grenzen dieser Prüfung

**Die Anwendungslogik des Tutors ist breit und für viele konkrete Fehlerfälle gut getestet. Die allgemeine fachliche und didaktische Zuverlässigkeit eines echten Modells ist damit nicht nachgewiesen.** Dafür gibt es bereits eine sinnvoll aufgebaute Live-Evaluation und dokumentierte echte Modellläufe. Deren Stichproben sind begrenzt; sie enthalten sowohl Erfolge als auch bekannte Schwächen. Ein grünes Sonar-Gate oder ein grüner Workflow lässt sich deshalb nicht mit „Der Tutor unterrichtet zuverlässig“ gleichsetzen.

Diese Analyse untersucht die vorhandenen Testwege, repräsentative Tests, den aktuellen Korpus, die Auswertungsregeln und die dokumentierten Live-Nachweise. Sie ist keine vollständige manuelle Durchsicht jeder Testassertion und keine neue Untersuchung mit Lernenden. Es wurden keine echten KI:connect-Anfragen ausgeführt und keine persönlichen Zugangsdaten verwendet.

> **Nachtrag 2026-11-11:** Der unten genannte Bereinigungsfehler ist inzwischen behoben (strukturgeprüfte Bereinigung, siehe [Prüfbericht, vierte Nachbesserung](review-tutor-review-capture-2026-11-11.md)). Der folgende Absatz beschreibt den Stand zum Zeitpunkt dieser Analyse.

Der Integrationsauftrag bleibt vorerst unerfüllt: Der aktuelle Mitschnitt hat noch den reproduzierten Fehler aus der [vierten Nachprüfung](review-tutor-review-capture-2026-11-11.md). Ein gültiger synthetischer Key `answer` führt dazu, dass die Bereinigung auch den öffentlichen Klassifikationscode `learnerInput: "answer"` verändert. Ein gültiger Servereintrag wird verworfen; ein lokal gespeicherter Schritt verletzt anschließend das Exportschema. Das betrifft die Verlässlichkeit des Diagnoseexports und ist kein Beleg für eine veränderte fachliche Tutorbewertung. Der [Opus-Korrekturprompt](../superpowers/prompts/2026-11-11-tutor-review-structural-redaction-opus.md) beschreibt Ursache, Korrektur und notwendige Regressionen. Deshalb wurden Commit, Push, Merge und Cleanup nicht ausgeführt.

## 2. Was „getestet“ hier jeweils bedeutet

Die entscheidende Frage lautet: **Welche Komponente durfte im Test tatsächlich frei antworten?**

| Testweg | Tatsächlich ausgeführte Teile | Woher kommt die Modellantwort? | Belastbare Aussage |
| --- | --- | --- | --- |
| Schema-, Parser- und Domänentest | Validierung, Klassifikation, Faktenextraktion, Planer, Zustandsregeln | Kein Modell oder feste Eingabe | Die geprüfte Regel funktioniert für diese Eingaben. |
| Service-Szenario | Echter `TutorService`, bei Kursinhalt auch echter Curriculum-Adapter | Vorgegebener Fake-Provider | Die Anwendung behandelt genau diese richtige, fehlerhafte oder widersprüchliche Ausgabe wie vorgesehen. |
| Routen-/Client-Integration | Je nach Test echte Handler und Stores oder zusätzlich HTTP; React-Hooks und Oberfläche | Generierung bzw. HTTP-Antworten simuliert | Vertrag, Zustände und Anzeige passen in der geprüften Kombination zusammen. |
| Tutor-Browsertest | Echter Browser; bei Grafik/Review auch echte Tutor-Routen, Service und Provideradapter über lokale HTTP-Server | Kontrollierter lokaler Provider | Die durchgehende technische Strecke funktioniert bis zum DOM beziehungsweise zur Zwischenablage. |
| Real-Provider-Evaluation | Echter Modellaufruf; Service- oder isolierte HTTP-Strecke, feste Szenarien | Tatsächliches KI:connect-Modell | Beobachtete Modell- und Produktqualität für diese Fälle, Revisionen und Stichproben. |
| Einsatz mit Lernenden | Reale Fragen, Rückfragen, Missverständnisse und Lernverläufe | Tatsächliches Modell und tatsächliche Lernende | Verständlichkeit, Nutzung und mit geeignetem Versuchsaufbau auch Lerneffekt. Dafür ist hier kein abgeschlossener Nachweis dokumentiert. |

Das Simulieren der Modellantwort ist eine Stärke der unteren Ebenen: Ein Test kann zuverlässig eine falsche Bewertung, eine Wiederholung oder eine gefährliche Grafik erzwingen. Er prüft dann die Reaktion der Anwendung. Er misst jedoch nicht, wie häufig ein echtes Modell diesen Fehler erzeugt.

Beispiel: Der [Szenario-Runner](../../tests/server/services/tutor/support/tutor-quality-scenario-runner.ts) verwendet den echten Service und echten Curriculum-Adapter, aber `generateLearningQuestion` liefert ein vorbereitetes Ergebnis. Der Test beweist, dass eine Planerfrage eine vorgegebene Modellfrage ersetzt. Er beweist nicht, dass ein Modell selbst eine verständliche Frage stellen würde.

## 3. Testkommandos und ihre Reichweite

Die Kommandos stehen in [package.json](../../package.json); die Projekte und Dateigrenzen in [vitest.config.ts](../../vitest.config.ts).

| Kommando | Reichweite | Echtes Modell? |
| --- | --- | --- |
| `npm run test:unit` | Gesamte Anwendung einschließlich Client, Server und HTTP-Testprojekt sowie Emulator | Nein, die Tutor-Provider werden kontrolliert. |
| `npm run test:tutor-quality` | Tutor- und Course-Content-Tests im Projekt `unit-node`, einschließlich Tests der Evaluationsinfrastruktur | Nein; auch ein Test mit „real-provider“ im Dateinamen kann die Infrastruktur mit einem Fake prüfen. |
| `npm run test:e2e` | Playwright-Browsertests; Tutor ist ein Teil davon | Die hier untersuchten Tutor-Suites verwenden vorbereitete Antworten. |
| `npm run validate:tutor-course-content -- <Verzeichnis>` | Prüfung eines konkreten Kursinhalte-Bundles, seiner Verträge und Qualitätsfälle | Nein. |
| `npm run eval:tutor-quality:real -- …` | Versionierter Korpus, echte Tutoraufrufe, optional echter semantischer Judge, Berichte und Transkripte | Ja, wenn Zugang, Modell, Budget und Vorbedingungen vorhanden sind. |
| `npm run eval:tutor-learning-support:live -- …` | Spezialisierter echter IT06.4-Lernhilfeverlauf über isolierte Produktionsrouten | Ja; eigene, enger gefasste Ergebnisregel. |

`test:tutor-quality` ist in der [CI](../../.github/workflows/ci.yml) eingebunden. Die [Real-Provider-Workflowdatei](../../.github/workflows/tutor-quality-real-provider.yml) wird dagegen ausschließlich manuell gestartet: kein PR-Trigger, kein Zeitplan. Das ist eine bewusst budgetierte Trennung. Es bedeutet zugleich, dass ein normaler grüner PR keine neue Modellmessung enthält.

Die gemeldeten rund 4.354 Anwendungstests betreffen das gesamte Projekt. Sie sind keine Anzahl unabhängig geprüfter Tutorfragen. Ebenso ist Code-Coverage ein Maß ausgeführter Codepfade, keine Trefferquote fachlich richtiger Rückmeldungen. Das Sonar-Kommando führt Coverage und statische Analyse aus; es ruft keine Modelle zur Qualitätsbewertung auf. Der Coverage-Lauf setzt für den Emulator `UNOSIM_SKIP_CORPUS=1`; dessen übersprungene Corpus-Tests dürfen nicht als ausgelassene Tutor-Modelltests interpretiert werden.

## 4. Welche Tutorfunktionen gut abgesichert sind – und welche Aussage offen bleibt

„Gut abgesichert“ bezieht sich hier auf die vorhandenen konkreten Regeln und Gegenbeispiele, nicht auf eine Fehlerfreiheitsgarantie.

| Funktion | Vorhandene Belege, Auswahl | Was damit gut geprüft wird | Was damit offen bleibt |
| --- | --- | --- | --- |
| Provider, Modellwahl, Fehlergrenze | [kiconnect-provider.test.ts](../../tests/server/services/tutor/kiconnect-provider.test.ts), `model-preference.test.ts` | Modellliste, erlaubte Automatikmodelle, Modellherkunft, JSON-Parsing, Authentifizierungsfehler, Abbruch und Timeouts, modellabhängige Temperatur | Verhalten eines entfernten Gateways unter realer Last; Qualität jeder angebotenen Modellversion |
| Sketch-, Board- und Projektkontext | `sketch-facts-linear.test.ts`, `tutor-board-context.test.ts`, `planner-project-files.test.ts`, Client-Sketchtests | Erkannte Fakten, gesendete Dateien, Boardabhängigkeit und konkrete Regressionsfälle | Vollständiges C++-Sprachverständnis oder eine Garantie, dass jede freie Behauptung des Modells zum Sketch stimmt |
| Kursinhalt und Aktivierung | [curriculum.test.ts](../../tests/server/services/tutor/curriculum.test.ts), `fallback-matrix.test.ts`, Course-Content-Validatoren | Auswahl passender Topics, positive/negative Qualitätsfälle, Hash-/Schemafehler, fehlende Inhalte und freier Fallback | Didaktische Qualität jedes Katalogtexts und jeder neuen Kombination mit einem eigenen Sketch |
| Fortschritt und Lernphasen | `mastery-progression.test.ts`, `multi-topic.test.ts`, `session-question-repetition.test.ts` | LEARN/DEEPEN/EXPAND, Evidenz, verbrauchte Fragen, blockierte Zustände und Themenwechsel | Ob die zugrunde liegende freie Modellbewertung die tatsächliche Kompetenz richtig einschätzt |
| Antwortbewertung und Klassifikation | [learning-support.test.ts](../../tests/server/services/tutor/learning-support.test.ts), `question-quality-regressions.test.ts`, Routenregressionen | Bekannte Antwort-/Rückfragetypen, Bewertungsregeln und Korrektur anhand geprüfter Referenzen | Beliebige umgangssprachliche Antworten, berechtigte Einwände, implizite Aussagen und fachlich neue Fälle |
| Hilfe, Überspringen und Musterantwort | Lernhilfe-Service-, Store-, Routen- und Clienttests | Freischaltung nach zwei Klärungen beziehungsweise drei Versuchen, Referenzbindung, nicht bewertete Hilfen, Abschlüsse | Ob ein echter Hinweis verständlich genug ist, zur passenden Schwierigkeit führt und die Lösung auch sinngemäß nicht verrät |
| Wiederholung und Fragenersetzung | [tutor-quality-scenarios.test.ts](../../tests/server/services/tutor/tutor-quality-scenarios.test.ts), Frage-/Sessionregressionen | Exakte und heuristische Duplikate, Planerautorität und konkrete Fallbacks | Jede semantische Wiederholung mit anderer Formulierung; eine sinnvolle neue Denkleistung nach erfolgreicher Antwort |
| Gleichzeitigkeit und Wiederholen fehlgeschlagener Aktionen | `session-concurrency.test.ts`, Lernhilfe-Storetests, [Client-Lernhilfetests](../../tests/client/tutor-learning-support.test.tsx) | Keine doppelte Verbuchung, gleiche Aktionskennung beim Retry, Abbrüche, Codewechsel, getrennte Sessions | Alle Kombinationen aus langsamen Antworten, Reset, wechselndem Kontext und Bedienaktionen |
| Bedienung und Darstellung | [tutor-learning.spec.ts](../../e2e/tutor-learning.spec.ts), [Statusindikator](../../e2e/tutor-status-indicator.spec.ts), Clienttests | Entwurfserhalt, Tastatur, Fokus, „Weiter“, schmale Ansichten, XXL-Schrift, Sterne und Modellanzeige | Verständlichkeit im echten Unterricht; vollständige Barrierefreiheit aller dynamisch erzeugten Inhalte |
| Grafiktransport und Renderer | [Grafikmatrix](../../tests/server/services/tutor/tutor-graphic-matrix.test.ts), [Rendererregressionen](../../tests/client/tutor-mermaid-regressions.test.ts), [Grafik-E2E](../../e2e/tutor-debug-graphics.spec.ts) | Unterstütztes Mermaid-Subset, feste Ablehnungsgründe, sichere Textbehandlung, Erhalt der Frage bei Grafikfehlern, gehaltene und sichtbare Grafik | Sinnvolle Grafikauswahl durch das echte Modell, fachlich richtige Kanten/Beschriftungen und kein grafischer Lösungsverrat |
| Debug und vollständiger Review-Export | Review-Chain-, Findings-, Panel-, Capture- und Routentests, [Review-E2E](../../e2e/tutor-review.spec.ts) | Pufferunabhängigkeit, Filter, Grenzen, Historie, Kontextwechsel, Secret-Bereinigung, Regeln und verspätete Ereignisse in vielen Gegenbeispielen | Der oben beschriebene Strukturcodefehler ist weiterhin offen. Ein technisch vollständiger Export bedeutet außerdem noch keine gute Tutorleistung. |

Ein wichtiger Unterschied innerhalb der Integrationstests: [tutor-next-question-real-route.test.tsx](../../tests/client/tutor-next-question-real-route.test.tsx) verwendet echte Supporthandler und einen echten Store, ersetzt aber `fetch` und die Generierung. Die neuen Grafik-/Review-E2Es führen zusätzlich echte lokale HTTP-Kommunikation mit dem Provideradapter aus. Beide Arten sind nützlich; sie haben unterschiedliche Reichweiten. Auch letztere prüfen kein frei antwortendes KI:connect-Modell und schalten für ihre isolierte Tutor-API das Rate-Limit aus.

Ein konkretes Beispiel einer zu schwachen Einzelassertion steht in [mastery-progression.test.ts](../../tests/server/services/tutor/mastery-progression.test.ts): Der Test „uses the configured criteria … keeps evidence separate from difficulty“ akzeptiert `probeable|unresolved|mastered` und prüft daneben die Länge einer konstanten Revision. Damit erzwingt er den im Titel behaupteten Zusammenhang nicht. Andere Tests, insbesondere in `curriculum.test.ts`, prüfen Mastery und Indikatoren deutlich konkreter. Daraus folgt eine gezielte Verbesserung dieses Tests, kein pauschales Urteil, dass Mastery ungetestet sei. Eine Änderung bestehender Tests erfordert nach der Repository-Policy eine begründete Freigabe; hier wurden sie nicht verändert.

## 5. Die vorhandene Live-Evaluation ist bereits eine brauchbare Grundlage

Der [normative Evaluationsvertrag](../../ssot/ssot_function_definition_TutorQualityEvaluation.md) trennt Anwendungsfehler, Modellqualität, technische Ausfälle und die Beurteilung durch einen Judge. Die [Implementierung](../../server/services/tutor/evaluation/real-provider-evaluation.ts) bietet dafür mehrere wichtige Eigenschaften:

- Feste Tutor- und Judge-Modellkennungen; `auto` ist in diesem Evaluator ausgeschlossen.
- Getrennte Stichproben mit frischem Zustandskontext, versionierter Korpus und geprüfte Vorbedingungen; ein relevanter schmutziger Working Tree wird abgelehnt.
- Begrenzte Anrufzahl, einschließlich Modelllisten und Judge, statt unbegrenzter Wiederholungen bis zum erwünschten Resultat.
- Getrennte Erfassung ursprünglicher Providerergebnisse, endgültiger Tutorantworten, Zustände, technischer Fehler und tatsächlicher Modellkennungen.
- [Manifest](../../server/services/tutor/evaluation/report.ts) mit Git-SHA, Korpus-/Sketch-Digests, Promptrevisionen und Prompt-Digests, angefragten und gelieferten Modellen sowie Temperaturen.
- Auswertungszustände für nicht ausgeführte, ungültige und technisch gescheiterte Läufe. Fehlende Evidenz muss nicht als Erfolg gezählt werden.

Der aktuelle [Korpus v15](../../evals/tutor-quality/anchor-corpus.yaml) enthält **28 Szenarien mit insgesamt 61 definierten Turns**, davon **19 Szenarien mit Judge-Kriterien** und **9 mit HTTP-Transport**. Das sind statisch gezählte Definitionen, keine Anzahl frisch ausgeführter Modellgespräche. Themen sind unter anderem Variablen, serielle Ausgabe, Pull-up, Bewertung, Wiederholung, Lernphasen, Strategien und die mehrschrittigen Lernhilfefälle IT06.4/IT06.1.

Das ist erheblich aussagekräftiger als nur „JSON kam zurück“. Es bleibt aber ein kleiner, gezielt gebauter Korpus. Die 28 Fälle sind weder 28 zufällig gezogene Unterrichtssituationen noch 28 gleichartige unabhängige Messungen. Verwandte Varianten verwenden dieselben Programme und Annahmen.

### Der Judge ist ein Messinstrument mit eigenen Fehlern

Der [Judge](../../server/services/tutor/evaluation/judge.ts) bekommt erlaubte Evidenz und fallbezogene Kriterien. Er muss `pass`, `fail` oder `unclear` liefern; ein Fehlerurteil benötigt ein im erlaubten Antworttext nachprüfbares Zitat. Parsertests prüfen Form, Kriterienkennungen, Dubletten und Zitatquellen. Das verhindert viele unbelegte oder kaputte Auswertungen.

Ein belegbares Zitat beweist allerdings nur, dass der zitierte Text vorhanden ist. Es beweist nicht, dass der Judge ihn fachlich oder didaktisch richtig interpretiert. Der SSOT nennt einen zweiten unabhängigen Judge ausdrücklich als noch nicht umgesetzt. Historische Smoke-Messungen sind an ihre damalige Promptrevision gebunden und keine allgemeine heutige Kalibrierung.

Der aktuelle Judge betrachtet den **letzten geeigneten Turn** eines vollständig ausgeführten Szenarios, nicht automatisch jede frühere Rückmeldung und nicht das gesamte Gespräch als zusammenhängenden Lernprozess. IT06.1 begegnet dem sinnvoll mit getrennten Szenarien für Beobachtung, Einwand und korrigierte Antwort. Frühere Turns haben außerdem ausgewählte deterministische Prüfungen, etwa gegen Lösungsliterale. Für neue mehrschrittige Qualitätsziele muss die Abdeckung aber ausdrücklich ergänzt werden.

Grafik ist eine besondere Lücke: Im aktuellen Korpus gibt es keine ausdrückliche `mermaid`-Erwartung. Die Evidenzauswahl des Judges enthält auch keine Grafikquelle. Eine gezeichnete falsche Abhängigkeit oder eine verratene Lösung im Diagramm kann deshalb trotz gut geprüfter technischer Grafikstrecke unbewertet bleiben. Reine Initialfragen sind im jetzigen Judgepfad ebenfalls nicht automatisch semantisch bewertet.

## 6. Warum ein grünes Ergebnis trotzdem täuschen kann

### 6.1 Der allgemeine Qualitätsstatus toleriert einzelne Modellbefunde

Die [Verdict-Regel](../../server/services/tutor/evaluation/quality-verdict.ts) verwendet für wiederholte Befunde je Fall:

`k(n) = max(2, floor(n / 2) + 1)`

Produktverletzungen führen unmittelbar zu `fail`. Unter anderem falsche Bewertungsbänder, Rohmodellverletzungen, fehlgeschlagene Judge-Kriterien und selbst `critical-issue` führen dagegen erst ab dieser Wiederholungsschwelle zu `fail`; darunter gilt `warn`. Nicht interpretierbare beziehungsweise fehlende Ausführungen können `inconclusive` ergeben.

Die CLI behandelt `pass` und `warn` als Exitcode 0. Auch `not-run` erhält den erfolgreichen Exitcode, obwohl es keine ausgeführte Qualitätsmessung darstellt. Der manuelle Workflow verwendet diese Exitcodes. Seine Vorgabe ist **eine Stichprobe pro Fall**, der Judge ist optional.

Die praktische Folge: **Ein einzelner fachlich kritischer Befund kann mit einem grünen Job enden.** Das folgt der derzeitigen Regel und ist kein neu entdeckter Implementierungswiderspruch. Für die Abnahme muss man dennoch den Bericht lesen. Eine Mehrheitsregel schützt vor einzelnen Schwankungen, beantwortet aber nicht, ob ein seltener schwerer Fehler im Unterricht akzeptabel ist. Unterschiedliche Fehlertypen können zudem jeweils unter ihrer eigenen Schwelle bleiben.

### 6.2 Der spezielle Lernhilfe-Live-Test urteilt nur über die Anwendung

`eval:tutor-learning-support:live` hat eine [andere Ergebnisregel](../../server/services/tutor/evaluation/learning-support-live.ts): Ein fehlgeschlagener Anwendungscheck führt zu `fail`; `pass` verlangt vollständige Stichproben mit bestandenen Anwendungschecks. **Die mitprotokollierten Modellchecks entscheiden diesen Status ausdrücklich nicht.**

Das ist für eine Messung der Anwendungskorrektur sinnvoll. Es darf nur nicht als positives Qualitätsurteil über das rohe Modell gelesen werden. Der Spezialtest verwendet außerdem teilweise enge Textmuster für „falsch“ beziehungsweise Lösungsverrat. Eine andere Formulierung kann unentdeckt bleiben; bloß unterschiedliche Klärungstexte müssen noch keine unterschiedlich hilfreichen Erklärungen sein. Sein Standardmodell ist `auto`, anders als beim allgemeinen Evaluator. Für Vergleichsläufe sollte hier ebenfalls ein Modell explizit festgelegt werden.

### 6.3 Die vorhandenen echten Läufe zeigen genau diesen Unterschied

Die folgenden Ergebnisse sind **dokumentierte historische Nachweise**, hier nicht neu erzeugt. Quelle ist [LearningQuestions, §21, TUT-07/TUT-08](../../ssot/ssot_function_definition_LearningQuestions.md):

- Am 07.11. bestanden mit dem dort genannten Tutor-Modell `openai-gpt5.5` alle 18 IT06.4-Stichproben des Laufs; andere geprüfte Modelle zeigten Fehlbewertungen oder ungültige Antworten. In vollständigen Stichproben konnte die Anwendung anhand der geprüften Referenz richtig bewerten. Das ist ein konkreter Erfolg der Schutzlogik, keine allgemeine Fähigkeit zur Korrektur beliebiger Antworten.
- Am 09.11. bestand der IT06.1-Verlauf mit Prompt v8 semantisch nicht. Unter v9 wurde die richtige dritte Antwort besser anerkannt; auf den Einwand ging die Rückmeldung weiterhin nicht in jeder Stichprobe ausreichend ein. Zwei ungültige Judge-Antworten führten zum Status `inconclusive`.
- Rate-Limits verhinderten Teile weiterer Läufe. Die später nachgeholten IT06.4-Fälle bestanden ihre kleinen Stichproben. Nicht ausgeführte Fälle werden dadurch nicht nachträglich mitgeprüft; unterschiedliche Läufe und Revisionen bleiben zu unterscheiden.

Es gibt also echte, auch negative Modellbefunde. Die Schwäche liegt nicht im völligen Fehlen von Live-Tests, sondern in deren begrenzter Reichweite, Stichprobengröße und der notwendigen Interpretation ihrer Ergebnisse.

## 7. Wie Modellvarianz sinnvoll geprüft werden kann

Freie Texte müssen nicht wortgleich sein. Ein sinnvoller Test akzeptiert verschiedene Formulierungen, solange feste Eigenschaften stimmen: konkrete Variable korrekt benannt, richtige Kernaussage anerkannt, eine Rückfrage nicht als fehlendes Wissen abgewertet, keine erfundene Sketchfunktion, fachlich richtige Grafik und keine vorweggenommene Lösung.

Niedrige Temperatur beseitigt diese Varianz nicht. Das lokale [Modellprofil](../../server/services/tutor/model-profile.ts) sendet standardmäßig 0,2; für die dort ausdrücklich hinterlegte Modellkennung `openai-gpt5.5` wird aufgrund des dokumentierten API-Vertrags 1 gesendet. Der Judge verwendet 0. Auch identische Parameter machen eine entfernte Modellausführung nicht zu einem deterministischen Unit-Test. Festhalten und vergleichen muss man die tatsächlich verwendete Modellkennung und alle relevanten Revisionen.

Eine kleine Rechnung zeigt die Grenze weniger Wiederholungen. Unter der **idealisierenden Annahme unabhängiger, gleich verteilter Bernoulli-Versuche** lautet bei null beobachteten Fehlern die einseitige obere 95-%-Grenze für die Fehlerwahrscheinlichkeit `1 - 0.05^(1/n)`:

| Fehlerfreie Wiederholungen desselben Prüfgegenstands | Obere Grenze unter dieser Annahme, gerundet |
| ---: | ---: |
| 1 | 95,0 % |
| 3 | 63,2 % |
| 5 | 45,1 % |
| 10 | 25,9 % |
| 20 | 13,9 % |
| 60 | 4,9 % |

Das sind **keine gemessenen Fehlerraten des Tutors**. Die Tabelle illustriert, warum „3/3 bestanden“ seltene Fehler nicht ausschließt. Ähnliche Prompts, gemeinsame Modellversionen und verwandte Programme können zusätzlich korrelieren. Die 28 verschiedenen Korpusfälle darf man für diese Rechnung nicht einfach als 28 Wiederholungen derselben Fehlerwahrscheinlichkeit zusammenzählen. Der allgemeine Runner erlaubt derzeit höchstens 20 Stichproben je Fall und 500 Calls je Lauf; größere Untersuchungen müssten als vorab definierte, vergleichbar dokumentierte Versuchsreihe geplant werden.

Ein guter Messbericht nennt deshalb pro Fall und Modell: geplante und tatsächlich auswertbare Stichproben, Rohmodellfehler, ausgelieferte Fehler, Anwendungskorrekturen, technische Ausfälle, ungültige Judge-Ergebnisse und menschlich bestätigte Befunde. Eine Gesamtzahl oder ein grünes Symbol reicht nicht.

## 8. Welche Fälle aus dem vorliegenden Tutorverlauf fehlen

Der übergebene Verlauf ist ein geeigneter Ausgangspunkt für konkrete neue Qualitätsfälle. Er sollte mit exakt zugehörigem Sketch und den tatsächlich übermittelten Kontextständen hinterlegt werden. Für den geposteten Code lassen sich insbesondere folgende Erwartungen unabhängig formulieren:

| Beobachtetes Problem | Zu prüfende Eigenschaft |
| --- | --- |
| „die betrachtete Variable“ ohne Namen | Die Frage nennt `t`, ihren Typ und gegebenenfalls `switchInit`; die Rückfrage nach dem Bezug wird beantwortet. |
| Berechtigte Bitte um Präzisierung bekommt zwei Sterne | Klärungsbedarf wird vom fachlichen Antwortversuch getrennt; keine negative Kompetenzbewertung allein wegen der Rückfrage. |
| Nach richtig erklärtem `unsigned long` kommt dieselbe Sache erneut | Ein erreichtes Ziel wird nicht durch bloße Umformulierung erneut abgefragt; eine Folgefrage verlangt eine neue Denkleistung. |
| Behaupteter aktiver Serial-Ausgabeaufruf in `show` | Bei genau diesem Code ist in `show` kein Serial-Aufruf vorhanden. `Serial.begin` initialisiert; die vorhandene `Serial.println`-Zeile ist auskommentiert. Die Rückmeldung darf keinen aktiven Aufruf erfinden. |
| Erst eine spätere Rückmeldung widerspricht früheren Behauptungen | Ein begründeter Einwand löst Prüfung und gegebenenfalls eine ausdrückliche Korrektur aus, statt die frühere falsche Behauptung weiterzutragen. |

Die vorhandenen IT06.1-Einwandsfälle decken einen verwandten, aber anderen Sachverhalt ab. Sie ersetzen diese Regressionen nicht. Aus dem pasted Verlauf allein ist außerdem nicht bewiesen, dass bei jedem alten Request genau derselbe Code gesendet wurde; gerade diese Unsicherheit soll der neue Mitschnitt künftig auflösen.

Für Grafiken sollten vergleichbare Fälle hinzukommen: eine Ablauf-/Zustandsfrage, bei der eine Grafik erwartet wird; eine einfache Faktenfrage ohne Grafikbedarf; eine plausible, aber fachlich falsche Grafik; ein Diagramm mit vorweggenommener gesuchter Antwort; eine korrekt abgelehnte Grafik bei weiter nutzbarem Fragetext. Die reinen Rendererbeispiele bleiben darunter als schnelle deterministische Regressionen erhalten.

## 9. Empfohlene nächste Schritte

Dies sind priorisierte Vorschläge für die anschließende Arbeit, keine in dieser Analyse bereits umgesetzten Änderungen und keine stillschweigende Änderung des SSOT.

1. **Mitschnitt verlässlich abschließen.** Öffentliche, bereits validierte Strukturcodes von bereinigbaren freien Inhalten trennen; Collector und Browser mit denselben Code-Keys prüfen. Den Exportvertrag auch über reale Datenwege validieren. Dafür liegt der separate Opus-Prompt vor.
2. **Die konkreten Tutorfehler als Referenzfälle sichern.** Den vorliegenden Verlauf und passende Grafikfälle ergänzen, mit handgeprüften Fakten und expliziten Erwartungen. Nicht nur eine „gute“ Providerantwort vorgeben: Auch falsche, unklare und widersprüchliche Antworten müssen die jeweils erwartete Anwendungsreaktion auslösen.
3. **Varianten und Beziehungen prüfen.** Variablennamen, Kommentare, Zahlen, Formulierungen und gleichbedeutende Lernendenantworten gezielt variieren. Erwartet wird etwa: Ein umbenanntes `t` darf die fachliche Aussage nicht ändern; auskommentierter Code darf nicht als aktiv gelten; gleiche Kernaussagen dürfen nicht allein wegen anderer Worte stark abweichende Bewertungen erhalten. Solche Tests ergänzen Einzelbeispiele und treffen gemeinsame Ursachen früherer Reviewfehler.
4. **Abnahme vom bloßen Jobstatus trennen.** Im Abnahmebericht `pass`, `warn`, `inconclusive`, `not-run` und die beiden Live-Testarten sichtbar unterscheiden. Für glaubhafte kritische Einzelbefunde eine menschliche Prüfung verlangen; die gewünschte Schweregradregel anschließend ausdrücklich im Evaluationsvertrag festlegen. Keine nachträgliche Auswahl nur gelungener Läufe.
5. **Budgetierte Modellvergleiche planen.** Pro relevanter Prompt-/Modelländerung einen vorab festgelegten Fallumfang und feste Modelle verwenden, zunächst etwa 3–5 Wiederholungen als Fehlersuche. Das als Screening kennzeichnen. Für eine belastbare Aussage über seltene Fehler gesondert den benötigten Umfang und die Kosten planen. Tutor-, Judge- und Modelllistenaufrufe gemeinsam budgetieren; Rate-Limits und technische Ausfälle separat erhalten.
6. **Den Judge kalibrieren.** Einen kleinen Satz menschlich bewerteter guter, schlechter und mehrdeutiger Transkripte zurückhalten, zusätzlich zur Entwicklungsmenge. Auf diesen Daten falsche Alarme, übersehene Fehler, ungültige Ausgaben und Übereinstimmung prüfen. Für schwere oder strittige Fälle einen zweiten fachlich unabhängigen Beurteiler einsetzen; zwei Modellstimmen allein sind noch keine Wahrheit. Erst danach Schwellen oder automatisierte Freigaben erweitern.
7. **Mehrschrittige Didaktik und Grafiken gezielt messen.** Kriterien für Einwände, Korrekturen, Wiederholungen und Grafikinhalt ergänzen; frühe relevante Turns ausdrücklich bewerten. Das vorhandene Korpus-/Runnerformat möglichst erweitern, statt daneben eine weitere konkurrierende Qualitätsinfrastruktur aufzubauen.
8. **Mit Lernenden überprüfen.** Nach technischer und fachlicher Absicherung kurze beobachtete Lernversuche durchführen: Werden Rückfragen geklärt? Können Lernende anschließend eine ähnliche Aufgabe selbst lösen? Sind Bewertungen nachvollziehbar? Anzahl der Sterne und Bewertungsdurchschnitt sind dafür keine unabhängigen Erfolgsmaße.

Die vorhandenen Unit- und Browserprüfungen bleiben dabei die schnelle Grundlage. Live-Evaluation ergänzt sie für Eigenschaften, die von frei erzeugter Sprache abhängen; beobachtete Lernversuche ergänzen beide für den tatsächlichen Unterrichtsnutzen.

## 10. Frisch ausgeführte Nachweise und ausstehende Prüfungen

- `npm run test:tutor-quality`: **60 Dateien, 764 Tests bestanden**, keine übersprungen; Laufdauer laut Reporter 2.616 ms bei 15.000-ms-Budget. Darin sind auch Course-Content- und Evaluationsinfrastrukturtests enthalten. Der Lauf verwendet kontrollierte Provider und ist keine neue Messung echter Modelle.
- Der erste Versuch innerhalb der eingeschränkten Sandbox scheiterte unter anderem an `listen EPERM` beim IPC-Socket der `tsx`-CLI; darunter startete die erwartete CLI-Verarbeitung nicht. Der erfolgreiche Lauf erfolgte mit erlaubten lokalen IPC-/Loopback-Sockets, unverändertem Produktcode und unveränderten Tests. Das ist ein Umgebungsunterschied, keine behobene Produktregression.
- Das Strukturcode-Gegenbeispiel wurde zusätzlich mit echten Request-/Antwort-/Exportschemas, Store und Collector bestätigt: gültiger Request und gültige Lernantwort, danach maskierte Klassifikation, ungültiger Export und ein verworfener Collectoreintrag. Kein Provideraufruf.
- Korpusumfang und die statistischen Illustrationswerte wurden lokal aus Datei beziehungsweise Formel berechnet.
- Für diese Dokumentänderungen werden `npm run check:docs` und `git diff --check` separat geprüft. Die Gesamtpipeline, Sonar, Build und Browserprüfungen wurden für diese Analyse nicht erneut vollständig ausgeführt. Die zuvor gemeldeten grünen Implementierungsläufe bleiben historische Belege mit ihrer jeweiligen Reichweite.

Die zentrale offene Qualitätsfrage lautet damit nicht, ob man KI-Ausgaben überhaupt testen kann. Man kann technische Verträge zuverlässig prüfen und freie Ausgaben anhand klarer Kriterien messen. Noch zu verbessern sind die Breite der fachlichen Referenzfälle, die explizite Prüfung des Grafiknutzens, die Behandlung kritischer Einzelbefunde und die Evidenz dafür, dass Lernende mit den Rückmeldungen tatsächlich weiterkommen.
