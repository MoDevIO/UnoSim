# Konzept: Fachlich hilfreiche Tutor-Grafiken in klassischer UML-Notation

Stand: 2026-11-12. Am 2026-11-12 vom Nutzer für Planung und Umsetzung A–D freigegeben. Die Zustimmung zu einem bestehenden Renderer ist bedingt: Er muss die Anforderungen erfüllen. PlantUML ist der bevorzugte Kandidat, seine tatsächliche Eignung ist mit der ausgewählten Laufzeit nachzuweisen.

Umsetzung A–D am 2026-11-13 abgeschlossen; [Arbeitsbericht](../../proposals/report-tutor-classic-uml.md) und [unabhängige Gesamt-/Nachprüfung](../../proposals/review-tutor-classic-uml-2026-11-13.md). Das Konzept bleibt der freigegebene Vertrag; die getrennte Live-Studie E ist nicht beauftragt.

Eine unabhängige Leseprüfung hat die Artefaktbudgets und die Abgrenzung von Heaplimit und Prozessbaum-Speicher als notwendige Entscheidungen benannt. Sie sind in §7, §9 und §13 konkretisiert. Diese Prüfung war keine Ausführung des Renderers.

Grundlage: [Grafiken für Tutorfragen immer anfordern](2026-11-12-tutor-question-graphics-mode-design.md), die drei Screenshots aus dem Nutzertest und die anschließende Festlegung auf die ursprüngliche, bewusst einfache UML-Notation. Vorhandene uncommittete Implementierung und Prüfnachweise bleiben unverändert bestehen. Dieses Dokument ersetzt deren Freigabe nicht rückwirkend; es beschreibt die nächste Erweiterung.

## 1. Ziel und bestätigte Entscheidungen

- Nur Grafiken zu Tutorfragen; Hinweise, Klärungserklärungen und Musterantworten erhalten keine neue Grafikfunktion.
- Klassische UML-1.x-Darstellung mit einem kleinen, verbindlichen Symbolsatz. Einfachheit zählt; keine Sammlung sämtlicher UML-Elemente.
- Aktivitätsdiagramme für Ablauf und Entscheidungen, Klassendiagramme für tatsächlich vorhandene Klassen, Sequenzdiagramme für belegte Interaktionen.
- Ein bestehender Renderer ist akzeptiert, sofern er Notation, Darstellung und Betriebsanforderungen erfüllt.
- Eine Grafik soll beim Bearbeiten der konkreten Frage helfen. Eine formal richtige, aber beliebige Begriffskette erfüllt den Auftrag nicht.

Implementierungsentscheidungen dieses Entwurfs, bisher keine zusätzlichen Nutzerfestlegungen: serverlokales PlantUML als bevorzugter Renderer; geprüftes Diagrammmodell als Eingabe; versioniertes Profil `uml1-classic-v1`; getrennte technische und fachliche Prüfungen; stufenweiser Nachweis vor dem Austausch der bisherigen Darstellung.

## 2. Befund am aktuellen Stand

Die bestehende Funktion sichert Anforderung, begrenzte Nachforderung, Fragezuordnung, Abbruch, Retain, Replay und bereinigte Erfassung ab. Sie belegt keinen allgemeinen fachlichen Mehrwert echter Modellgrafiken.

| Beobachtung | Ursache bzw. notwendige Korrektur |
| --- | --- |
| Kommentare erscheinen wie ausführbare Schritte. | Ausführungsaktionen müssen durch ausführbaren Code oder den ausdrücklich benannten Arduino-Laufzeitvertrag belegt sein. |
| Bei einer Datentypfrage entsteht eine Kette aus Deklaration, Ausgabe, Plotter usw. | Die Darstellung beantwortet nicht erkennbar ein Bedürfnis dieser Frage; Diagrammtyp und Relevanz müssen vor dem Zeichnen geprüft werden. |
| Beim Funktionstest werden Testfall, Ist-Wert, Soll-Wert und Vergleich linear verbunden. | Datenabhängigkeit und zeitliche Ausführung dürfen nicht als dieselbe Kantenart behandelt werden. Eine solche Darstellung muss entweder korrekt modelliert werden oder entfallen. |
| Diagramme schrumpfen im Tutor zu winzigen Schriftzeilen. | Natürliche Mindestschriftgröße, vertikales Layout und Vergrößerungsmöglichkeit statt unbegrenztem Einpassen. |
| Alle Ablaufknoten sind abgerundete Rechtecke. | `client/src/lib/tutor-mermaid.ts` verwirft die Forminformation; auch Zustandsdiagramme werden durch denselben Ablaufzeichner dargestellt. Das ist kein verlässlicher UML-Renderer. |
| Klassen fehlen; Sequenzen unterstützen nur wenige Pfeile. | `classDiagram` ist im aktuellen Vertrag nicht erlaubt. Die eigene Sequenzdarstellung unterscheidet z. B. keine Rückgaben. |

