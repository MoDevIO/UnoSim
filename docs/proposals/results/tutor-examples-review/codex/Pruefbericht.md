> Unveränderte Kopie des Codex-Prüfberichts vom 31.10.2026 (absolute lokale Links zu Text reduziert). Zusammenführung: [Arbeitsbericht](../../../report-tutor-examples-review.md).

# Eingehende Prüfung: Built-in-Beispiele, Remote-Beispiele und Tutor

Datum: 31. Oktober 2026. Geprüfter Stand: UnoSim `02710f7690789f2a9a28464e79d8afff294ac7e9`, lokale Remote-Sammlung UnoSim-Examples `bdd4c0a5566bf9d12042d888de4e535555857d14`.

## Urteil

Die Ausführung der Beispiele ist auf dem geprüften Stand solide. Die Verbindung zwischen Projektwechsel, Kurskontext und Tutor ist noch nicht zuverlässig genug. Mehrere Fehler beeinträchtigen den Lernpfad; einer kann nachträgliche Codeänderungen überschreiben. Außerdem enthält das Lehrmaterial fachliche Fehler und die Dokumentation widerspricht teilweise der aktuellen Emulation.

Für eine Freigabe als verlässlich hochwertiger Tutor sollten zuerst die Befunde R1–R6 behoben werden. Die fachliche Qualität aktueller Live-LLM-Rückmeldungen und die visuelle Darstellung im echten Browser konnten in dieser Umgebung nicht abschließend geprüft werden.

## Umfang und Belege

- 15 Built-in-Beispiele: zehn allgemeine Beispiele und fünf Bibliotheksbeispiele.
- 51 Remote-Beispiele, alle mit eingebettetem Tutor-Fokus; insgesamt 228 hinterlegte Fokusfragen. Die Fokusfragen wurden inhaltlich durchgesehen.
- Produktionspfade für Katalog, Revisionen, Laden, Bibliotheksübernahme, Tutor-Kontext, Planung, Historie und Antwortvalidierung; relevante SSOTs, Architekturentscheidungen, Benutzeranleitung und README der Sammlung.
- Alle 66 Beispiele mit Arduino CLI 1.5.1 und `arduino:avr@1.8.8` frisch für den Uno kompiliert und mit dem AVR-Emulator ausgeführt. Keine Compilerwarnungen aus den Sketches; `--warnings all` meldet bekannte unbenutzte Parameter im Arduino-Core.
- Die 51 neu kompilierten Remote-Beispiele stimmen mit den Ausgaben und Pin-Erwartungen des Referenzkorpus überein; dort definierte Zeittoleranzen wurden berücksichtigt. Keine Emulator-Diagnostik in den 66 Läufen.
- Zehn zusätzliche Verhaltensprüfungen für die allgemeinen Built-ins bestanden: Blinken, Pull-up-Eingang, Ein-/Ausgangskopplung, ADC, PWM, serielle Zeitmeldungen, Plotter, kombinierte IO, nichtblockierendes Timing und Showcase.
- 938 bestehende Prüfungen bestanden in den gesonderten lokalen Läufen: 522 Tutor-/Course-Content-Tests, 55 Client-Tests, 105 Examples-/Vertragstests, 218 Laufzeitkorpus-Prüfungen, 24 Board-Beispiel-Prüfungen und 14 Bibliotheks-Integrationstests. Letztere prüfen die vier neuen Bibliotheksbeispiele auf Uno, Nano und Mega.
- TypeScript-Prüfung bestanden. Dokumentationsprüfung bestanden: 97 Markdown-Dateien. Der Produktionsvalidator akzeptiert die aktuelle lokale Remote-Sammlung.
- Sechs zusätzlich erstellte Prüfungen im temporären Prüfverzeichnis schlagen auf dem aktuellen Stand fehl. Fünf belegen nutzerrelevante Zustandsfehler; eine weitere belegt eine defensive Lücke in `resetDialog`. Sie wurden nicht in das Repository übernommen.

Die positive Dokumentationsprüfung prüft formale Anforderungen. Sie belegt keine fachliche Widerspruchsfreiheit. Entsprechend prüft auch der Inhaltsvalidator überwiegend Struktur, Erreichbarkeit und Anwendbarkeit, keine vollständige fachliche Richtigkeit aller Lehrtexte.

