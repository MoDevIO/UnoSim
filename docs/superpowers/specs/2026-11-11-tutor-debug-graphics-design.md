# Konzept: Tutor-Diagnose im Debug-Tab und verlässliche Grafiken

Status: Grundausbau vom 2026-11-11 auf `feature/tutor-debug-graphics` umgesetzt und geprüft. Am selben Tag auf Nutzerwunsch um den vollständigen lokalen Tutor-Mitschnitt zur Qualitätsprüfung erweitert; diese Erweiterung ist konzipiert, noch nicht implementiert. Änderungen lokal, noch nicht committet. Nicht normativ; der Fachvertrag steht in der Tutor-SSOT. Ergebnisse des Grundausbaus: [Befundbericht](../../proposals/report-tutor-debug-graphics.md). Folgeauftrag: [Umsetzungsprompt](../prompts/2026-11-11-tutor-review-capture.md).

## 1. Auftrag und Ziel

Der Nutzer hat fünf zusammengehörige Aufgaben benannt; die fünfte ergänzt den Grundausbau nach dessen erster praktischer Auswertung:

1. Den Tutor in den vorhandenen Debug-Tab integrieren.
2. Meldungen sicher erfassen, anzeigen und kopieren.
3. Die Tutorfunktionen untersuchen, besonders die grafischen Fähigkeiten.
4. Belegte Fehler der Grafikfunktionen gegebenenfalls reparieren.
5. Einen Tutor-Testlauf einmal kopieren können, sodass Fragen, Nutzerantworten, Rückmeldungen, Bewertungen, verwendeter Codekontext und technische Entscheidungen gemeinsam für eine Qualitätsprüfung vorliegen.

Nach einem Testlauf muss nachvollziehbar sein, ob eine Grafik vom Modell geliefert, bei der Verarbeitung verworfen, für einen späteren Lernschritt zurückgehalten oder tatsächlich angezeigt wurde. Dieselbe Diagnose soll auch bei anderen Tutorproblemen den betroffenen Verarbeitungsschritt zeigen. Ein fehlendes Diagramm ist allein noch kein Fehler: Grafiken sind optional.

Dieses Dokument beschreibt den Grundausbau und die auf Nutzerwunsch ergänzte Folgestufe. Die betroffene SSOT wurde vor den bisherigen Produktänderungen ergänzt. Der nachfolgende Ausgangszustand hält die Befunde vor dem Grundausbau fest; dessen erreichten Stand dokumentieren [Umsetzungsplan](../plans/2026-11-11-tutor-debug-graphics.md) und Befundbericht. Die Erweiterung in Abschnitt 12 ersetzt für den lokalen Qualitätsmitschnitt das bisherige pauschale Verbot von Fragen, Antworten und Code im Debug-Bereich. Vor ihrer Implementierung ist die Tutor-SSOT entsprechend zu aktualisieren; der technische Metadatenvertrag wird dadurch nicht zu einem Rohdatenlog.

## 2. Geprüfter Ausgangszustand vor der Umsetzung

| Bereich | Befund aus dem damaligen Code | Bedeutung |
| --- | --- | --- |
| Debug-Tab | Tabelle, Kachelansicht, dynamischer Typfilter, Kopieren und Leeren sind vorhanden. | Die vorhandene Anzeige lässt sich erweitern. |
| Debug-Speicher | Erfassung nur im Debug-Modus, maximal 500 Einträge im Browser-RAM. Tabelle zeigt zuletzt 100, Kacheln zuletzt 50. Kopieren übernimmt bereits alle zum Typfilter passenden Einträge des Puffers. | Anzeigeumfang und Kopierumfang sind bereits unterschiedlich, ohne dass die Oberfläche das benennt. Diese Grenzen müssen erkennbar sein. |
| Debug-Nachrichtenformat | `DebugMessage` besteht aus `id`, `timestamp`, `sender`, `type`, `content: string` und optional `protocol`. Der Filter vergleicht `type` exakt. `sender: "browser"` bezeichnet die Browser-Emulation, nicht das Frontend. | Strukturierte Details, eine Tutor-Kategorie und ein gezieltes Erhalten beim Compile sind mit dem heutigen Format nicht abbildbar. |
| Automatisches Leeren | Compile/Upload leert aktuell den gemeinsamen Debug-Puffer. | Ohne Anpassung könnten Tutor-Spuren beim Testen des Sketches verschwinden. |
| Sichere Darstellung | Debug-Inhalte werden derzeit als React-Text beziehungsweise JSON-Text ausgegeben. | Diese Eigenschaft bleibt erhalten; die Diagnose erhält keine HTML- oder Mermaid-Vorschau. |
| Tutor-Anbindung | `useTutor` ist bislang nicht mit `addDebugMessage` verbunden. | Tutor-Ereignisse fehlen in diesem Datenweg. |
| Modellprompt | Mermaid wird als optional erlaubt; konkrete Einsatzkriterien und ein passendes Ausgabe-Beispiel fehlen. | Eine vermutete Ursache für seltene Grafikerzeugung, noch kein Nachweis für die Testläufe des Nutzers. |
| Provider-Parser | Leere, zu lange oder nicht textuelle optionale Felder werden nicht übernommen. | Bereits hier kann ein geliefertes Mermaid-Feld verschwinden. |
| Vorhandene Providerdiagnose | Bei einer ungültigen Antwort wird im Entwicklungsmodus ein Ausschnitt des Modellinhalts an `Logger.debug()` übergeben. | Auch dieser bestehende Rohtextpfad muss durch sichere Metadaten ersetzt werden; eine Erweiterung allein würde das Sicherheitsziel verfehlen. |
| Serverprüfung | Mermaid mit nicht erlaubtem Header, Markup oder gesperrten Konstrukten wird entfernt. Sperrliste und Markup-Erkennung existieren als getrennte Kopien in `tutor-service.ts` und `tutor-mermaid.ts`. | Die Lernfrage bleibt erhalten; ein Ablehnungsgrund wird bislang nicht transportiert. Die Kopien können auseinanderlaufen. |
| Hilfefunktionen | Bei Erklärungen und Hinweisen wird nur der Erklärungstext weitergegeben. | Ein mitgeliefertes Diagramm wird auf diesem Weg aktuell nicht genutzt. |
| Renderer | Eigener lokaler Renderer für einen begrenzten Ausschnitt von `flowchart`, `graph`, `stateDiagram-v2` und `sequenceDiagram`. Ablehnung liefert `null`. | Kein vollständiger Mermaid-Umfang; Gründe und gegebenenfalls nicht verarbeitete Syntax bleiben unsichtbar. |
| Lernschritt | Die nächste Frage wird nach einer abgeschlossenen Antwort bis „Weiter“ zurückgehalten. Grafiken werden bei der aktuellen Frage angezeigt; der Verlauf speichert derzeit keinen entsprechenden Grafikinhalt. | Noch nicht angezeigt, verworfen und im Verlauf nicht vorgesehen sind verschiedene Zustände. |
| Fragenersetzung | Planung und Fallbacks können den Fragetext ersetzen und weitere Ergebnisfelder übernehmen. | Zu prüfen ist, ob eine übernommene Grafik dann noch zur ausgelieferten Frage gehört. |
| Logger | `Logger.debug()` wird bei aktivem DEBUG gepuffert und erst bei Fehlern ausgegeben. | Solche Aufrufe allein ergeben keine unmittelbar auswertbare Tutor-Diagnose. |

Eine bisherige Diagnose mit simulierter Providerantwort hat die Übernahme eines unterstützten Diagramms durch Provider, Service und Client-Schema bis zur SVG-Erzeugung bestätigt. Das ist kein Nachweis eines echten Modelllaufs oder der vollständigen Anzeige im Browser. Die dabei ausgeführten drei vorhandenen Testsuiten bestanden mit 38 Tests.

### 2.1 Bereits belegte Rendererbefunde

Ein direkter Aufruf von `renderMermaidSubset` mit kleinen Beispieldiagrammen (Stand 2026-11-11) zeigt Fehler, die ohne neue Diagnose reproduzierbar sind:

| Eingabe | Beobachtetes Ergebnis | Einordnung |
| --- | --- | --- |
| `A --> B --> C` (verkettete Kante) | Nur A→B wird gezeichnet; B→C fehlt ohne Hinweis. | Stille Teilinterpretation. |
| `Aus --> An : Taster gedrückt` (`stateDiagram-v2`) | Übergänge werden gezeichnet, ihre Beschriftungen fehlen. | Stille Teilinterpretation eines im Prompt ausdrücklich erlaubten Typs. |
| `A -- ja --> B` (Kantentext in Mermaid-Kurzform) | Nur A→ja wird gezeichnet. B fehlt vollständig; bei separater Knotendeklaration bleibt es unverbunden. | Fachlich verfälschte Grafik. |
| `A -->\|click\| B` | Abgelehnt, weil `\bclick\b` in jeder Position gesperrt ist. | Vermutlich zu breite Sicherheitssperre; im Arduino-Kontext ist „click“ ein naheliegendes Label. |
| `A{x<b && c>d} --> B[Ende]` | Abgelehnt durch die Markup-Erkennung. Die Kontrollgrafik mit denselben Knoten und ausgeschriebenen Vergleichen wird gerendert. | Falsche Markup-Erkennung lässt sich unabhängig von fehlenden Kanten oder einer zu kleinen Grafik nachweisen. |
| `A -.-> B` | Abgelehnt (`null`). | Nicht unterstützte Syntax ohne sichtbaren Grund. |

Diese Befunde erklären nicht, ob das Modell überhaupt Grafiken liefert. Sie zeigen aber, dass gelieferte Grafiken bereits heute verloren gehen oder verfälscht werden können. Sie bilden den Inhalt von Etappe 0 (Abschnitt 11).

Die sechs Befunde wurden bei der Konzeptprüfung erneut mit kontrollierten Eingaben durch direkten Aufruf des damaligen Renderers reproduziert. Bei `A -.-> B` ist die fehlende Unterstützung zunächst eine Begrenzung; repariert werden muss die eindeutige Ablehnung mit festem Grund, eine Unterstützung dieses Kantentyps ist damit nicht zugesagt.