## 3. Ansätze und Entscheidung

| Ansatz | Nutzen | Grenze / Entscheidung |
| --- | --- | --- |
| Bisherige Prompts verschärfen | Geringer Eingriff, kann bessere Vorschläge liefern. | Erzwingt weder korrekte Symbolformen noch Layout oder fachlichen Nutzen. Allein ungeeignet. |
| Eigenen Renderer um UML erweitern | Bleibt ohne neue Serverlaufzeit im bisherigen Browsercode. | Drei Diagrammarten, Verzweigungen, Rückkanten, Pfeilsemantik und Layout müssten selbst zuverlässig entwickelt werden. Nicht bevorzugt. |
| Bestehenden UML-Renderer mit geprüfter Eingabe verwenden | Vorhandene Diagrammarten und Layoutverfahren; Notationsprofil bleibt in UnoSim kontrollierbar. | Zusätzliche Laufzeit und Integration nötig. Vom Nutzer grundsätzlich akzeptiert, an die Abnahmekriterien gebunden. Bevorzugter Weg: PlantUML. |

Ein Renderername oder eine Option namens `legacy`/`strictuml` gilt nicht als Konformitätsnachweis. Die PlantUML-Dokumentation bezeichnet mit „Legacy“ eine Eingabesyntax. Maßgeblich sind die vereinbarten sichtbaren Symbole, die Kantenbedeutung und bestandene Referenzfälle. Ob der Adapter dafür alte oder aktuelle PlantUML-Syntax verwendet, darf die Implementierung nach dem Rendernachweis entscheiden.

## 4. Verbindliches kleines Notationsprofil

Das Profil heißt `uml1-classic-v1`. Es implementiert den hier vereinbarten klassischen Ausschnitt; es behauptet keine vollständige Implementierung einer historischen UML-Gesamtspezifikation. Eine aktuelle Renderer-Version darf diesen klassischen Ausschnitt zeichnen.

### 4.1 Aktivität

- Start: ausgefüllter Kreis. Ende: klassisches Endsymbol, ausschließlich bei einem tatsächlich endenden dargestellten Ablauf. Der Arduino-Gesamtablauf erhält keinen erfundenen Abschluss.
- Aktionen/Aktionszustände: gerundete Rechtecke mit konkreten Tätigkeiten; keine Themenbegriffe als Ersatz für Aktionen.
- Entscheidungen/Zusammenführungen: Rauten. Ausgehende Bedingungen sind als Guards in eckigen Klammern lesbar. Verzweigung und Zusammenführung bleiben unterscheidbar.
- Gerichtete Kontrollflusskanten; Schleifen durch passende Rückkanten. Reihenfolge und Erreichbarkeit werden erhalten. Bedingungen sind keine ausgeführten Aktionen.
- Erster Umfang: Sequenz, Entscheidung, Zusammenführung und Schleife. Synchronisationsbalken, echte Nebenläufigkeit und Swimlanes sind spätere Profilerweiterungen; sie dürfen nicht als sequentielle Ersatzzeichnung ausgegeben werden.
- Kein Objekt-/Datenfluss als unbeschrifteter Kontrollfluss. Eine globale Variable, ein Kommentar oder ein Soll-Wert wird nicht zu einer ausgeführten Aktion.

### 4.2 Klasse

- Rechteck mit Klassenname sowie getrennten Bereichen für gezeigte Attribute und Operationen. Sichtbarkeit, Typen und Signaturen folgen belegten Deklarationen.
- Erster Umfang: Klassen/Structs, Attribute, Operationen, Generalisierung und belegte Assoziation. Vererbung mit leerem Dreieck zur Basisklasse; Assoziation als Verbindung mit ausgewiesener Bedeutung.
- Keine aus globalen Variablen erfundene Klasse `Sketch`. Bibliotheksnamen begründen keine erfundenen Bibliotheksattribute oder Methodenimplementierungen.
- Aggregation, Komposition und Multiplizitäten nur nach einer späteren Erweiterung mit tragfähigen Faktenregeln; der erste Umfang behauptet sie nicht aus einem Zeiger oder einer Namensähnlichkeit.

### 4.3 Sequenz

- Benannte Beteiligte und gestrichelte Lebenslinien; Nachrichten von oben nach unten.
- Synchrone Aufrufe und Rückgaben haben unterschiedliche klassische Pfeildarstellung. Aufrufe dürfen nicht als Rückgaben umgedeutet werden. Selbstaufrufe und Aktivierungen sind bei belegtem Bedarf erlaubt.
- Beteiligte sind tatsächliche Objekte oder ausdrücklich ausgewiesene Ausführungskontexte, beispielsweise die Sketch-Ausführung und `Serial`. Eine freie Funktion wird nicht ohne Erklärung zum Objekt.
- Erster Umfang: konkrete synchrone Aufrufsequenzen, Rückgaben, Selbstaufrufe und einfache Aktivierungen. Keine UML-2-Kombinationsfragmente (`alt`, `opt`, `par` usw.). Für nicht unterstützte Kontrollstrukturen wird eine andere passende Diagrammart oder kein Diagramm gewählt.