### Prüfgrenzen

Der kombinierte erste Testlauf hatte 682 bestandene und 45 fehlgeschlagene Prüfungen. Davon waren 44 HTTP-Prüfungen durch lokale Socket-Sperren nicht ausführbar; ein direkter Listener-Versuch bestätigt `EPERM` für `127.0.0.1`. Eine CLI-Prüfung scheiterte an der von `tsx` verwendeten, ebenfalls gesperrten IPC-Pipe. Der Inhaltsvalidator lief mit `node --import tsx` erfolgreich. Diese 45 Ergebnisse werden nicht als nachgewiesene Produktfehler eingestuft und der Gesamtlauf wird nicht als grün ausgewiesen.

Chromium scheitert in der Sandbox an `MachPortRendezvousServer: Permission denied`. Die automatische Freigabeprüfung für eine Ausführung außerhalb der Sandbox endete zweimal durch Zeitüberschreitung. Auch die Modellabfrage des echten Tutor-Providers war nicht erreichbar (`provider-unavailable`); es gab keinen neuen Live-Dialoglauf. Die LLM-Qualität ist daher nicht durch einen aktuellen Stichprobenlauf belegt. Die Tutor-Reproduktionen verwenden den echten Anwendungscode mit einem kontrollierten Ersatz für den externen Provider.

Die Remote-Prüfung bezieht sich auf den genannten lokalen Checkout, nicht auf einen erneut von GitHub abgerufenen Deployment-Snapshot. Die referenzierten Kursfolien lagen nicht als geprüfte Unterlagen vor; ihre Übereinstimmung mit den Beispielen ist daher nicht abschließend bestätigt. ATtiny-Unterstützung der neuen Bibliotheken war gemäß Vorgabe kein Pflichtkriterium.

## R1 – Hohe Priorität: Historie ordnet die Bewertung der falschen Frage zu

**Beobachtung:** Der Tutor stellt Frage A. Nach der Antwort liefert der Server Frage B samt Metadaten für B. Der Client speichert anschließend den Text von A zusammen mit `questionId`, `conceptId`, `indicatorId` und weiteren Metadaten von B.

Die temporäre Prüfung protokolliert beispielsweise:

```json
{"question":"Frage A?","questionId":"frage-b","answerRating":5}
```

**Ursache:** use-tutor.ts übernimmt bei `buildDialogTurn` die Metadaten der neuen Response für den beantworteten Turn. Der Planner bevorzugt diese Kennung vor einem Abgleich über den Fragetext.

**Auswirkung:** Fragen, Konzepte und Bewertungen sind in der Historie falsch verknüpft. Ein Vergleichslauf mit dem echten Tutor-Service und identischen starken Bewertungen verändert bereits die Fokusreihenfolge: Der Clientpfad springt zum Bereich „Namen“, bevor der Bereich „Überschreiben“ vollständig durchlaufen ist. Eine fehlerhafte Fortschrittsauswertung ist damit mehr als eine theoretische Möglichkeit.

**Korrekturziel:** Metadaten der beantworteten Frage aus dem bisherigen Frageobjekt übernehmen; Feedback und Bewertung aus der neuen Response. Serverseitig widersprüchliche Text-/ID-Paare nicht unbesehen als Evidenz verwenden. Gemeinsamen Client-Service-Test über mindestens zwei Bereichswechsel ergänzen.

## R2 – Hohe Priorität: Verspätetes Laden überschreibt spätere Änderungen

**Reproduktion:** Beispiel im normalen Examples-Menü auswählen, die Detailantwort verzögern, Menü schließen, anschließend den Sketch bearbeiten, danach die Beispielantwort freigeben. Der spätere Code wird durch das Beispiel überschrieben.

**Ursache:** ExamplesMenu prüft nach dem Abruf die Serververfügbarkeit und Repository-Auswahl, aber keinen zwischenzeitlichen Projektwechsel oder Edit. Das Schließen des Menüs beendet den Detailabruf nicht.