Quellen: [Debug-Hook](../../../client/src/hooks/use-debug-console.ts), [Debug-Anzeige](../../../client/src/components/features/output-panel.tsx), [Kopierfunktion](../../../client/src/hooks/useSimulatorUIState.tsx), [Tutor-Hook](../../../client/src/hooks/use-tutor.ts), [Provider](../../../server/services/tutor/kiconnect-provider.ts), [Tutor-Service](../../../server/services/tutor/tutor-service.ts), [Renderer](../../../client/src/lib/tutor-mermaid.ts), [Lernschritt](../../../client/src/components/simulator/tutor-learning-step.tsx).

## 3. Ansätze und Empfehlung

Die Integration in den bestehenden Debug-Tab ist vom Nutzer vorgegeben. Für ihre Datenbasis sind folgende Ansätze relevant:

| Ansatz | Nutzen | Aufwand und Grenzen |
| --- | --- | --- |
| Nur Browserereignisse erfassen | Schnell, zeigt Empfang, Zurückhalten und Rendern. | Kann fehlende Modellgrafiken und serverseitig entfernte Grafiken nicht unterscheiden. Erfüllt das Diagnoseziel nicht allein. |
| Strukturierte Ereignisse aus Provider, Service und Browser im bestehenden Debug-Tab zusammenführen | Macht die entscheidenden Übergänge innerhalb eines Testlaufs sichtbar; bestehendes Kopieren nutzbar. | Erfordert einen begrenzten Diagnosevertrag und dessen Transport durch die Tutor-Antworten. **Empfehlung.** |
| Zusätzlich dauerhafte Server-Traces oder Rohantworten archivieren | Ermöglicht spätere Auswertung außerhalb des Browsers. | Zusätzliche Speicherung, Zugriffsregeln und Betrieb; dauerhafte Rohdialoglogs widersprechen dem Sicherheitsvertrag. Kein Bestandteil dieses Konzepts. |

Die folgenden technischen Entscheidungen wurden mit dem Nutzerauftrag zur Umsetzung übernommen. Ein Wechsel der Grafikbibliothek ist nicht enthalten.

Für das neue Ziel reicht ein Export technischer Metadaten nicht mehr. Abschnitt 12 legt einen gemeinsamen lokalen Prüfbericht aus strukturierten Inhalten, Kontextständen und Diagnoseereignissen fest. Nur zusätzliche Textzeilen im bisherigen 500-Einträge-Puffer würden weder den verwendeten Code belegen noch den vollständigen Verlauf bewahren. Eine dauerhafte Serveraufzeichnung ist dafür nicht erforderlich. Die gemeinsame Kopieraktion im vorhandenen Debug-Tab ist die hier vorgeschlagene Umsetzung des Nutzerziels.

## 4. Diagnosevertrag und Datenweg

### 4.1 Ereignisse mit klarer Herkunft

Ein eigener gemeinsamer Vertrag, beispielsweise `shared/tutor-diagnostics.ts`, definiert erlaubte Ereignisse, Gründe und Grenzen. Diagnoseereignisse werden an der tatsächlichen Entscheidung erzeugt. Ein akzeptiertes Mermaid-Feld auf dem Server bedeutet noch nicht, dass der Browser es gerendert hat.

Ein Ereignis enthält ausschließlich erlaubte Felder:

- Version, Zeitstempel, lokale Sequenznummer und Herkunft (`provider`, `service`, `frontend`, `renderer`). Diese Herkunft ist ein eigenes Feld und wird nicht mit `DebugSender` vermischt; insbesondere bezeichnet `sender: "browser"` weiterhin ausschließlich die Browser-Emulation.
- Zufällige Diagnosekennungen, Anfrageart und gegebenenfalls Provider-Versuchsnummer.
- Verarbeitungsschritt, Ergebnis und maschinenlesbarer Grund aus festen Aufzählungen.
- Begrenzte Metadaten, soweit für diesen Schritt nötig: HTTP-Status, Dauer, Zeichenanzahl, Diagrammtyp, Knoten-/Kantenzahl, angefragtes und tatsächlich verwendetes Modell.
- Optionale feste Angaben zur Entscheidung, etwa `provider`, `planner`, `application-fallback` oder `support-cache` als Ergebnisquelle; Antwortbewertung und relative Schwierigkeit nur als begrenzte Zahlen.

Lesbare Texte entstehen im Frontend aus den festen Codes. Externe Fehlertexte werden nicht als Meldung durchgereicht. Angefragte Modellkennungen stammen aus dem Browser und werden nur übernommen, wenn sie in der für den Zugang dieses Requests abgerufenen Modellliste enthalten sind; sonst lautet der Grund `model-id-not-listed`. Angefragtes und zurückgemeldetes Modell bleiben getrennt: Ein Provider kann zu einer gelisteten Modellkennung einen nicht gelisteten Versionsnamen zurückgeben (beobachtet am 2026-11-11 für `openai-gpt5.5`). Diese zurückgemeldete Kennung zeigt der Tutor ohnehin als zuletzt verwendetes Modell an; die Diagnose übernimmt sie deshalb, wenn sie höchstens 128 Zeichen lang ist, nur Buchstaben, Ziffern und `_ . : / -` enthält und den Zugangsschlüssel nicht enthält. Andernfalls entfällt sie mit dem Grund `model-id-withheld`. Die gelistete Anfragekennung wird nicht als tatsächlich verwendetes Modell ausgegeben. Steht für diesen Verarbeitungspfad keine Modellliste zur Verfügung, lautet der feste Grund `model-list-unavailable`. Die Diagnose löst keinen zusätzlichen Modelllisten- oder Generierungsaufruf aus. Aus Sicherheitsgründen ausgelassene Metadaten ändern den Erfolg der eigentlichen Tutorantwort nicht.

Ein nicht auswertbarer oder abgebrochener Providerinhalt erhält `unavailable` als Diagnoseergebnis. Er wird nicht zu „kein Diagramm geliefert“ umgedeutet. Diagrammtypen stammen aus einer festen Liste mit `unknown` für nicht erkannte Angaben; beliebige Headerfragmente werden nicht als Metadaten übernommen.

### 4.2 Kennungen und Wiederholungen

- `traceId`: zufällige Kennung einer logischen Nutzeraktion, bei einem Wiederholungsversuch beibehalten.
- `requestId`: neue zufällige Kennung je HTTP-Versuch; der Server validiert Format und Länge statt beliebige Headerwerte zu übernehmen.
- `providerAttempt`: laufende Nummer tatsächlicher Modellaufrufe innerhalb dieses HTTP-Versuchs.
- `diagramId`: bei einer übernommenen Grafik erzeugte Diagnosekennung, die bis zur späteren Darstellung mitgeführt wird. Kein Hash von Code, Grafik oder Dialoginhalt.

Diese Kennungen sind unabhängig von Zugangsdaten, Benutzeridentität, Support-Session, Fragen-Handle und Idempotenzkennung. Sie gewähren keinen Zugriff. Server- und Browsersequenzen werden nicht über vermeintlich synchronisierte Uhren geordnet; Herkunft, Sequenz und fachlicher Übergang bestimmen die Zuordnung.

### 4.3 Transport und Isolation

1. Der Browser signalisiert bei aktivem Debug-Modus Diagnosebedarf, vorgeschlagen über `X-UnoSim-Tutor-Debug: 1`. Die normalen Zugriffskontrollen gelten unverändert; dieser Schalter ist keine Berechtigung. Da jeder Client den Header setzen kann, beachtet der Server ihn nur, wenn eine Serverkonfiguration Tutor-Diagnose zulässt. Im Konzept ist dafür `UNOSIM_TUTOR_DIAGNOSTICS_ENABLED` vorgesehen: in Entwicklung standardmäßig aktiv, in Produktion und Tests standardmäßig aus; ein expliziter Serverwert kann den jeweiligen Standard überschreiben. Tests schalten die Funktion gezielt ein. In Produktion müssen damit sowohl der Betreiber serverseitig als auch der Nutzer im Debug-Modus die Diagnose aktivieren.
2. Die Route erzeugt einen Collector für genau diesen Request und reicht dessen begrenzte Meldefunktion an Service und Provider weiter. Keine mutable Diagnoseablage an gemeinsam genutzten Provider- oder Serviceinstanzen.
3. Erfolgs- und Fehlerantworten können einen optionalen, strikt validierten Diagnoseblock enthalten. Die Schemas der Frage-, Dialog-, Modell- und Supportantworten sowie der Fehlerauswertung werden darauf abgestimmt. Der Diagnoseblock wird getrennt vom Lerninhalt verarbeitet und nicht in die Dialoghistorie übernommen. Die Folgestufe ergänzt bei derselben Freigabe einen gesonderten Inhaltsblock `review`; Einzelheiten und Grenzen stehen in Abschnitt 12. Er wird ebenfalls vor der Lerninhaltsvalidierung abgetrennt.
4. Der Browser verbindet diese Ereignisse mit eigenen Empfangs-, Anzeige- und Rendererereignissen und übergibt sie an den bestehenden Debug-Speicher.
5. Die Antwort ist nur für den anfragenden, autorisierten Client bestimmt und erhält `Cache-Control: no-store`. Es entstehen weder ein globaler Diagnose-Endpunkt noch ein Zugriff auf fremde Sitzungen.

Die serverseitigen Ereignisse kommen gesammelt mit der HTTP-Antwort an; Browserereignisse werden unmittelbar sichtbar. Streaming oder ein zusätzlicher WebSocket-Kanal ist für diese Ausbaustufe nicht erforderlich. Für direkte Service-Aufrufe in Tests kann derselbe Collector ohne HTTP genutzt werden.

Die bestehende sichere Tutor-Konfiguration meldet dem Client als boolesche Fähigkeit, ob serverseitige Diagnose verfügbar ist. Bei deaktivierter Serverdiagnose kann der Browser seine lokalen Schritte weiter erfassen; ein fester Hinweis `diagnostics-disabled-by-server` kennzeichnet die unvollständige Spur. Ein fehlender Serverblock wird dann nicht als fehlende Modellgrafik interpretiert.