Für alle drei Arten: normale Zeilenumbrüche statt abgeschnittener Bezeichner; ein kleines fokussiertes Diagramm statt vollständiger Programmdokumentation. Bewusst ausgelassene Teile sind als Ausschnitt erkennbar und dürfen keine für die Frage entscheidende Kante unterschlagen.

## 5. Diagrammwahl, Relevanz und Lösungsverrat

1. Die endgültige Tutorfrage steht fest. Die Grafik darf weder Lehrkraftfrage noch Bewertung oder Lernziel verändern.
2. Der Vorschlag nennt Diagrammart, betrachteten Codeausschnitt und einen kurzen konkreten Beitrag zur Frage. „Zeigt den Ablauf“ allein begründet keine Wahl.
3. Dargestellte Programmfakten haben prüfbare Referenzen auf die tatsächlich gesendeten Dateien und Codebereiche. Belege für Arduino-Laufzeitregeln verwenden einen kleinen app-eigenen Faktenkatalog. Ein Modell darf keine zusätzlichen Plattformfakten erfinden.
4. Die Anwendung prüft Referenzen und unterstützte Strukturen konservativ. Ein gültiger Zeilenverweis allein beweist keine Aussage über Aufrufreihenfolge, Typ oder Klassenbeziehung. Nicht auflösbare Makros, Mehrdeutigkeit, fehlende Header oder fremde Bibliotheksimplementierungen begründen keine behauptete Gewissheit. Der erste Umfang braucht keine zusätzliche Sketch-Kompilierung und keinen vollständigen C++-Compiler.
5. Die Grafik zeigt belegten Kontext oder eine ausdrücklich markierte Aufgabenlücke; sie beschriftet nicht bereits die gesuchte Antwort. Eine Lücke muss zur bestehenden Frage passen, ohne deren Sinn zu ändern.
6. Ohne hilfreiche zulässige Darstellung ist `not-useful` ein ehrliches Ergebnis, auch bei „Grafiken immer anfordern“. Die Anforderung wird protokolliert; eine bedeutungslose Grafik erfüllt sie nicht.

Technisch erzwingbar sind Schema, Symbolsatz, Referenzgrenzen und bekannte Gegenbeispiele. Allgemeine fachliche Eignung und sinngemäßer Lösungsverrat bleiben zusätzlich durch eine Bewertungsrubrik und später echte Modellmessungen zu prüfen. Ein `profile-accepted` darf nicht als „fachlich korrekt bestätigt“ angezeigt werden.

Die unklare Frage „Datentyp der betrachteten Variable“ wird nicht durch ein Diagramm repariert. Eine nicht eindeutige Referenz ist ein eigener Tutorbefund; diese Erweiterung ändert solche Fragen nicht stillschweigend.

## 6. Vertrag und Verarbeitung

Die folgenden Verträge sind Sollvorgaben für die spätere Umsetzung, noch keine produktiven APIs.

- Modellvorschlag als strikte versionierte Union: `diagram` mit `kind: activity | class | sequence`, strukturierten Elementen, Referenzen und begrenzter Relevanzbegründung; oder `not-useful` mit festem Grund und begrenzter Erklärung. Keine Pixel, Koordinaten, SVGs, URLs oder frei formulierten PlantUML-Anweisungen vom Modell.
- Typisierte Elemente statt universeller Kästchen: z. B. Aktion/Entscheidung/Start/Ende mit Kontrollfluss; Klasse/Attribut/Operation/Beziehung; Beteiligter/Aufruf/Rückgabe. Referenzen adressieren einen bekannten Dateinamen und einen begrenzten Codebereich. Mehrfachdateien, Board und unveränderter Fragenkontext sind Teil der Bindung.
- Der Server prüft den Vorschlag, baut daraus mit festen Vorlagen und geprüfter Textkodierung PlantUML und rendert serverlokal. Labels sind Daten; sie dürfen weder zusätzliche Anweisungen noch Formatierung oder Ressourcen einführen.
- Die fachliche Transaktion übernimmt den Lernschritt erst nach dem optionalen Grafikpfad und einer letzten Abbruchprüfung. Eine Grafikstörung erhält den gültigen Textschritt. Keine erneute Bewertung, Evidenz oder Planerbuchung durch den Renderer.
- App-eigener Status: `provided`, `not-useful` oder `unavailable`; renderer- und profilbezogene Metadaten werden nicht vom Modell übernommen. Nur `provided` enthält ein geprüftes Darstellungsartefakt.
- Vorschlagsbindung und Artefaktbindung umfassen Codekontext, endgültige Frage, Profil und Rendererrevision. Ersetzt der Planer eine Frage, wird ein unpassender Vorschlag verworfen und keine alte Grafik wiederverwendet.