**Auswirkung:** Verlust neu eingegebener Arbeit. Der Ladeweg für Bibliotheksbeispiele besitzt bereits einen Schutz vor zwischenzeitlichen Änderungen; das normale Menü verhält sich anders.

**Korrekturziel:** Ein gemeinsamer Ladeabschluss für alle Beispielwege, der die zwischenzeitliche Änderung von Dateien, Projekt und Bibliotheksauswahl erkennt. Eine veraltete Antwort darf weder Dateien noch Bibliotheken oder Tutor-Kontext übernehmen.

## R3 – Hohe Priorität: Ein neues Beispiel setzt den Tutor nicht zuverlässig zurück

**Beobachtung:** Der Client setzt den Tutor über einen Effekt zurück, wenn sich der serialisierte Course-Content-Kontext ändert. Ein Wechsel zwischen zwei Built-ins ändert diesen Kontext jedoch nicht. Die temporäre Prüfung lädt ein neues Built-in und findet anschließend weiterhin die alte Lernfrage vor.

Zusätzlich führt „Minimalbeispiel öffnen“ Dateien und Bibliotheken zusammen, löscht aber keinen zuvor aktiven Remote-Beispielkontext. Der gemeinsame Dateisystempfad übernimmt ebenfalls keine solche Kontextbereinigung.

**Auswirkung:** Alte Fragen und Antwortentwürfe können zum neuen Sketch stehen bleiben. Beim Wechsel von einem Remote-Beispiel zu einem Bibliotheksbeispiel kann sogar dessen alter Lehrerfokus weiterwirken. Auch erneutes Laden desselben Remote-Beispiels erzeugt keine neue Kontextkennung.

**Korrekturziel:** Projektübernahme und didaktischen Sitzungswechsel ausdrücklich miteinander verbinden. Jeden tatsächlich übernommenen neuen Beispielsatz als neue Lernsituation behandeln, unabhängig davon, ob Repository oder Beispiel-ID zufällig gleich bleiben. API-Key und Modellwahl können erhalten bleiben.

## R4 – Hohe Priorität: Lehrerfragen bleiben nach fachlich relevanten Codeänderungen aktiv

**Reproduktion mit Produktionscode:** Remote-Blinkbeispiel als aktiven Kontext verwenden, den gesamten Sketch durch

```cpp
void setup() {}
void loop() {}
```

ersetzen und eine Frage anfordern. Ergebnis:

> Welche Spannung liegt an `PIN_LED` an, solange `HIGH` geschrieben ist?

Beide referenzierten Codeelemente fehlen im aktuellen Sketch.

**Ursache:** inlineFocusMatch aktiviert den eingebetteten Fokus unabhängig von aktuellen Sketch-Fakten. Die Fragen haben keine Anwendbarkeitsanforderungen. Die Prüfung von Backtick-Begriffen findet beim Authoring statt. Anschließend ersetzt der Tutor-Service die Providerfrage durch den unveränderten Planungstext.

**Auswirkung:** Der LLM-Prompt fordert zwar aktuellen Codebezug, kann die abschließend eingesetzte unpassende Frage aber nicht korrigieren. Das betrifft einen normalen Lernablauf: Die Beispiele fordern ausdrücklich zu Codeexperimenten auf.

**Konsistenzproblem:** SSOT CourseContent beschreibt den Inline-Fokus ausdrücklich ohne Faktenanforderungen. Gleichzeitig bleibt der aktuelle Sketch im allgemeinen Tutor-Vertrag fachliche Autorität. Hier muss auch der Vertrag präzisiert werden.

**Korrekturziel:** Nach Änderungen die aktuelle Anwendbarkeit der Fokusfrage überprüfen. Fehlende Voraussetzungen müssen zu einer passenden Alternative oder einem kontrollierten Übergang zum freien Tutor führen. Gewöhnliche kleine Experimente sollen möglich bleiben, ohne unnötig die gesamte Sitzung zu verlieren.

## R5 – Mittlere bis hohe Priorität: Menüabruf beeinflusst den Tutor fachlich und löscht Entwürfe

Zwei zusammenhängende Reproduktionen:

1. Eine gespeicherte Repository-Auswahl liegt vor, aber noch kein Katalog. Die erste Tutor-Anfrage sendet keinen Course-Content-Kontext. Die konfigurierte Sammlung wird erst nach einem Katalogabruf berücksichtigt.
2. Während eines freien Lerndialogs wird erstmals ein Remote-Katalog geladen, ohne ein Beispiel auszuwählen. Dadurch ändert sich der abgeleitete Kontext; die bestehende Frage und ein noch nicht abgesendeter Antwortentwurf verschwinden.

**Ursache:** useTutor leitet die Kursidentität aus dem Katalog ab; der Store startet trotz gelesener Browser-Auswahl mit `catalog: null`. Ein Kontextwechsel setzt anschließend Frage, Historie und Antwortfeld zurück. Das Examples-Menü und die Einstellungen lösen die Katalogabrufe aus.

**Auswirkung:** Tutorverhalten und Datenverlust hängen davon ab, ob vorher ein Menü geöffnet wurde. Ein bloßer Blick in die Beispielsammlung sollte keinen laufenden Lernentwurf löschen.

**Korrekturziel:** Die aktive Kursauswahl unabhängig von der Menübedienung initialisieren. Abrufstatus des Katalogs, aktive Kursidentität, geladenes Beispiel und laufende Lernsitzung als unterschiedliche Zustände behandeln. Ein reiner Katalogabruf soll die aktive Sitzung erhalten.

## R6 – Hohe fachliche Priorität: Zwei konkrete Fehler im Lehrmaterial

### Deklaration und Definition in IT01.1

IT01.1 stellt `int anzahlTeile;` als reine Deklaration und `int anzahlFehler = 0;` als Definition dar. Die Tutorfrage verlangt ausdrücklich die Zeile, die „nur eine Deklaration“ ist.

In C++ sind beide globalen Variablenzeilen Definitionen und zugleich Deklarationen. Die globale Variable ohne ausdrücklichen Initialisierer wird zunächst mit null initialisiert. Der Unterschied ist hier die ausdrückliche Initialisierung, nicht „Deklaration versus Definition“. Eine reine Deklaration wäre beispielsweise eine passende `extern`-Deklaration ohne Initialisierer.

Die Vereinfachung darf nicht als fachlich exakte C++-Regel gelehrt und bewertet werden. Beispielkommentare, Lernziel und Tutorfragen müssen gemeinsam korrigiert werden; bei einer abweichenden Begriffskonvention der Kursfolien ist auch deren Verhältnis zur C++-Terminologie zu klären.

### Falsche Beobachtung in IT02.5

Das zweite Experiment verlangt, `&& 1` wegzulassen, und fragt, warum `100` erscheint. Der zugehörige `Serial.println`-Aufruf hat keinen `BIN`-Parameter. Nach der beschriebenen Änderung erscheint für das gesetzte Bit **4**.

Das Experiment wurde tatsächlich geändert, neu kompiliert und emuliert. Ausgabe:

```text
wert vorher:  101001
Bit 2 gesetzt? 0
wert nachher: 101101
Bit 2 gesetzt? 4
```

Entweder die erwartete Beobachtung auf 4 ändern oder ausdrücklich die Binärausgabe anfordern. Die jetzige Frage verlangt die Erklärung einer Beobachtung, die nicht eintritt.

## R7 – Mittlere Priorität: Finale Tutorantwort umgeht bestehende Qualitätsregeln

**Reproduktion:** Ein formal zulässiger Fokusfragetext enthält zwei Fragesätze mit zwei Fragezeichen. Der kontrollierte Provider liefert eine zulässige einzelne Frage. Der Tutor-Service liefert anschließend den ungeprüften Fokusfragetext mit beiden Fragen erfolgreich zurück. `inspectLearningQuestion` erkennt an diesem finalen Ergebnis selbst `multiple-primary-questions`.

**Ursache:** Die Antwortprüfung erfolgt vor dem Einsetzen der Planner-Frage; danach folgt keine gleichwertige finale Prüfung. Derselbe Transformationspfad kann auch den Schutz gegen vollständigen Lösungscode umgehen. Die Fokus-Schemas verbieten einen solchen Text nicht vollständig.