Bei ausgeschaltetem Debug-Modus sind Collector und Transport deaktiviert. Wird während einer laufenden Anfrage ausgeschaltet, werden zurückkommende Diagnoseblöcke nicht mehr in den Debug-Speicher aufgenommen. Das Schließen des Debug-Tabs allein beendet bei weiterhin aktiviertem Debug-Modus die Erfassung nicht.

### 4.4 Abbruch, Replay und unvollständige Spuren

Eine abgebrochene Verbindung kann keine vollständige Serverdiagnose liefern. Der Browser meldet dann Abbruch und unvollständige Spur; er behauptet weder „kein Diagramm geliefert“ noch einen Renderfehler. Verspätete Antworten eines alten Lernkontexts werden nicht angezeigt und entsprechend gekennzeichnet.

Idempotente Support-Wiederholungen erhalten die bestehende fachliche Antwort, ohne einen neuen Modellaufruf vorzutäuschen. Der aktuelle Request bekommt eine neue Diagnosehülle mit `replayed`; alte Diagnosekennungen und Ereignisse dürfen nicht mit dem gespeicherten fachlichen Ergebnis gecacht werden. Neu erstellte Diagnosedaten bleiben außerhalb des Support-Stores und seiner Fingerprintberechnung.

### 4.5 Erweiterung des Debug-Nachrichtenformats

`DebugMessage` erhält zwei optionale Felder; bestehende Nachrichten anderer Subsysteme bleiben unverändert gültig:

- `category`: feste Aufzählung, zunächst nur `tutor`. Nachrichten ohne `category` gelten als simulationsbezogen. Das automatische Leeren beim Compile/Upload entfernt nur Nachrichten ohne `category: "tutor"`.
- `details`: das bereits validierte Diagnoseereignis aus Abschnitt 4.1 als strukturiertes Objekt. `content` bleibt die kurze, im Frontend aus festen Codes erzeugte Zusammenfassung.

Der bestehende `type`-Filter bleibt erhalten. Die Tutor-Kategorie ergänzt ihn um eine eigene Auswahl; Schritt, Ergebnis und Grund werden aus `details` gefiltert. Tabelle, Kacheln und die bestehende Kopie gefilterter Debug-Nachrichten verwenden dieselbe Filterfunktion. Der vollständige Tutor-Prüfbericht aus Abschnitt 12 hat einen ausdrücklich benannten, davon unabhängigen Kopierumfang und einen eigenen begrenzten RAM-Speicher; große Inhaltsdaten werden nicht in `details` gepackt.

## 5. Sichtbare Ergebnisse und Gründe

| Station | Zu unterscheidende Ergebnisse | Beispiel für einen festen Grund |
| --- | --- | --- |
| Anfrage | gestartet, abgeschlossen, fehlgeschlagen, abgebrochen | `provider-timeout`, `rate-limited`, `request-aborted` |
| Modellaufruf | tatsächlich ausgeführt, bewusst ausgelassen, Ergebnis wiederverwendet | `reference-only`, `application-fallback`, `support-cache` |
| Provider-Parsing | Mermaid fehlt, ist `null`, leer, hat falschen Typ, überschreitet das Limit oder wird übernommen | `not-provided`, `invalid-field-type`, `too-long` |
| Sicherheitsprüfung | Grafik akzeptiert oder verworfen | `markup-disallowed`, `external-content-disallowed`, `directive-disallowed` |
| Grafiksyntax | unterstützt, nicht unterstützt oder ungültig | `diagram-type-unsupported`, `syntax-unsupported`, `no-renderable-graph` |
| Fachliche Verarbeitung | übernommen, für diesen Inhaltspfad nicht vorgesehen oder wegen Fragenersetzung entfernt | `support-graphics-not-supported`, `question-replaced` |
| Browser | empfangen, bis „Weiter“ zurückgehalten, an die Anzeige übergeben, durch Kontextwechsel überholt | `awaiting-continue`, `context-changed` |
| Renderer | erfolgreich, abgelehnt, beim Laden fehlgeschlagen oder beim Rendern fehlgeschlagen | `renderer-load-failed`, `renderer-failed` |
| Puffer | begrenzt, ältere Einträge entfernt, vollständige Ereignisfolge nicht mehr vorhanden | `buffer-limit`, `event-limit` |

Ein Render-Erfolg wird nach erfolgreicher Erzeugung und Einbindung des SVG in den aktuellen Lernschritt gemeldet, nicht schon nach erfolgreicher Serverprüfung. Das beweist die Einbindung im DOM, keine menschliche Wahrnehmung oder fehlerfreie fachliche Aussage. Wiederholtes React-Rendern erzeugt keine mehrfachen fachlich identischen Erfolgsereignisse. Ein tatsächlicher späterer erneuter Anzeigevorgang bleibt unterscheidbar.

## 6. Sichere Erfassung, Anzeige und Kopie

Der bisherige [Sicherheitsvertrag des Tutors](../../../ssot/ssot_function_definition_LearningQuestions.md) verbietet Zugangsdaten und Dialoghistorien in Logs. Der Grundausbau setzt dies mit reinen Metadaten um. Der Nutzer wünscht nun ausdrücklich, Fragen, Antworten und Kontext für eine Qualitätsprüfung gemeinsam kopieren zu können. Dafür ist eine eng begrenzte Vertragsänderung vorgesehen: fachliche Inhalte im lokalen, flüchtigen Tutor-Mitschnitt gemäß Abschnitt 12; Zugangsdaten, allgemeine Rohdatenlogs und dauerhafte Serveraufzeichnung bleiben ausgeschlossen. Diese Änderung ist noch nicht implementiert.

1. **Erlaubnisliste vor der Speicherung:** Keine Request-/Response-Dumps. Ein Ereignis wird aus erlaubten skalaren Metadaten aufgebaut und validiert, bevor es in einen Collector oder den Debug-Speicher gelangt. Eine nachträgliche Regex-Maskierung allein genügt nicht.
2. **Getrennte Verträge:** Technische `TutorDiagnosticEvent`-Ereignisse enthalten weiterhin keine Fragen, Antworten, Feedbacktexte, Code oder Grafikquellen. Diese Inhalte sind ausschließlich in den erlaubten Feldern des lokalen Qualitätsmitschnitts aus Abschnitt 12 vorgesehen. API-Keys, Authorization-/Cookie-Header, vollständige Prompts, beliebige Modell-Rohantworten, SVG, Support-/Kurs-Sessionhandles und unbereinigte Providerfehler bleiben in beiden Verträgen ausgeschlossen. Laufzeit-Inhaltshashes werden nicht benötigt. Der vorhandene `templateDigest` der statischen, nutzerunabhängigen Promptvorlagen ist als Revisionsmetadatum gemäß Abschnitt 12.2 zulässig.
3. **Textdarstellung:** Meldungen und Details erscheinen ausschließlich als React-Text oder JSON-Text. Kein `dangerouslySetInnerHTML`, Markdown, Link-Automatismus oder Diagrammrenderer im Debug-Tab. Das separat erzeugte SVG im Tutor bleibt Teil der eigentlichen Grafikfunktion und wird unabhängig sicher geprüft.
4. **Einheitlicher Datenstand:** Die normale Debug-Kopie verwendet die validierten Ereignisse und dieselbe Filterfunktion wie die Anzeige. Der vollständige Tutor-Prüfbericht nutzt die ebenfalls validierten und vor Speicherung bereinigten Inhaltsdatensätze sowie die zugeordneten Ereignisse. Beide lesen aus dem jeweiligen RAM-Speicher, niemals nachträglich aus Request-Dumps, Tooltips, Headern oder ursprünglichen Fehlerobjekten.
5. **Begrenzung:** Für technische Meldungen gelten weiterhin maximal 500 Debug-Einträge, 64 Serverereignisse und 32 KiB serialisierter Diagnoseblock pro HTTP-Versuch, maximal 2 KiB je Ereignis. Die gesonderten Inhaltsgrenzen aus Abschnitt 12 ersetzen diese Limits nicht. Bei Überlauf werden zusätzliche Details verworfen; Abschlussstatus und Angaben zur Kürzung bleiben erhalten. Anzeige und Suche verarbeiten nur begrenzte Strings.
6. **Lebensdauer:** Diagnose nur im Browser-RAM und request-scoped im Server-RAM. Kein Local-/Session-Storage, keine automatische Telemetrie und keine automatische dauerhafte Serveraufzeichnung. „Leeren“ entfernt die vorhandenen Debug-Einträge; Reload beendet die lokale Aufzeichnung. Die Folgestufe verhindert außerdem das Wiederauftauchen von Tutor-Inhalten und zugehöriger Diagnose aus vor dem Leeren gestarteten Requests. Danach neu gestartete Aktionen können neu erfasst werden.
7. **Fehlertoleranz:** Ein ungültiger Diagnoseblock wird nicht dargestellt. Ein lokales Ereignis mit festem Code `diagnostics-invalid` erklärt dies; ein ansonsten gültiger Lerninhalt bleibt nutzbar. Diagnoseausfälle ändern keine Bewertungen, Freischaltungen oder Idempotenzentscheidungen.

Der vorhandene Entwicklungs-Diagnosepfad, der bei ungültigen Providerantworten Modellrohtext an den Logger gibt, wird bereits in Etappe 0 entfernt und in Etappe 1 durch die gleichen sicheren Ereignisse ersetzt. Ein Test prüft ausdrücklich diesen Fehlerpfad und die Ausgabe beim späteren Flush des Debugpuffers.

Diese Vorschläge betreffen die neu integrierten Tutor-Ereignisse. Sie ersetzen keine vollständige Sicherheitsprüfung aller bereits vorhandenen Debug-Nachrichten anderer Subsysteme.

## 7. Erweiterung des vorhandenen Debug-Tabs