`auto` behält seine optionale Anforderung ohne zusätzlichen Modellaufruf. `always` behält höchstens einen zusätzlichen Grafikmodellaufruf je fachlicher Aktion. Ein ausdrückliches `not-useful` löst keine weitere Modellschleife aus. Serverprüfung und lokales Rendern sind keine Judge-/KI-Aufrufe und werden separat gezählt und begrenzt. Derselbe gewählte Modellzugang und die tatsächlich gesendete Modell-ID bleiben für eine Nachforderung verbindlich.

Vor einer Nachforderung wird die bekannte Renderer-Verfügbarkeit geprüft. Ein fehlender Renderer ist kein Anlass für einen zusätzlichen kostenpflichtigen Modellaufruf. Ein trotzdem während der Anfrage eintretender Rendererfehler bleibt ein technischer Ausfall.

Retain erhält den zuletzt tatsächlich ausgelieferten Grafikzustand nur bei derselben Frage und unverändertem Kontext. Akzeptiert der Primäroutput eine neue passende Grafik bei Retain, wird auch der gespeicherte Zustand aktualisiert. Weiter, Replay, Remount, Reset und Erfassungsepochen behalten ihre Schutzregeln. Erfolgreiche Replays verwenden das gespeicherte Artefakt und rufen weder Modell noch Renderer erneut auf.

## 7. Serverlokaler Betrieb und sichere Ausgabe

Bevorzugte Betriebsform ist ein serverlokaler PlantUML-Kindprozess mit Standard-Ein-/Ausgabe. Es wird kein öffentlicher PlantUML-Dienst und kein CDN verwendet. Tutor benötigt bereits den Backendzugang; die Browser-Emulation bleibt davon unabhängig.

- Renderer, nötige Java-Laufzeit, Layoutengine und Fonts werden reproduzierbar versioniert und für die gewählte Distribution mit Prüfsummen und Lizenzdateien dokumentiert. Keine Downloads beim Tutorrequest, keine Abhängigkeit von einem beliebigen global installierten `plantuml`.
- Docker-Image, lokale Entwicklung und Ubuntu/VBox-Installer erhalten einen beschriebenen Installations-/Prüfpfad. Nötiges Graphviz wird als echte Abhängigkeit behandelt, sofern die gewählte Konfiguration es benötigt. Betrieb ohne Renderer lässt den Tutortext funktionieren und meldet Grafik-Unverfügbarkeit.
- Start über Argumentliste ohne Shell, minimale Umgebungsvariablenliste ohne Tutorcredential, API-Tokens oder Servergeheimnisse, headless Betrieb und ein eigener begrenzter Arbeitsbereich. Gesamter Sketch und nicht gezeigte Referenzantworten werden dem Renderer nicht übergeben; nur der validierte Diagrammausschnitt.
- PlantUML `SANDBOX` ausdrücklich setzen. Keine vom Inhalt gesteuerten Includes, URLs, Dateipfade, Sprites, Hyperlinks oder Bildreferenzen. Das Profil ersetzt weder die Eingabeprüfung noch Prozess-/Ausgabelimits.
- Metadateneinbettung der Quelle ausdrücklich deaktivieren. Rohes stdout/stderr, Fehlerschaubilder und Pfade gehören nicht in die UI oder den Review. Ein Bild mit Rendererfehlertext darf nicht als erfolgreiches Diagramm durchgehen.
- Erste feste Grenzen: 16 KiB Diagrammvorschlag vor Bereinigung, höchstens 12 fachliche Knoten/Beteiligte und 24 Kanten/Nachrichten; für Klassen zusätzlich zusammen höchstens 24 gezeigte Attribute/Operationen. Höchstens 512 KiB ausgegebenes SVG und 2.400 × 4.000 intrinsische Einheiten. Ein rendernder Prozess höchstens 10 Sekunden und 256 MiB Java-Heap; maximal zwei aktive Renderprozesse und acht Wartende pro Server. Abbruch beendet auch gestartete Layout-Unterprozesse. Geschwindigkeits- und Speichergrenzen müssen in Etappe A auf Zielplattformen bestätigt werden; sie dürfen nur mit dokumentierter Begründung angepasst werden.
- Der erste Umfang verlangt zusätzlich zu diesen Grenzen **keine plattformübergreifende harte Gesamtspeichergrenze des Renderer-Prozessbaums**. 256 MiB bezeichnet ausschließlich den Java-Heap. Etappe A misst ausdrücklich auch nativen JVM-Speicher und Layout-Unterprozesse bei zwei gleichzeitigen Renderings, dokumentiert die gemessene Gesamtspitze und den nötigen Server-RAM und prüft dies im Deployment. Eine fehlende Eignung für die unterstützte Zielumgebung ist ein Abbruchgrund der Eignungsprüfung. Vorhandene Container-/Hostgrenzen bleiben wirksam, werden aber nicht als separate harte Renderergrenze ausgegeben. Diese bewusste Implementierungsentscheidung vermeidet eine neue Containerpflicht für die lokale Browser-Emulationsinstallation; sie ist keine Zusage, dass ein Prozessbaum insgesamt auf 256 MiB begrenzt wäre.
- Ausgabe wird als begrenztes SVG geprüft und normalisiert: keine Skripte, Eventattribute, `foreignObject`, Animation, aktiven Links oder externen Ressourcen. Die nötige Geometrie, Texte und sichere Farben bleiben erhalten. Fehlerhafte XML-Strukturen, unzulässige Elemente, Größe oder Abmessungen werden abgewiesen. Keine stillschweigende Zeichen- oder Knotenstreichung.
- Browseranzeige ausschließlich als Bild, z. B. über eine kurzlebige Blob-URL und `img`, mit zugänglicher Beschreibung. Kein `dangerouslySetInnerHTML` für das neue Format. Blob-Lebensdauer wird bei Wechsel und Unmount bereinigt; Zoom verwendet dasselbe geprüfte Bild.