**Einordnung:** Dies wurde mit gezielt verändertem Lehrerdatum reproduziert. In der aktuellen Sammlung wurde damit kein vorhandener Zweifragen-Text behauptet.

**Korrekturziel:** Das fertig zusammengesetzte Ergebnis nach Planner-, Scaffold- und Fallback-Transformationen prüfen, bevor Sitzungsfortschritt übernommen wird. Zusätzlich solche Authoring-Fehler im Inhaltsvalidator abweisen.

## R8 – Mittlere Priorität: Dokumentation beschreibt unterschiedliche Produkte

- Das README der Remote-Sammlung erklärt, UnoSim führe keinen Uno-Maschinencode aus, `int` sei 32 Bit und `double` 64 Bit breit. Das beschreibt die frühere beziehungsweise Legacy-Ausführung. Die aktuelle Benutzeranleitung erklärt die Browser-Emulation mit AVR-Maschinencode; die Board-Fakten setzen `int` auf 16 und `double` auf 32 Bit. Das ist für Unterricht zu Datentypen und Überläufen ein wesentlicher Widerspruch.
- Die Benutzeranleitung behauptet in der Serial-Tabelle ein angehängtes Zeilenende mit Code 10. Tatsächlich sind „No line ending“, LF, CR und CRLF einstellbar. IT03.2 erwartet ebenfalls Code 10, ohne die notwendige Einstellung ausdrücklich zu nennen.
- Die Sammlung beschreibt sich als Uno-Sammlung, trägt aber bei keinem der 51 Beispiele eine Board-Angabe. Auch die 15 Built-ins haben keine. Laut aktuellem CourseContent-Vertrag bedeutet eine fehlende Angabe allgemeine Board-Eignung. Bei Beispielen mit festen Uno-Pins ist das keine belastbare Aussage. ATtiny-Unterstützung nachzurüsten ist dafür nicht erforderlich; die tatsächliche Zielplattform muss korrekt beschrieben sein.
- Die SSOT-Ausnahme für Inline-Fokus ohne Faktenprüfung muss mit dem übergeordneten Vertrag des aktuellen Sketch-Bezugs vereinbart werden; siehe R4.

**Korrekturziel:** Emulation und Legacy ausdrücklich unterscheiden, Voraussetzungen der Beispiele benennen und gemeinsame Fakten möglichst aus einer verbindlichen Quelle referenzieren. Die bestandene Markdown-Prüfung ersetzt diese inhaltliche Bereinigung nicht.

## Weitere didaktische und GUI-Verbesserungen

Diese Punkte sind Empfehlungen, keine zusätzlichen nachgewiesenen Ausführungsfehler:

1. **Feste Fokusfragen und adaptive Schwierigkeit transparent machen.** Der Inline-Fokus erzeugt für alle Fragen den Schwierigkeitsbereich 1–100 und keine eigenen Scaffolds. Im Vergleichslauf kam bei Difficulty 1 und 100 dieselbe Frage. Der angezeigte Wert ist daher kein Nachweis entsprechend angepasster Fokusfragen. Eine hochwertige Tutorführung braucht dazu entweder passende Varianten/Hilfen oder eine klare Einschränkung des Adaptionsversprechens.
2. **Erschöpfung und Verständnis unterscheiden.** Laut aktuellem Vertrag endet ein Fokus auch nach verbrauchten Fragen ohne erreichtes Verständnis. Das ist implementiert und dokumentiert, aber didaktisch schwächer als eine gezielte Wiederaufnahme mit einem kleineren Teilproblem. Ein Übergang in den freien Tutor sollte nicht den Eindruck eines erfolgreich abgeschlossenen Lernbereichs erzeugen.
3. **Den gemeinsamen Qualitätsstandard der Beispiele sichtbar machen.** Die Remote-Sammlung besitzt durchgängig Lernziele, Beobachtungen, Experimente und Lernfragen. Die Built-ins sind überwiegend sehr knappe englische Funktionsdemonstrationen. Ihre Rolle als schnelle Referenz oder als Lerneinstieg sollte klar sein; Lernziel, notwendige Bedienhandlungen und erwartete Beobachtung fehlen dort oft. Das muss den eigentlichen Minimalcode nicht unnötig verlängern.
4. **Tutoraktionen verständlich benennen.** Die zentrale Fragezeichen-Schaltfläche beschreibt mit ihrem zugänglichen Namen einen Status, startet beim Betätigen aber einen neuen Dialog und verwirft den bisherigen. Aktion und Status sollten sprachlich unterscheidbar sein. Ebenso sollte erkennbar sein, ob gerade ein Lehrerfokus oder der freie Tutor arbeitet, ohne technische IDs anzuzeigen.
5. **Auffindbarkeit und Voraussetzungen verbessern.** Bei 51 Remote-Beispielen sind Thema, kurze Beschreibung und Suchbarkeit relevanter als bei einem einzelnen Bibliothekseintrag. Vor dem Start sollten erforderliche Eingabeaktionen, Zeilenende und Board erkennbar sein. Lange Dateinamen sind kein guter Ersatz für eine verständliche Themenbezeichnung.
6. **Semantische Qualität separat abnehmen.** Für jeden Themenbereich eine kleine fachlich überprüfte Stichprobe aus korrekter, teilweise richtiger, fachlich falscher und knapper korrekter Antwort bewerten. Kriterien: fachliche Richtigkeit, faire Bewertung, ein konkreter nächster Lernschritt, hilfreiche Rückmeldung bei Fehlern, keine vorweggenommene Lösung und keine erfundenen Sketch-Elemente. Ein aktueller Live-Lauf steht noch aus.