Die bestehende Tabellen- und Kachelansicht bleibt die gemeinsame Anzeige. Tutor-Ereignisse werden als zusammengehörige Kategorie `Tutor` filterbar; innerhalb dieser Kategorie sind Schritt, Ergebnis und Grund auswertbar. Eine Suche umfasst Anfrage-/Trace-ID und die freigegebenen Metadaten.

- Eine kompakte Zusammenfassung zeigt Anfrageart, Anfrage-ID, Verarbeitungsschritt, Ergebnis und lesbaren Grund. Die bestehenden Angaben zu Zeit, Absender und Transport bleiben verfügbar. Herkunft und Status werden nicht miteinander verwechselt.
- Strukturierte Details sind vollständig erreichbar, auch wenn die Tabellenzelle gekürzt ist. Ein Tooltip ist nicht die einzige Möglichkeit, einen Diagnoseeintrag zu lesen.
- Kopieren übernimmt wie bisher alle zum Filter passenden Einträge im vorhandenen Puffer, künftig einschließlich Kennungen und `details`. Neu ist, dass die Oberfläche den Umfang benennt, beispielsweise „100 von 180 passenden Einträgen angezeigt; 180 werden kopiert“. Historische Einträge außerhalb des Puffers werden nicht suggeriert.
- Leeren entfernt alle Nachrichten wie bisher. Filter und Suche lösen keine Tutor-Anfrage aus und verändern keinen Lernzustand.
- Das automatische Leeren beim Start von Compile/Upload bewahrt vorhandene Tutor-Einträge; simulationsbezogene Einträge werden weiter wie bisher zurückgesetzt. Die gemeinsame Grenze von 500 Einträgen gilt weiterhin. Manuelles Leeren entfernt auch die Tutor-Einträge.
- Fehlende optionale Grafiken sind Information; Sicherheitsablehnung, nicht unterstützte Syntax und technische Fehler erhalten unterscheidbare Texte. Status bleibt zusätzlich zur Farbe erkennbar.
- Bedienung mit Tastatur, schmale Panels und XXL-Schrift werden berücksichtigt. Bestehende Toolbar-, Scroll-, Typografie- und Statusbausteine des [Style-Guides](../../../client/src/STYLE_GUIDE.md) werden verwendet. Die Sprache der vorhandenen Debug-Oberfläche bleibt Englisch; technische Codes bleiben sprachunabhängig.
- In der Folgestufe macht **Copy Tutor review** einen vollständigen Prüfbericht des gewählten Mitschnitts zugänglich. Fragen, Antworten und Feedback sind auch im Debug-Tab als Textdetails lesbar. Diese Kopie enthält alle erfassten Schritte und erforderlichen Kontextstände dieses Mitschnitts unabhängig vom aktuellen Nachrichtenfilter; der Umfang wird ausdrücklich angezeigt. Die bisherige gefilterte Debug-Kopie bleibt verfügbar.

Die zusätzlichen Filter und Details sind im bestehenden Debug-Tab umgesetzt. Browsernachweise prüfen die Anordnung einschließlich umgebrochener Filter, XXL-Schrift und Tastaturbedienung; Screenshots sind im lokalen Prüfverzeichnis abgelegt. Eine neue Diagnose-Seite oder ein weiterer Ausgabetab ist nicht vorgesehen.

## 8. Analyse der Tutorfunktionen

Die Untersuchung verbindet gezielte Tests mit dem neuen Diagnoseweg. Sie erfasst pro Funktion Eingangsart, wirkliche Modellaufrufe, Validierung, fachliche Entscheidung und ausgelieferten Zustand:

| Funktion | Zu prüfende Entscheidungen |
| --- | --- |
| Einrichtung und Modellwahl | Konfiguration und Fähigkeiten, Modellliste, manuelle/automatische Wahl, veraltete Modellwahl, verwendetes Modell, sichere Fehlerausgabe. |
| Initialfrage | Freier Tutor und Lehrerfokus/Kursinhalt, Fragequelle und nachträgliche Ersetzung, optionale Metadaten und Grafik. |
| Antwortdialog | Bewertung und Schwierigkeit, Klassifikation als Antwort/Rückfrage/Hilfewunsch, offene oder abgeschlossene Frage, Fallbacks und Übergang zu „Weiter“. |
| Hilfe | Explizite und eingetippte Klärung/Hinweis, vorhandene Musterantwort ohne Modellaufruf, Sperren, Überspringen, Idempotenz und Wiederholung. |
| Kontext und Lebensdauer | Neues Beispiel, Änderungen an Code/Headers/Board, Rücksetzen, Abbruch, verspätete Antwort, isolierte parallele Nutzer. |
| Grafiken | Lieferung, Parsing, Sicherheitsprüfung, Übernahme zur richtigen Frage, verfügbare Syntax, Rendern und spätere Anzeige. |

Die Analyse ist zeitlich begrenzt: Grafiken haben Vorrang. Für die ergänzende Untersuchung der übrigen Zeilen sind insgesamt **60 Minuten** vorgesehen, einschließlich ausgewählter Testläufe und Befundbericht. Dieses Budget beginnt nach Bereitstellung des Diagnosewegs in Etappe 1. Was darin nicht geprüft werden kann, wird als offener Punkt benannt; die Etappe wird dafür nicht automatisch verlängert. Der Bericht nennt je Bereich geprüft, teilweise geprüft oder ungeprüft sowie die verwendete Evidenz. Das Budget gilt nicht für die Grafikprüfung, die Umsetzung der Etappen oder deren erforderliche Sicherheits-, Regressions- und Abnahmeprüfungen.

Der Ergebnisbericht trennt reproduzierte Fehler, beabsichtigte Begrenzungen und noch unbelegte Vermutungen. Er benennt den Ort des Eingriffs und den Test, der das gewünschte Verhalten nachweist. Eine breite Überarbeitung von Didaktik, Bewertung oder Curriculum ist nicht automatisch Teil dieses Auftrags; dort gefundene andere Fehler werden dokumentiert. Der neue Mitschnitt soll gerade deren spätere Prüfung ermöglichen. Seine Implementierung und erforderlichen Prüfungen fallen nicht unter das bereits abgeschlossene 60-Minuten-Budget des Grundausbaus.

### 8.1 Besondere Grafikprüfungen

- Mindestens je ein unterstütztes Ablauf-, Zustands- und Sequenzdiagramm durch echten API-Pfad bis zur Browseranzeige führen, mit kontrollierten Providerantworten.
- Unterscheiden, ob der Provider nichts liefert oder ob Parser, Sicherheitsprüfung oder Renderer etwas entfernen. Auch eine leere oder falsch typisierte Mermaid-Angabe muss erkennbar bleiben.
- Reale Grenzen des eigenen Parsers prüfen: verkettete Kanten, Verzweigungen, Rückkanten, Richtungen einschließlich `RL`/`BT`, Beschriftungen, Zustandsübergangslabels und Sequenznachrichten. Nicht verarbeitete Syntax darf keine unbemerkt fachlich verkürzte Grafik erzeugen.
- Vergleichszeichen in fachlichen Labels gegen die Markup-Prüfung testen, ohne die Sperre für echtes HTML zu schwächen.
- Ladefehler des dynamischen Rendererimports, Renderausnahmen und Wechsel des Diagramms während des Ladens prüfen.
- Prüfen, wie Grafik und tatsächlich ausgelieferte Frage bei Planner-/Fallback-Ersetzung und einer offenbleibenden Frage zusammengehören. Eine nachweislich anders zugeordnete Grafik wird mit Grund entfernt; eine neue Zuordnung wird nicht bloß geraten.
- Klären, welche Grafiken Erklärungen und Hinweise fachlich unterstützen können. Dass der heutige Vertrag diese nicht ausliefert, wird zunächst als Begrenzung erfasst. Eine Erweiterung ist eine bewusste Schema- und UI-Änderung.
- Die aktuelle Nichtdarstellung im Verlauf dokumentieren. Eine allgemeine Grafikarchivierung im Dialogverlauf ist kein notwendiger Teil dieser ersten Ausbaustufe.

### 8.2 Erzeugungsverhalten des Modells

Die Beobachtung „noch nie eine Grafik“ wird erst mit Daten einem Verarbeitungsschritt zugeordnet. Die Diagnose kann beweisen, dass ein Feld fehlt; sie kann nicht erklären, warum das Modell es weggelassen hat.

Für einen gegebenenfalls durchzuführenden Live-Vergleich wird ein kleines festes Set geeigneter Aufgaben verwendet, mit dokumentiertem Modell, Promptrevision und Anzahl Versuche. Gemessen werden separat: geliefert, sicher akzeptiert, vollständig unterstützt, der endgültigen Frage zugeordnet und im Browser gerendert. Ein ungültiges Diagramm zählt nicht als Erfolg. Ein Modellaufruf im Service allein belegt keine Anzeige im Browser.

Echte Provideraufrufe nutzen die bestehende persönliche Zugangsmethode und werden bewusst gestartet; sie entstehen weder automatisch durch Aktivieren von DEBUG noch durch eine neue Diagnose. Im Metadatenvertrag bleiben Auswertungsergebnisse auf die erlaubten Metadaten begrenzt. Der lokale Qualitätsmitschnitt darf zusätzlich die in Abschnitt 12 festgelegten fachlichen Inhalte enthalten. Eine feste Diagrammquote wird nicht zum Qualitätsziel.

## 9. Entscheidung über Grafikreparaturen

Reparaturen folgen einem reproduzierten Befund. Sie werden gegen den beabsichtigten Diagrammumgang geprüft:

| Befund | Vorgesehene Reaktion |
| --- | --- |
| Ein zugesichert unterstütztes Diagramm wird verloren oder falsch dargestellt. | Datenweg beziehungsweise Parser/Renderer gezielt reparieren; vorher einen aussagekräftigen Regressionstest ergänzen. |
| Sicherheitssperre lehnt zulässigen Inhalt fälschlich ab. | Erkennung präzisieren und erlaubten Fall sowie gesperrte Gegenbeispiele testen. |
| Nicht unterstützte Syntax wird teilweise verarbeitet und verändert die Aussage. | Mit festem Grund vollständig ablehnen oder den begrenzten Syntaxumfang korrekt erweitern; keine stille Teilinterpretation. |
| Grafik gehört nach Fragenersetzung zu einem anderen Inhalt. | Grafik entfernen und den Grund protokollieren; Textfrage bleibt erhalten. |
| Modell liefert trotz geeigneter Aufgaben selten eine Grafik. | Nach Auswertung gezielte Einsatzkriterien und ein rendererkompatibles Beispiel im Prompt prüfen; keine erzwungene Grafik bei jeder Antwort und kein zusätzlicher Reparaturaufruf je Antwort. |
| Erklärungen/Hinweise benötigen eine Grafik. | Erweiterung der passenden Support- und Dialogantworten, sichere Übernahme und Anzeige im Hilfeschritt als eigenen kleinen Teil des Reparaturvorschlags ausweisen. |
| Der eigene Renderer deckt den benötigten Umfang grundsätzlich nicht verlässlich ab. | Entscheidungsvorlage zu Ausbau oder Austausch erstellen, einschließlich Sicherheitsmodell, lokaler Verarbeitung und Bundlebudget. Kein vorsorglicher Bibliothekswechsel. |

Eine Rendererantwort soll künftig außer dem gegebenenfalls erzeugten SVG ein festes Ergebnis und einen Grund liefern können. Parserdiagnosen enthalten keine Auszüge aus dem Diagramm.

Die heute doppelt vorhandene Sperrliste und Markup-Erkennung sowie die bislang uneinheitlich angewendeten Header- und Längengrenzen werden in ein gemeinsames Modul, beispielsweise `shared/tutor-mermaid-rules.ts`, überführt, das Server und Renderer gleichermaßen verwenden. Es liefert statt eines Wahrheitswerts den festen Ablehnungsgrund aus Abschnitt 5. Dieselbe gemeinsame Prüfung muss auf Server und Browser denselben Grund liefern. Weitergehende Syntax- und Darstellungsgrenzen des Renderers bleiben als eigene Verarbeitungsschritte unterscheidbar; eine bestandene Sicherheitsprüfung ist keine Garantie für ein darstellbares Diagramm.

## 10. Nachweise und Abnahmekriterien

1. **Vollständiger Beispielpfad:** Ein kontrolliert geliefertes, unterstütztes Diagramm ist im Tutor-DOM sichtbar. Der Debug-Tab weist Providerübernahme, Serverakzeptanz und tatsächliches Rendern mit denselben Diagnosekennungen aus.
2. **Eindeutige Ablehnung:** Falscher Typ, Überlänge, verbotener Inhalt, nicht unterstützte Syntax und Rendererfehler liefern verschiedene feste Gründe. Die Textfrage bleibt erhalten.
3. **Kein Phantomfehler:** Fehlende optionale Grafik, bewusst ausgelassener Modellaufruf und bis „Weiter“ zurückgehaltener Inhalt werden korrekt angezeigt. Ein Replay wird nicht als neuer Modellaufruf gezählt.
4. **Sicherheitsnachweis:** Test-Secrets, Header, Handles und rohe Providerfehler erscheinen weder in Diagnose noch Qualitätsmitschnitt oder Kopien. Dialog-/Code-Sentinels fehlen weiterhin in technischen Ereignissen und Serverlogs, sind im freigegebenen Qualitätsmitschnitt dagegen ausschließlich in den vorgesehenen Inhaltsfeldern enthalten. HTML-/SVG-/Steuerzeichen-Testinhalte werden nie aktiv interpretiert; ausgeschlossene Felder werden nicht übernommen. Die Anzeige erzeugt keine aktiven Inhalte oder zusätzlichen Netzwerkzugriffe.
5. **Korrekte Isolation:** Parallele Requests und Nutzer vermischen ihre Ereignisse nicht. Debug aus, Abbruch, Kontextwechsel, Wiederholung und fehlerhafter Diagnoseblock ändern den fachlichen Ablauf nicht.
6. **Nutzbare Anzeige:** Tutorfilter und Suche wirken in beiden Ansichten und beim Kopieren gleich. Compile/Upload löscht keine vorhandenen Tutor-Spuren; manuelles Leeren entfernt sie. Grenzen, Kürzung und verworfene Puffereinträge sind erkennbar; Details sind mit Tastatur und bei XXL erreichbar.
7. **Belegte Reparatur:** Für jeden behobenen Grafikfehler liegen reproduzierbarer Vorher-Befund, Regressionstest und sichtbarer Nachher-Nachweis vor. Parser-Unit-Tests allein gelten nicht als UI-Nachweis.
8. **Einmal kopieren genügt:** Der Bericht enthält die tatsächlichen Fragen, eingereichten Antworten, Rückmeldungen, Bewertungen, Hilfeschritte, Anzeigeübergänge, verwendeten Kontextstände und korrelierten technischen Entscheidungen eines Mitschnitts. Ein Prüfer muss den Sketch oder Verlauf nicht gesondert anfordern, soweit sie während der Erfassung vorlagen.
9. **Ursprung und Zuordnung:** Providerentwurf, endgültige Frage, Herkunft, Ersetzungsanlass und Grafikentscheidung sind unterscheidbar; eine Bewertung gehört eindeutig zur beantworteten Frage. Kontextwechsel und schon vor Erfassungsbeginn fehlende Schritte sind erkennbar.
10. **Ehrliche Vollständigkeit:** Mehr als acht Antworten und mehr als 500 technische Nachrichten verkürzen den Qualitätsbericht nicht still auf das Modellhistorienfenster oder den sichtbaren Debug-Ausschnitt. Eigene Mitschnittlimits, deaktivierte Serverdiagnose, Bereinigungen und fehlende Daten werden im Export ausgewiesen.
11. **Ohne Repository auswertbar:** Ein lesbares chronologisches Protokoll, damalige Codekontexte, Skalen-/Codelegende und ein versionierter JSON-Datensatz sind in derselben Kopie enthalten. Regel-/Promptstände sind den tatsächlichen Requests zugeordnet; eine spätere Konfiguration überschreibt keine frühere Evidenz.

Die Umsetzung prüft die neuen Verträge mit Unit-Tests, die vollständigen API-Wege einschließlich Fehler und Replay mit Routentests und die Anzeige/Kopie mit Browserprüfungen. Bestehende Tests wurden entsprechend der [Agenten-Policy](../../../ssot/ssot_agent_policy.md) nicht geändert. Dokumentationslinks, Typen, Build und Lint wurden mit den vorhandenen Projektbefehlen geprüft. Ergebnisse und verbleibende Prüfgrenzen stehen im [Befundbericht](../../proposals/report-tutor-debug-graphics.md).

## 11. Etappen und Liefergegenstände

0. **Belegte Grafikfehler und Rohtext-Log:** Die Befunde aus Abschnitt 2.1 mit Regressionstests beheben (verkettete Kanten, Zustandsübergangslabels, Kantentext-Kurzform; bei nicht unterstützter Syntax vollständige Ablehnung statt Teilinterpretation), die `click`-Sperre auf tatsächliche Mermaid-Interaktionsanweisungen eingrenzen, die gemeinsamen Regeln aus Abschnitt 9 einführen und die Weitergabe von Modellrohtext an `logger.debug` im Provider entfernen. Ergebnis: Die belegten Fälle werden korrekt gerendert oder gemäß dem festgelegten Umfang vollständig mit festem Grund abgelehnt; der bekannte Rohtextpfad ist geschlossen. Die Sichtbarkeit dieser Gründe im Debug-Tab folgt in Etappe 1. Etappe 0 benötigt keinen neuen Diagnosevertrag.
1. **Diagnosevertrag und sichere Integration:** Freigegebene SSOT-Ergänzung, begrenzte Metadaten, Request-Isolation, Transport, Erweiterung des Nachrichtenformats (Abschnitt 4.5), Debugfilter, Suche und Kopie. Der erste Ausbau beschränkt sich auf Anfrageergebnis und die Grafikstationen aus Abschnitt 5; weitere Stationen folgen bei Bedarf aus Etappe 2. Ergebnis: Testläufe sind für Grafiken auswertbar.
2. **Funktions- und Grafikanalyse:** Befundbericht mit reproduzierten Fällen, Fähigkeitenmatrix und offenen Modellbeobachtungen. Ergebnis: begründete Reparaturliste.
3. **Gezielte Grafikreparaturen:** Kleine Änderungen mit Nachweisen, gegebenenfalls gesondert ausgewiesene Erweiterung für Hilfen oder bewertete Rendererentscheidung. Ergebnis: verlässlicher zugesicherter Umfang.
4. **Vollständiger lokaler Tutor-Mitschnitt zur Qualitätsprüfung (umgesetzt am 2026-11-11, siehe Befundbericht):** SSOT-Vertragsänderung, strukturierte Inhalte und Kontextstände, genaue Entscheidungsherkunft, eigener begrenzter RAM-Speicher und eine vollständige Kopieraktion im vorhandenen Debug-Tab gemäß Abschnitt 12. Ergebnis: ein selbstständig auswertbarer Testlauf ohne nachgereichten Sketch oder manuell kopierten Tutorverlauf. Der [Umsetzungsprompt](../prompts/2026-11-11-tutor-review-capture.md) beschreibt den Folgeauftrag.

Der umgesetzte Umfang umfasst die belegten Reparaturen, die Metadatendiagnose und seit dem 2026-11-11 auch Etappe 4, den lokalen Tutor-Mitschnitt (SSOT LearningQuestions §12.7, [Exportformat](../../tutor-review-format.md)). Rendererwechsel, weitere Grafikformate und dauerhafte Protokollierung sind nicht enthalten. Die Fähigkeitenmatrix im Befundbericht weist Grenzen und ungeprüfte Bereiche aus. Routineentscheidungen zu Modulaufteilung, Callbacksignaturen und Testfixtures folgen den hier beschriebenen Verträgen.