Die bestehende CSP erlaubt Bilddaten und Blob-URLs bereits; ihre Script-/Connect-Berechtigungen werden für diesen Zweck nicht erweitert. Der Renderer hat keinen fachlichen Bedarf an Zugangsdaten oder Netzwerkzugriffen.

## 8. Lesbarkeit und Benutzeroberfläche

- Aktivitätsdiagramme zunächst vertikal. Kleine Klassen- und Sequenzdiagramme nach ihren natürlichen räumlichen Beziehungen.
- Lesbare Grundschrift mindestens 14 CSS-Pixel bei 100 % UI-Skalierung; Diagrammschrift berücksichtigt die vorhandene UI-Skalierung. Kein erzwungenes Gesamteinpassen mit unlesbar kleiner Schrift.
- Bei Platzmangel kontrolliertes Scrollen und „Vergrößern“ mit Tastaturbedienung, Escape und Fokus-Rückgabe. Vergrößerung löst weder Render- noch KI-Aufruf aus.
- Kontrastreiche, feste einfache Symbolformen für helles und dunkles Theme. Für den ersten Umfang ist ein monochromes Diagramm auf eigenem hellem Bildgrund in beiden Themes vorgesehen; ein Themewechsel benötigt damit keinen neuen Renderaufruf. Die Erscheinung ist in Etappe A im echten Tutorbereich bei 320, 480 und 800 CSS-Pixel Breite sowie der vorhandenen XXL-Skalierung zu prüfen.
- `not-useful`: „Zu dieser Frage ist keine hilfreiche zusätzliche UML-Grafik verfügbar.“ Technischer Ausfall behält „Grafik konnte nicht bereitgestellt werden.“ Eine fehlgeschlagene Bildanzeige meldet „Grafik konnte nicht dargestellt werden.“
- Frage und Artefakt bzw. Rückmeldung bleiben zusammen bis Weiter gehalten. Keine neue Bedieneinstellung pro Diagrammart; die Frage und der Code bestimmen die Art. Die ursprüngliche Settingauswahl und deren Requestsnapshot bleiben erhalten.

## 9. Diagnose, Review und Größenverträge

In der vorhandenen Erfassung ergänzen: angefordertes und verwendetes Profil, vorgeschlagene Art, Relevanzbegründung, geprüfte Quellreferenzen, Validierungsentscheidung, Nachforderungszahl, Rendererstart/-ende/-fehler/-abbruch, Versionen, Dauer, Ausgabegröße, Abmessungen und tatsächliche Bildanzeige. Modellantwort, Serverannahme, gerendertes Artefakt und Browseranzeige bleiben unterschiedliche Stationen.

Der kopierbare Review hält den normalisierten, geprüften Diagrammvorschlag, die relevanten Entscheidungen und die tatsächlich gewählte endgültige Frage; keine SVG-/Bilddaten, PlantUML-Rohquelle, Vollprompts oder Rohprozessausgaben. Er enthält damit prüfbaren Inhalt anstelle einer bloßen Erfolgsmeldung. Die maximal gespeicherte freie Textlänge folgt weiterhin aus der ursprünglichen Grenze und der gemeinsamen idempotenten Credentialbereinigung; feste öffentliche Codes werden validiert und nicht als Geheimnistext behandelt.

Vorschlag und Artefakt sind im Speicher getrennt: das Bild zählt zu einem eigenen begrenzten, an die bestehende aktive/held/replay-Lebensdauer gebundenen Artefaktbudget, gelangt aber nicht in die 8-MiB-Reviewkopie. Bestehende Reviewlimits werden nicht still angehoben. Überläuft ein Serverblock oder die Erfassung nach Bereinigung, wird dies mit den vorhandenen Vollständigkeitsgründen ausgewiesen, niemals durch eine als vollständig bezeichnete Kürzung verdeckt.