## Zusätzliche defensive Beobachtung

`resetDialog()` beendet laufende Requests nicht selbst. Eine zurückgehaltene Antwort kann nach einem direkten Reset wieder die alte Frage setzen; die sechste temporäre Prüfung belegt das. Die aktuelle GUI deaktiviert die neue-Frage-Aktion während eines Requests, weshalb dieser isolierte API-Befund niedriger priorisiert wird als die tatsächlich erreichbaren Beispiel- und Katalogwechsel. Ein zentraler Sitzungswechsel sollte auch diese Race-Bedingung absichern.

## Sinnvolle Reihenfolge

1. R1–R5: Historie, Ladeabschluss, Projekt-/Sitzungswechsel und Anwendbarkeit korrigieren und als zusammenhängenden Ablauf prüfen.
2. R6–R8: Lehrmaterial und Dokumentation berichtigen; finale Antwortvalidierung schließen.
3. Danach didaktische Dialogstichproben mit dem echten Provider und eine visuelle Prüfung der tatsächlichen GUI durchführen. Erst diese Stufe erlaubt eine belastbare Aussage zur aktuellen Feedbackqualität des Sprachmodells und zur optischen Umsetzung.

## Prüfartefakte

- [Frische Kompilier- und Laufzeitergebnisse](compile-results.json)
- [Verhaltensprüfungen der zehn allgemeinen Built-ins](builtin-checks.json)
- [Tutor-Traces, Reihenfolgevergleich und finale Validierung](audit.json)
- [Temporäre Client-Regressionsprüfungen und Fehlerausgaben](client-regressions.log.txt)
- [Fachlicher Bitoperatoren-Versuch](bit-experiment.json)
- [Bestehende Tutor-Tests](tutor-unit.log.txt), [Client-Tests](client-unit.log.txt), [Examples-Tests](examples-unit.log.txt)
- [Emulationskorpus](emulator-examples.log.txt), [Board-Beispiele](emulator-corpus.log.txt), [Bibliotheks-Integration](library-examples.log.txt)
- [Typprüfung](types.log.txt), [Dokumentationsprüfung](docs-check.log.txt), [Inhaltsvalidator](course-check.log.txt)
- [Socket-Beschränkung](socket-check.log.txt), [Provider-Erreichbarkeit](provider-access.json), [kombinierter erster Testlauf](tests.log.txt)

Es wurden keine Produktdateien, Tests oder Dokumente der beiden Repositories geändert, keine Commits erstellt und nichts gepusht. Die bereits vorhandenen unversionierten Editor-Dateien in UnoSim-Examples blieben unberührt. Sämtliche neuen Prüfskripte und Ergebnisse liegen ausschließlich in diesem temporären Prüfverzeichnis.