## 12. Vollständiger Tutor-Mitschnitt für die Qualitätsprüfung

### 12.1 Nutzerziel und Befund

Der Nutzer möchte einen Tutor-Testlauf einmal im Debug-Tab kopieren und anschließend Fragen, Bewertung, Lernfortschritt, Kontexttreue und Grafiken prüfen lassen können. Der Mitschnitt soll die fachliche Prüfung ermöglichen; ein HTTP-Erfolg allein belegt keine gute Tutorleistung.

Der am 2026-11-11 geprüfte Lauf enthielt elf Requests und 87 Tutor-Diagnoseereignisse. Zehn Modellantworten lieferten einmal ein Flowchart mit 97 Zeichen; es wurde nach bestandener Sicherheitsprüfung wegen Fragenersetzung entfernt. Erst der gesondert nachgereichte Dialog und Sketch zeigten unklare Katalogfragen, bewertete Rückfragen, Wiederholung nach einer Fünf-Sterne-Antwort und widersprüchliche Aussagen zu einer Serial-Ausgabe. Diese Nachlieferung soll künftig entfallen.

Die folgenden Festlegungen sind der konkrete Konzeptvorschlag für dieses Nutzerziel. Sie behaupten keine bereits erfolgte Umsetzung oder erfolgreiche Prüfung.

### 12.2 Fachliche Daten des Mitschnitts

Ein versionierter gemeinsamer Vertrag, vorgeschlagen `shared/tutor-review.ts`, beschreibt einen `TutorReviewRun` mit Kontextständen, Schritten, Entscheidungen und Diagnoseereignissen. Technische `TutorDiagnosticEvent`-Ereignisse behalten ihren bisherigen kleinen Metadatenvertrag. Beide Datenbestände werden über zufällige Kennungen verbunden und gemeinsam kopiert.

| Bestandteil | Erforderliche Angaben |
| --- | --- |
| Kopf | Formatversion, zufällige `runId`, Beginn/Ende, Exportstand, bekannte App-/Promptrevisionen, Erfassungsstatus und Vollständigkeitsgrenzen. Die tatsächlich verwendeten Revisionen werden je Request referenziert; eine nicht verfügbare Revision wird als unbekannt ausgewiesen. |
| Codekontext | `contextId`, Board, Entry-Dateiname, tatsächlicher Code und mitgesendete Header-Dateinamen/-inhalte. Weitere tatsächlich gesendete fachliche Kontextfelder nur nach ausdrücklicher Schemafreigabe. Unveränderte Stände werden nur einmal aufgenommen; keine Inhalts-Hashes. |
| Lernkontext | Modus (freier Tutor/Lehrerfokus), wirksame Schwierigkeit, bekannte Kursrevision, verwendete Themen-/Fragen-/Strategiezuordnung, relevanter ausgelieferter Katalogfragetext beziehungsweise Planerauftrag. Soweit verfügbar auch die tatsächlich verwendeten deterministischen Sketchfakten aus erlaubten Schemafeldern; keine komplette Katalogsammlung oder Promptkopie. |
| Nutzeraktion | Startfrage, eingereichte Antwort, getippte Rückfrage/Hilfewunsch, explizite Klärung/Hinweis, Musterantwort, Überspringen, „Weiter“, Wiederholung, Abbruch und Reset; Zeit und lokale Reihenfolge. Nur abgeschickte Texte, keine Tastatureingaben oder unveröffentlichten Entwürfe. |
| Frage und Antwort | Tatsächlich sichtbare beantwortete Frage, eingereichte Nutzerantwort, ausgelieferte Rückmeldung, Antwortstil, Bewertung oder ausdrücklicher Grund für fehlende Bewertung sowie Frage offen/geschlossen. Eine Folgefrage ist ein eigenes Feld und wird nicht mit der bewerteten Frage verwechselt. Der angezeigte Bewertungsdurchschnitt erhält Anzahl und Bezugsfenster seiner Bewertungen; der vollständige Mitschnitt wird dadurch nicht auf dieses Fenster begrenzt. |
| Fachliche Entscheidung | Tatsächliche Eingabeklassifikation (`answer`, `clarification`, `help`), tatsächliche Ergebnisquelle, Planer-/Fallbackentscheidung und Ersetzungsanlass; keine nachträgliche Vermutung aus dem Fragetext. |
| Provider und Endergebnis | Soweit serverseitig verfügbar: begrenzte, schemaerlaubte Frage-/Feedback-/Bewertungsfelder des normalisierten Providerentwurfs und dieselben Felder des endgültigen Ergebnisses. Der Inhalt ist als Entwurf oder ausgeliefert gekennzeichnet. Keine vollständige HTTP-/Provider-Rohantwort. |
| Grafiken | Zufällige `diagramId`, Mermaid-Quelltext im erlaubten Umfang als reiner Text, Zuordnung zu Entwurf/endgültiger Frage, Sicherheits-/Syntaxentscheidung, Zurückhalten, Übergabe an die Anzeige und tatsächliches Rendern. Auch ein später verworfenes zulässiges Mermaid-Feld bleibt als Text prüfbar. Überlange oder falsch typisierte Felder werden nicht als Rohwert übernommen. SVG wird nicht erfasst. |
| Technik | Bisherige freigegebene Ereignisse mit Trace-/Request-/Provider-Versuchskennung, Modell, HTTP-Ergebnis, Dauer, Replay und Abbruch. Fehlende Serverspur bleibt als fehlend erkennbar. |
| Legende | Bewertungsrubrik 1–5, Schwierigkeitsbänder 1–100 und Bedeutung von Antwortstil, Eingabeklassifikation, verwendeten Ersetzungsauslösern und Diagnosegründen. Die fachliche Rubrik ist vom tatsächlich bewerteten Ergebnis getrennt; fehlende Regeln werden nicht als bekannt ausgegeben. |

Die bekannte Promptrevision besteht aus `TUTOR_PROMPT_REVISION.id` und `templateDigest`. Nur diese erlaubten Revisionsfelder werden übernommen, niemals das komplette Objekt: Dessen bestehendes Feld `sources` enthält die Promptvorlagen. `templateDigest` bezeichnet ausschließlich die statischen Vorlagen, keinen mit Code oder Dialog gefüllten Laufzeitprompt. Eine App-Kennung wird nur übernommen, wenn sie im Build tatsächlich verfügbar ist; die derzeit fehlende Build-Konstante wird nicht durch Paketversion, Exportzeitpunkt oder einen geratenen Commit ersetzt.

Rubrik und Schwierigkeitsbeschreibung werden für Promptbau und Export aus derselben kleinen, browsergeeigneten gemeinsamen Quelle bezogen, vorgeschlagen `shared/tutor-assessment-guidance.ts`. Der Client importiert dafür weder `tutor-service.ts` noch Server-/Crypto-Abhängigkeiten. Die reine Extraktion vorhandener Texte soll den fachlichen Promptinhalt und seinen Digest unverändert lassen. Ein serverseitig bestätigter Regelstand gehört zum jeweiligen Request; er wird zusammen mit dem nötigen Legendensatz erfasst und nicht erst beim späteren Export aus der dann aktuellen Konfiguration bestimmt. Verschiedene Regelstände in einem Mitschnitt bleiben unterscheidbar. Ohne entsprechende Serverspur ist eine bekannte Client-Legende als Client-Dokumentation gekennzeichnet, die tatsächliche serverseitige Revision bleibt unbekannt. Angefragtes und zurückgemeldetes Modell werden ebenfalls je Request ausgewiesen, nicht nur als letzter Modellname im Berichtskopf.

Für Fragenersetzung reichen `question-replaced` und ein unbekannter Ursprung nicht aus. Zusätzlich wird der tatsächliche Auslöser als feste Aufzählung festgehalten, etwa `planner-question`, `repetition-fallback` oder `retain-open-question`; vorherige und endgültige Textfassung sind im Inhaltsvertrag referenziert. Die Zuordnung muss auch greifen, wenn derselbe Text in verschiedenen Katalogthemen vorkommt.

Der Mitschnitt dokumentiert tatsächliches Verhalten einschließlich falscher Bewertungen. Er stuft einen Einwand nicht selbst neu ein und verändert weder Tutorbewertung noch Lernfortschritt. Bekannte Tutorfehler werden als spätere Reparaturbefunde behandelt.

### 12.3 Aufnahme am tatsächlichen Datenweg