Verbindliche anfängliche Artefaktbudgets, als explizite Implementierungsentscheidung:

- Server: 64 MiB insgesamt, 8 MiB je vertrauenswürdig gebundener Tutoridentität und 4 MiB je Supportsession. Gezählt werden der kanonische Bildinhalt und die dafür gespeicherten serialisierten Metadaten; dies ist ein Nutzdatenbudget, keine Behauptung über den gesamten Node-Heap. Fehlt bei einer bisherigen ungebundenen Anfrage eine Session/Identität, bleibt das Artefakt requestlokal unter dem globalen Budget; es wird kein zusätzlicher Anmeldezwang eingeführt.
- Supportzustand und Replayantworten referenzieren denselben Artefakteintrag. Keine erneute SVG-Kopie pro gespeicherter Aktion. Die HTTP-Auslieferung kann den Bildinhalt aus dieser Referenz ergänzen, ohne die gespeicherte logische Antwort zu verändern. Eine Referenz ist privat und nicht Teil des Reviews. Ein neuer Bilddownload-Endpoint ist für diesen Umfang nicht erforderlich.
- Browser: 4 MiB serialisierter Bild-/Metadateninhalt für sichtbare, gehaltene und noch auszuliefernde aktive Grafik zusammen. Kein Grafikarchiv im Verlauf oder Review. Blob-/Bildressourcen und temporäre kodierte Kopien werden beim Wechsel freigegeben; Bildabmessungen begrenzen zusätzlich die mögliche Rasterfläche. Dieses Budget bezeichnet ebenfalls keine harte Obergrenze des gesamten Browser-RAM.
- Vor einem zusätzlichen Grafikmodellaufruf und spätestens vor dem Rendererstart wird Platz für ein maximales Artefakt reserviert; bei bekannt fehlender Kapazität gibt es keinen weiteren Grafikmodell-/Renderaufruf. Der primäre fachliche Tutoraufruf darf deswegen nicht verhindert werden. Nach dem Rendern wird auf die tatsächliche Größe abgerechnet, bei Fehler/Abbruch die Reservierung freigegeben. Die Anzahl und Größe auszuliefernder kodierter Kopien bleiben durch die aktive Anfragenzahl begrenzt und werden gesondert berücksichtigt.
- Bereits ausgelieferte und noch von Frage/held/Replay referenzierte Artefakte werden nicht zur Platzgewinnung verdrängt. Bei erschöpftem Budget wird ausschließlich die neue optionale Grafik mit `unavailable` und festem Grund `render-artifact-limit` abgewiesen; der Lernschritt bleibt gültig. Der Review ist dadurch nicht automatisch abgeschnitten: Er hält den tatsächlich ausgelieferten technischen Ausfall fest.
- Freigabe einer letzten Referenz, Ablauf/Entfernen der zugehörigen Session und Abbruch vor Auslieferung geben den Eintrag wieder frei. Bei einer erfolgreichen Replayanfrage muss das Artefakt bis zur bereits geltenden Replaygültigkeit erhalten bleiben; ein abgelaufener Supportvertrag behält seine bisherigen Fehlerregeln. Kein Zugriff durch andere Nutzer und keine benutzerübergreifende Deduplication.

Für den ersten Umfang kein persistenter oder benutzerübergreifender Rendercache. Ein bloßer Anzeigenwechsel verwendet das vorhandene Artefakt. Ein späterer Cache braucht eigene Nutzerbindung und eine vollständige Render-/Profil-/Theme-Identität.

## 10. Migration und betroffene Bereiche

Neue UML-Vorschläge und Artefakte erhalten ein eigenes versioniertes Feld; sie werden nicht in einen `mermaid`-String verpackt. Frische UML-Grafiken müssen das Profil in beiden Modi erfüllen. Ein stiller Rückfall auf die bisherige Kästchendarstellung erfüllt den neuen Vertrag nicht.

Die Einführung erfolgt als zusammengehörige Server-/Browseränderung mit expliziter Format-/Fähigkeitskennung. Bestehende gehaltene oder gecachte Legacy-Antworten werden entweder weiterhin ausdrücklich als Legacy behandelt oder beim Formatwechsel geordnet beendet; sie dürfen nicht als geprüftes UML-Artefakt umetikettiert werden. Ein neuer Client darf bei einem älteren Server dessen fehlende Fähigkeit anzeigen, ohne unbekannte Requestfelder blind zu senden. Die konkrete additive Vertragsgestaltung und die Namen der Fähigkeitenfelder legt der Umsetzungsplan fest.

Betroffen sind Prompts und deren Revision/Digest, Providerparser, Servicefinalisierung, Supportzustand, gemeinsame Request-/Response-/Reviewverträge, Rendererprozess, Konfiguration/Verfügbarkeit, Deployment/Installer, Vorschau/Zoom und die bestehende Diagnoseerfassung.