1. **Browser vor dem Request:** Aus erlaubten Feldern des tatsächlich gesendeten Tutor-Requests entstehen Kontextstand und Nutzeraktion. Maßgeblich ist die gesendete Kopie, nicht der beim späteren Export aktuelle Editor. Auch die tatsächlich mitgesendete begrenzte Dialoghistorie wird über Schrittverweise rekonstruiert; schon vor Erfassungsbeginn vorhandene Historieneinträge werden als importierte Vorgeschichte übernommen. Deren unbekannter damaliger Code und Zeitpunkt bleiben unbekannt; sie werden nicht an den aktuellen Kontext gebunden oder als erneut ausgeführte Aktionen gezählt. Ein Kontextwechsel erhält eine neue `contextId`.
2. **Server bei der Entscheidung:** Der request-scoped Collector ergänzt bei derselben vorhandenen Debug-Freigabe einen getrennten, streng begrenzten `review`-Block für erlaubte Entwurfsfelder, Planerherkunft und Entscheidungen. Code und Nutzerantwort werden nicht unnötig zurückgespiegelt. Keine zusätzliche Provideranfrage, kein Vollprompt, kein Sammellog. Noch nicht freigegebene Musterlösungen, interne Lehrerhinweise oder vertrauliche Promptteile werden nicht allein durch den Debug-Header an den Client ausgeliefert.
3. **Transport:** `diagnostics` und `review` werden separat validiert und vor der strikten Lerninhaltsvalidierung entfernt. Der `review`-Umschlag enthält mindestens Formatversion, `traceId`, `requestId` und Anfrageart; der Client prüft deren Übereinstimmung mit dem tatsächlich gestarteten Request, zusätzlich zu Schema- und Größengrenzen. Falsche Zuordnung oder unbekannte Version ergibt `review-invalid`. Beide Blöcke gehören nicht zum Lernschema, zur achtteiligen Modellhistorie oder zu dessen Fingerprint. Ein ungültiger Inhaltsblock beeinträchtigt gültigen Lerninhalt nicht; ein fester Fehlercode und die unvollständige Evidenz werden vermerkt. Auch der Fallback bei ausgefallener optionaler Review-Ladung entfernt den Block, bevor er Lerninhalt validiert. Beide Blöcke werden erst an eine ausgehende Antwortkopie angehängt und nicht im Support-Replay gespeichert.
4. **Browser nach der Antwort:** Die normalisierten ausgelieferten Inhalte, die tatsächlich übernommene Frage und deren Anzeigezustand werden gebunden. Erhalten, zurückgehalten und angezeigt sind eigene Zustände; vor „Weiter“ wird keine neue Frage als sichtbar behauptet. Wiederholte React-Effekte erzeugen keine mehrfachen fachlichen Schritte.
5. **Replay und Fehler:** Ein neuer Requestversuch bleibt derselben Nutzeraktion zugeordnet; ein Replay enthält keine erfundene Providerantwort oder neuen Modellaufruf. Eine unveränderte Replay-Antwort kann mit dem schon vorhandenen Inhaltsdatensatz verknüpft werden. Fehlt dieser lokal, bleibt die Serverentwurfs-Evidenz als nicht verfügbar markiert. Fehler und Abbrüche behalten die zugehörige Nutzeraktion ohne Antworttext zu erfinden.
6. **Ohne Serverdiagnose:** Fragen, Antworten, ausgelieferte Rückmeldungen und der vom Browser gesendete Code werden lokal weiter aufgezeichnet. Nicht verfügbare Providerentwürfe und Serverentscheidungen werden einzeln als unbekannt markiert; der Bericht bleibt für die sichtbare Interaktion nutzbar.

Es gibt keine automatische KI-Auswertung oder zusätzliche Telemetrie durch die Aufnahme, Anzeige oder Kopie. Die spätere Qualitätsprüfung erfolgt anhand des bewusst geteilten Exports.

### 12.4 Sichere Inhaltsverarbeitung und Lebensdauer

- Die Erfassung fachlicher Inhalte ist Bestandteil des aktivierten Debug-Modus; ein weiterer pauschaler Freigabedialog ist nicht vorgesehen. Im Debug-Tab steht dauerhaft sichtbar, dass dieser Tutor-Mitschnitt Gesprächsinhalte und Code enthält und beim Kopieren geteilt werden kann. Der Nutzer hat die Aufnahme dieser Inhalte für die Qualitätsprüfung ausdrücklich gewünscht.
- Aufnahme nur im RAM des Browser-Tabs und für die Dauer eines konkreten Serverrequests. Kein Browser-Storage, keine Datenbank, keine Konsolen-/Dateilogs, kein dauerhafter Servermitschnitt und kein Hintergrundupload. Die bewusste Zwischenablagekopie liegt anschließend außerhalb dieses RAM-Lebenszyklus und wird nicht automatisch zurückgerufen.
- Aufbau ausschließlich aus erlaubten Feldern. Zugangsdaten, Authorization-/Cookie-Header, Support-/Kurs-Sessionhandles, Fragenhandles, Idempotenzschlüssel und rohe Fehlerobjekte werden weder gespeichert noch exportiert. Statt fachlicher Handles werden unabhängige lokale Referenzen verwendet. Projekt-Dateinamen sind erlaubt; beliebige absolute Systempfade und Benutzeridentitäten nicht.
- Bekannte für den jeweiligen Request verwendete Zugangsdaten werden zusätzlich auch innerhalb erlaubter Textfelder vor Speicherung unkenntlich gemacht, etwa wenn ein Provider sie im Feedback wiederholt. Das gilt für getrimmte Werte und relevante escaped Darstellungen. Kein nachträglicher Exportfilter als einziger Schutz. Bereinigungen werden gezählt und gekennzeichnet. Nicht beliebige weitere persönliche Daten oder unbekannte Secrets als automatisch anonymisiert ausgeben; der Hinweis zum bewussten Teilen bleibt sachlich.
- Frage, Antwort, Code und Mermaid sind untrusted Text. Keine HTML-/Markdown-Ausführung, automatischen Links, Bilder oder Grafikvorschauen im Debug-Tab. Auch abgelehntes Markup bleibt bei zulässiger Länge ausschließlich Text. Der sichere Renderer des Lernschritts wird dafür nicht wiederverwendet.
- DEBUG aus beendet die Aufnahme neuer Inhalte und Serverblöcke, auch bei noch laufenden Requests. Bereits erfasste Inhalte bleiben bis zum Leeren oder Reload im RAM. Wieder einschalten beginnt eine neue Erfassungsepoche und einen neuen Mitschnitt, dessen später Anfang erkennbar ist. Eine noch aus der früheren Epoche eintreffende Antwort wird auch nach dem Wiedereinschalten nicht aufgenommen. Das Schließen des Debug-Tabs beendet die Aufnahme bei weiter aktivem DEBUG nicht.
- Tutorreset und Code-/Board-/Headerwechsel sind Ereignisse innerhalb eines Mitschnitts mit neuen lokalen Kontext-/Lernsitzungsreferenzen. Bisherige Schritte bleiben für die Prüfung erhalten. Compile/Upload löscht keine Tutor-Evidenz. Manuelles Debug-Leeren entfernt Metadaten und alle Inhaltsmitschnitte und wechselt die Erfassungsepoche; Antworten schon vorher gestarteter Requests dürfen die gelöschten Inhalte nicht wiederherstellen. Neue danach gestartete Aktionen dürfen einen neuen Mitschnitt beginnen. Ein neu gestarteter Replay-Request darf seine jetzt ausgelieferte fachliche Antwort aufnehmen, aber keine gelöschte frühere Ereignisspur oder Providerentwürfe zurückholen. Reload entfernt alles.

### 12.5 Eigene Grenzen und ehrliche Vollständigkeit

Der Inhaltsmitschnitt wird nicht aus dem auf acht Einträge begrenzten Modellverlauf oder den zuletzt 100/50 sichtbaren beziehungsweise 500 gepufferten Debug-Meldungen exportiert. Ein eigener begrenzter Store erhält Schritte, benötigte Kontextstände und zugehörige technische Ereignisse unabhängig von diesem Anzeigeausschnitt.

Konkrete Startgrenzen dieses Konzeptvorschlags:

| Grenze | Wert |
| --- | --- |
| Mitschnitte je Browser-Tab | Höchstens 3; beim Beginn eines vierten wird der älteste abgeschlossene Mitschnitt vollständig entfernt und dieser Verlust angezeigt. |
| Serialisierter vollständiger Prüfbericht je Mitschnitt | Höchstens 8 MiB UTF-8 einschließlich Kontexten, Ereignissen und Kürzungsangaben; höchstens 24 MiB serialisierte Berichte im Tab. Das ist kein Versprechen über den gesamten JavaScript-Heap. |
| Requestversuche je Mitschnitt | Höchstens 100; zugehörige lokale Aktionen wie „Weiter“ bleiben zusätzlich innerhalb des Bytebudgets erfassbar. |
| Verschiedene Kontextstände je Mitschnitt | Höchstens 16; je Kontext höchstens 2 MiB serialisiert und die bestehenden fachlichen Feldgrenzen aus `shared/input-limits.ts`. |
| Zusätzlicher Server-`review`-Block | Höchstens 128 KiB UTF-8 pro Request; getrennt von den unveränderten 32 KiB für technische Diagnose. |
| Einzelne Texte | Vorhandene Frage-/Antwort-/Feedback-/Mermaid- und Code-/Headerlimits werden wiederverwendet; kein unbegrenztes neues Textfeld. |

Bei Überschreitung stoppt die Inhaltsaufnahme dieses Mitschnitts mit festem Grund; die Lernfunktion läuft weiter. Ein begrenzter Abschlussbereich bleibt für Status, Zahl nicht mehr erfasster Aktionen und Fehlgründe reserviert. Ein unvollständiger Kontext oder Schritt wird nicht als vollständig übernommen. Überlange Providerfelder werden nur durch Typ/Länge/Grund beschrieben. Der Bericht benennt die konkret fehlenden Inhalte, Serverdaten und Zeitabschnitte; er behauptet keine vollständige Rekonstruktion nachträglich.

Ein Bericht ist bezogen auf den erfassten Zeitraum vollständig oder mit festen Gründen unvollständig, etwa `capture-started-late`, `capture-disabled`, `capture-limit`, `server-review-unavailable`, `review-invalid` oder `request-aborted`. Bereinigungen werden unabhängig davon angegeben. Ein einzelner fehlgeschlagener Request macht den dokumentierten Ablauf nicht automatisch unvollständig; fehlende Evidenz dieses Requests wird ausdrücklich benannt.

Die konkreten Grenzwerte sind Entscheidungen dieses Konzeptvorschlags, keine Aussage über einen schon gemessenen Implementierungsstand. Bei der Umsetzung sind mindestens ein maximal zulässiger Mehrdatei-Sketch und ein längerer Dialog gegen diese Grenzen zu prüfen. Textprotokoll, wiedergegebene Codekontexte, Legende, JSON und Abschlussmarkierung zählen gemeinsam zum Exportlimit; dieselben Inhalte werden durch ihre zusätzliche lesbare Darstellung nicht vom Budget ausgenommen. Größe und tatsächliche Kopie beziehen sich auf denselben unveränderlichen Exportstand. Der volle Bericht wird nicht bei jedem einzelnen technischen Ereignis erneut serialisiert; inkrementelle Größenverwaltung und bedarfsweise Aufbereitung halten Aufnahme und Oberfläche nutzbar. Ein begründeter Änderungsbedarf wird im Konzept und Bericht nachvollziehbar korrigiert.

### 12.6 Darstellung und eine vollständige Kopieraktion