Testintegrität: Bestehende Sicherheits-, Bewertungs-, Abbruch-, Retain-, Replay- und Bereinigungsassertionen bleiben verbindlich. Fachlich gleiche Fixtures werden auf den neuen versionierten Grafikvertrag übertragen, sofern ein Test ausdrücklich die abgelöste Neuausgabe erwartet. Der Plan muss solche notwendigen Migrationen einzeln benennen und begründen; keine pauschale Erlaubnis zum Abschwächen. Legacy-Renderergegenbeispiele bleiben als solche erhalten. Prompt-/Vertragspins ändern sich nur mit der tatsächlichen Revision.

## 11. Verbindliche Qualitätsfälle

| Fall | Positiver / negativer Nachweis |
| --- | --- |
| Leere setup-/loop-Körper aus Screenshot 1 | Keine Kommentar-Aktion und kein erfundenes Programmende. Falls eine korrekte Zusatzgrafik zur konkreten Frage nur die Antwort vorwegnimmt, ist `not-useful` das erwartete Ergebnis. |
| Datentypfrage aus Screenshot 2 | Keine erfundene Klasse aus den globalen Variablen, keine fachfremde Plotterkette. Bei ungeklärtem Variablenbezug kein erfundener Zielbezeichner. |
| Funktionstest aus Screenshot 3 | Keine Umdeutung des Soll-Werts in einen nach der Funktion ausgeführten Schritt; keine bereits beschriftete Begründung für den erfolgreichen Test. Die genaue vorhandene Lehrkraftfrage bleibt unverändert. |
| Kleine echte Verzweigung | Start, konkrete Aktionen, Entscheidungsraute, Guards und korrekte Zusammenführung sichtbar; beide Pfade stimmen mit dem Code überein. |
| Schleife und Arduino-Ablauf | Tatsächliche Rückkante, einmaliger setup-Aufruf und wiederholter loop-Aufruf dort, wo dies der betrachtete Ausschnitt ist; kein falscher Endpunkt. |
| Zwei kleine C++-Klassen | Richtige Namen, Sichtbarkeiten, Attribute, Operationen und gegebenenfalls Vererbungsrichtung; globale Variablen bleiben außerhalb einer erfundenen Klasse. |
| Echte Objektinteraktion | Richtige Beteiligte und Reihenfolge; Aufruf/Rückgabe visuell unterschieden, Selbstaufruf und Aktivierung soweit verwendet korrekt. |
| Gleicher Sketch, andere Frage | Die Relevanzprüfung muss zwischen einer atomaren Faktenfrage und einer grafisch unterstützbaren Ablauf-/Interaktionsfrage unterscheiden können. |
| Angriff im Label oder Bezeichner | Keine PlantUML-Anweisung, kein Dateilesen, kein Netzwerkzugriff, kein aktives SVG; bereinigter Review enthält keinen Credentialrest. |
| Renderer nicht verfügbar / hängt / liefert Fehlerbild | Gültiger Tutortext bleibt nutzbar; feste Gründe, Grenzen und Prozessbereinigung, keine erneute Modell-/Renderschleife. |
| Lange Namen, schmale Spalte, XXL, Themes | Text lesbar; kontrolliertes Scrollen/Vergrößern; kein Abschneiden von Bedeutung oder automatisches Verkleinern auf Minischrift. |
| Retain, Skip, Weiter, Replay, Reset, DEBUG-Epochen | Vorhandene Lebenszyklusgarantien einschließlich zuletzt tatsächlich ausgeliefertem Grafikzustand und verworfenen alten Ereignissen bleiben erhalten. |

Die Screenshots sind Befunde, keine vollständigen Codefixtures. Für Screenshot 3 ist das passende Beispiel lokal gefunden: `UnoSim-Examples/examples/IT08/it08-06-funktion-testen.ino`; der spätere Test übernimmt einen handgeprüften, im Testrepo fixierten Codeausschnitt und die wirkliche Frage. Für Screenshot 2 darf kein nicht sichtbarer Restsketch erfunden werden; ein kontrolliertes Ersatzfixture muss als solches ausgewiesen sein. Keine produktiven Beispiele werden dafür verändert.

## 12. Umsetzungsetappen und Abnahme

**A – Renderer-Eignung zuerst, nach Freigabe dieses Konzepts:** Konkrete PlantUML-Distribution, Version, Java, Layoutengine und Fonts festlegen und pinnen. Je ein eigenes Aktivitäts-, Klassen- und Sequenzbeispiel wirklich rendern und im Tutorbereich prüfen; Sicherheits-/Metadaten- und Ressourcenfälle prüfen. Referenzartefakte mit Herkunft festhalten. Kein bloß gemockter Nachweis für die Renderer-Eignung. Kann der Kandidat das Profil nicht erfüllen, wird vor weiterer Produktintegration berichtet und nicht heimlich auf einen anderen Renderer oder UML-2-Umfang gewechselt.