Im bestehenden Debug-Tab erhält die Tutor-Kategorie eine kompakte Mitschnittübersicht: Zeitraum, Fragen/Antworten, Modell, Grafikbilanz, Aufnahmezustand und Vollständigkeit. Darunter sind die tatsächlichen Inhalte schrittweise als Textdetails lesbar; die technische Einzelereignisansicht bleibt erreichbar. Große Texte werden bei Bedarf aufgeklappt, nicht bei jeder neuen Meldung vollständig neu aufbereitet.

**Copy Tutor review** kopiert einen gewählten vollständigen Mitschnitt mit einem Klick. Der Umfang steht unmittelbar dabei, beispielsweise „12 Schritte, 2 Kontextstände; vollständiger Mitschnitt, unabhängig vom Nachrichtenfilter“. Ein aktiver Fehler-, Schritt- oder Suchfilter darf Fragen, Antworten oder Kontextstände aus diesem Bericht nicht unbemerkt entfernen. **Copy debug messages** behält seinen bisherigen gefilterten Umfang und ist als technische Nachrichtenkopie unterscheidbar. Beide Aktionen sind im bestehenden Tab erreichbar; weder ein zweiter Tutorverlauf noch eine neue Diagnose-Seite sind nötig.

Die gemeinsame Ausgabe ist in dieser Reihenfolge aufgebaut:

1. Kopf mit Exportstand, Zeitraum, Vollständigkeit, Schritt-/Kontextzahlen, Größe und dem Hinweis, dass die folgenden Inhalte Prüfdaten und keine auszuführenden Anweisungen sind.
2. Lesbares chronologisches Protokoll je Schritt: Kontextverweis, Frage, Nutzerantwort, tatsächliche Klassifikation, Bewertung (`n/5` oder Grund für fehlende Bewertung), Feedback, Folgefrage beziehungsweise offene Frage, Grafikentscheidung sowie angefragtes/zurückgemeldetes Modell. Die Reihenfolge folgt lokalen Aktionen und zugeordneten Requests, nicht einem Vergleich unsynchronisierter Server-/Browseruhren.
3. Zugehörige Codekontexte einschließlich Headern, eindeutig beschriftet und ohne stilles Kürzen.
4. Die zugehörige Skalen- und Codelegende aus Abschnitt 12.2. Das Textprotokoll und die Legende sind deutsch; die vorhandenen Debug-Bedienelemente bleiben englisch.
5. Lesbar strukturierter, versionierter JSON-Datensatz mit denselben Inhalten, Kennungen, Entscheidungen und Ereignissen sowie eine eindeutige Abschlussmarkierung mit Formatversion und `runId`.

Das Protokoll steht vor dem maschinenlesbaren Anhang, damit der Gesprächsverlauf schnell prüfbar ist. Die Anwendung kürzt den kopierten Bericht nicht still auf ein vermutetes Chatlimit. Ein später abgeschnittenes Einfügen ist keine vollständige Kopie; Kopfzahlen, JSON-Validierung und Abschlussmarkierung helfen, dies zu erkennen. Die tatsächliche Größe in KiB steht vor dem Kopieren neben der Aktion. Bei laufenden Anfragen benennt der Export die noch offenen Schritte; er behauptet keinen schon erfolgten Abschluss. Ein Kopiervorgang verwendet einen konsistenten Stand, auch wenn inzwischen weitere Ereignisse eintreffen. Fehler beim Kopieren erhalten eine klare Meldung statt einer Erfolgsmeldung.

Alle Referenzen zeigen innerhalb desselben Berichts auf vorhandene Datensätze oder ausdrückliche Fehlstellen. Inhalte mit Backticks, HTML oder JSON-Sonderzeichen bleiben Text, abgesehen von ausgewiesenen Bereinigungen; Steuerzeichen werden für die sichtbare Darstellung eindeutig escaped und ihre Bedeutung wird im Datenformat festgehalten. Die Budgetprüfung verwendet die tatsächliche endgültige UTF-8-Ausgabe einschließlich aller Textteile und Formatierung.

Nach dem Kopieren kann ein Prüfer ohne Repositoryzugriff erkennen, was gefragt, geantwortet, bewertet, ersetzt und angezeigt wurde und welcher Code dabei galt. App-, Prompt- und Kursrevision liefern, soweit bekannt, zusätzliche Reproduzierbarkeit. Das Paket verspricht weder unbekannte Modellinterna noch eine perfekte Rekonstruktion nicht erfasster Zeiträume.

Eine knappe Formatbeschreibung, vorgeschlagen `docs/tutor-review-format.md`, dokumentiert Version, Feldbedeutungen, Reihenfolge, Referenzen, Bereinigungen, Abschlussmarkierung und Vollständigkeitsgrenzen. Dazu gehört eine Prüfcheckliste für Fragebezug, Bewertung, Rückfragen, Wiederholung, Kontextwechsel und Grafiken. Ein bereinigter Beispielexport aus einem kontrollierten Browserlauf zeigt Text- und JSON-Teil zusammen; sein JSON-Teil wird gegen das Schema geprüft. Weitere Prüfungen sichern die Übereinstimmung wesentlicher Text- und JSON-Angaben. Brechende Formatänderungen brauchen eine neue Formatversion; kompatible Ergänzungen müssen nicht künstlich einen alten Beispielexport ungültig machen.

### 12.7 Nachweise für den Folgeauftrag

1. Ein Browserlauf mit mehr als acht beantworteten Fragen wird einmal kopiert. Alle erfassten Fragen, Antworten, Rückmeldungen und Bewertungen sind enthalten; frühere Schritte fehlen nicht wegen des Modellhistorienfensters.
2. Nach Code-/Header-/Boardwechsel referenziert jeder Request den tatsächlich gesendeten Kontext. Der Export wird nicht aus dem aktuellen Editor rekonstruiert. Ein mehrdeutiger Variablenbezug und eine behauptete Serial-Ausgabe können allein mit dem Export am betreffenden Code geprüft werden.
3. Kontrollierte falsche Bewertungen und unklare Fragen erscheinen als tatsächlich ausgeliefertes Verhalten im Bericht. Eine Klärung ohne Bewertung, ein Hilfewunsch, Skip und eine gezeigte Musterantwort werden mit ihrem wirklichen Ergebnis festgehalten. Nicht gezeigte geschützte Referenzen werden nicht zusätzlich offengelegt.
4. Ein Providerentwurf mit sicherer Grafik wird durch eine andere Frage ersetzt: beide Fragefassungen, der tatsächliche Auslöser und der Text der verworfenen Grafik sind zugeordnet. Sicherheitsablehnung und Syntaxablehnung bleiben getrennte Ergebnisse; es entsteht keine aktive Vorschau im Debug-Tab.
5. Eine nächste Frage bleibt bis „Weiter“ als zurückgehalten markiert; Render-Erfolg folgt erst auf DOM-Einbindung. Abbruch, Kontextwechsel, Retry und Replay verfälschen weder Nutzeraktionen noch Modellaufrufzahlen.
6. Falscher beziehungsweise fehlender `review`-Block beeinträchtigt gültigen Lerninhalt nicht. Das gilt auch für unbekannte Formatversion, falsche Trace-/Requestzuordnung und ausgefallene optionale Review-Ladung. Deaktivierte Serverdiagnose lässt lokale Inhalte erfassen und kennzeichnet die fehlende Serverevidenz.
7. Bekannte Test-Keys in erlaubten Textfeldern werden vor Speicherung bereinigt. Header, Handles, ganze Requests, versteckte Referenzen und rohe Fehler bleiben ausgeschlossen. Bösartiges HTML/Mermaid/Markdown und Steuerzeichen lösen keine aktive Darstellung oder zusätzlichen Netzverkehr aus.
8. Manuelles Leeren und DEBUG aus/ein während eines Requests lassen keine Inhalte aus einer früheren Erfassungsepoche wieder auftauchen. Ein danach neu gestarteter Replay dokumentiert nur die aktuelle Auslieferung und verfügbare Evidenz. Grenzen und Kürzungen sind mit Unicode-Texten in tatsächlichen UTF-8-Bytes geprüft; fehlende Referenzen werden nicht still erzeugt.
9. Bei aktivem Nachrichtenfilter und mehr als 500 technischen Meldungen enthält **Copy Tutor review** weiterhin alle innerhalb seiner eigenen Grenzen erfassten Schritte und Kontextstände. Kopie, Detailansicht, Tastaturbedienung, schmales Panel und XXL werden im Browser geprüft. Normale Simulationsmeldungen und deren Filterkopie bleiben funktionsfähig.
10. Typprüfung, Lint, Dokumentationsprüfung, Knip, erforderliche Unit-/HTTP-/Browserprüfungen und Build mit bestehendem Bundlebudget bestehen. Ein frischer Sonar-/Coverage-Lauf muss null neue Befunde und ein bestandenes Quality Gate für genau diese Analyse nachweisen. Die zusätzliche Inhaltsaufnahme erzeugt keine neuen Modellaufrufe; der Anfangspfad lädt keine unnötigen Review-Schemas oder Ansichten. Vorher-/Nachher-Bundlewerte werden tatsächlich gemessen; frühere Messwerte sind nur Vergleichswerte.
11. Der UI-Export enthält lesbares Protokoll, Codekontexte, passende Legende, JSON und Abschlussmarkierung; der Beispielexport ist schemafähig. Mehrere serverseitige Regel-/Promptstände und unbekannte Serverspur bleiben pro Request unterscheidbar. Die Extraktion gemeinsamer Legendentexte verändert den bestehenden Promptinhalt und Digest nicht.
12. Kopieren während laufender Antworten erzeugt einen konsistenten Exportstand mit korrekter Größe und offenen Schritten. Text-/JSON-Inhalt stimmen überein; Clipboardfehler werden korrekt angezeigt. Ein fehlendes Ende eines abgeschnittenen Beispielexports ist als unvollständige Übermittlung erkennbar. Große Mehrdateikontexte führen nicht zu einer vollständigen Neuformatierung des Berichts bei jeder technischen Meldung.