**B – Geprüfter Diagrammvertrag und fachliche Auswahl:** Typisierte Vorschläge, konservative Codebelege, Relevanz-/Nichtnutzbarkeitsentscheidung und geschlossener Exporter. Kontrollen mit kaputten Gegenbeispielen und positiven Fällen. Frage-/Bewertungslogik bleibt maßgeblich.

**C – Vollständige Einbindung:** Generator, Routen, Support/Replay, Abbruch, Darstellung, Lesbarkeit, Zoom, Diagnose und Review, Konfiguration und Installationspfade. Rendererfehler geben gültige Lerninhalte frei. Beide Modi erfüllen das klassische Profil für frische Grafiken.

**D – Abnahme:** Alle zwölf Qualitätsfälle, echte Renderer-Integration, Providerfakes mit exaktem Callplan, HTTP-Strecken und Browserläufe. Vollständige Units, Typen, Lint, beide Knip-Profile, Dokumentationsprüfung, Build-/Bundlebudget und das konkrete Sonar-Gate. Für das Paket-/Prozessverhalten passende Deployment-/Integrationsnachweise auf den unterstützten Plattformen. Unabhängige Gesamtprüfung; Befunde mit Regressionen beheben.

**E – Getrennte Live-Qualitätsmessung:** Budget bleibt ohne gesonderten Auftrag 0. Vor einem Live-Lauf feste Fälle, Modelle, Wiederholungen, höchstens erlaubte Modell-/Judge-Aufrufe, Rubrik und Berichtsformat vereinbaren. Rubrik: Bezug zur Frage, belegte Fakten, korrekte Diagrammart und Kantenbedeutung, kein Lösungsverrat, Lesbarkeit, sinnvolle Ablehnung sowie Laufzeit/Aufrufzahlen. Eine korrekte Notation oder ein Judgeurteil ersetzt nicht alle übrigen Kriterien.

## 13. Offene Umsetzungsfreiheit und Freigabe

Die Implementierung darf Modulnamen, konkrete JSON-Feldnamen, den konservativen Parser für unterstützte Codeformen und Prozessadapter festlegen. Zusätzliche Parserabhängigkeiten bleiben serverseitig und müssen technisch begründet sein. Versionen und Verpackung des Renderers sind in A konkret zu belegen. UI-Symbolsatz, Lebenszyklus, Grenzen und fehlender fachlicher Nachweis dürfen dabei nicht stillschweigend verändert werden.

Die unabhängige Leseprüfung des Entwurfs stellte zwei notwendige Fragen: Artefaktbudgets samt Replay-Verdrängung und eine mögliche harte Gesamtspeichergrenze. Die obigen Festlegungen beantworten beide als Entscheidungen des Entwurfsautors, nicht als bereits vom Nutzer bestätigte Anforderungen. Begrenzte Zulassung schützt die Replaygarantie; der erste Umfang enthält ausdrücklich nur ein hartes Heaplimit plus begrenzte Last und eine gemessene Prozessbaumspitze, keine neue plattformübergreifende Isolationslaufzeit.

Die Nutzerfreigabe autorisiert die Planung und Umsetzung A–D, einschließlich des beschriebenen Renderer-/Deploymentumfangs und einzeln begründeter Vertragsmigrationen. Sie autorisiert keine echten KI-/Judge-Aufrufe, keinen öffentlichen Renderdienst und keine Veröffentlichung oder Zusammenführung.

## 14. Nachgelesene Primärquellen

Recherche am 2026-11-12; Dokumentationsprüfung, noch kein eigener Rendernachweis:

- [PlantUML Aktivität, bisherige Eingabesyntax](https://plantuml.com/activity-diagram-legacy): Start/Ende, Guards, Verzweigungen; „Legacy“ bezeichnet die Syntax.
- [PlantUML Aktivität, aktuelle Eingabesyntax](https://plantuml.com/activity-diagram-beta): Ablauf-, Entscheidungs- und Schleifenunterstützung; die Eingabesyntax entscheidet nicht allein über das vereinbarte Profil.
- [PlantUML Klassen](https://plantuml.com/class-diagram) und [Sequenzen](https://plantuml.com/sequence-diagram): vorhandene Diagrammarten; `strictuml` ist insbesondere eine Darstellungsoption für Sequenzpfeile.
- [Sicherheitsprofile](https://plantuml.com/security): `SANDBOX` verbietet inhaltsgesteuerte lokale und URL-Zugriffe; keine Gleichsetzung mit Betriebssystem-Prozessisolation.
- [Kommandozeile](https://plantuml.com/command-line): Standard-Ein-/Ausgabe und ausdrückliches Abschalten eingebetteter Quellenmetadaten.
- [Distributionen](https://plantuml.com/download) und [Laufzeit-/Layoutfragen](https://plantuml.com/faq): unterschiedliche Artefakte/Lizenzen und konkrete Graphviz-/Fontabhängigkeiten; die tatsächlich ausgewählte Kombination ist zu prüfen.
