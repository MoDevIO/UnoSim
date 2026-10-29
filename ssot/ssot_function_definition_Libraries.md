# Funktionsdefinition: Projektbezogene Bibliotheken

Status: current

Zielrolle: feature-contract

Umsetzungsstand: erste Ausbaustufe umgesetzt (2026-10-28), siehe Abschnitt 16

Stand: 2026-10-28

Ziel-SSOT für den kuratierten Bibliothekskatalog, die Bibliotheksauswahl eines
Projekts, die Einbindung im Quelltext und die reproduzierbare Bereitstellung
beim Kompilieren. AUnit ist der erste konkrete Anwendungsfall.

`current` bezeichnet den aktuellen Fachvertrag. Die Regeln dieses Dokuments
beschreiben den Zielzustand; Abschnitt 16 nennt die Umsetzung der ersten
Ausbaustufe und ihre Nachweise. Die bestätigte
klickbare Skizze ist ein Bedienungsentwurf und kein Nachweis einer bereits
vorhandenen Bibliotheksunterstützung. Ein `verified`-Status setzt gesonderte
Compile- und Laufzeitnachweise voraus.

## 1. Ziel und gewählter Ansatz

Studierende SOLLEN eine verfügbare Arduino-Bibliothek finden, ihrem eigenen
Projekt hinzufügen und über eine normale Include-Zeile verwenden können.
Bibliotheksversionen und Abhängigkeiten MÜSSEN im aktiven Sitzungszustand,
beim Laden von Beispielen und beim Kompilieren erhalten bleiben. Die Bedienung
erfordert keine manuelle Bearbeitung einer Projektkonfiguration.

Am 2026-10-28 wurde Variante 2 gewählt und der zugehörige Bedienungsentwurf
bestätigt:

| Ansatz | Abwägung | Entscheidung |
| --- | --- | --- |
| AUnit fest und implizit mitliefern | Kleiner Einstieg, aber ohne ausdrückliche Projektabhängigkeit | Nicht gewählt |
| Kuratierter Katalog mit Auswahl je Projekt | Überschaubares Angebot, feste Versionen, gezielte Kompatibilitätsprüfung | Gewählt |
| Freier Bibliotheksmanager mit GitHub- und ZIP-Import | Größere Auswahl, zusätzlicher Aufwand für Auflösung und Betrieb | Spätere Erweiterung |

Die erste Ausbaustufe umfasst AUnit, den Katalog, die Bibliotheksauswahl im
flüchtigen Zustand des geöffneten Sketches und die beschriebenen
Bedienabläufe. Projekt-Persistenz, vollständiger Projekt-Import/-Export und
das Laden eines Beispielzustands in einem neuen Browser-Tab sind ausdrücklich
spätere Erweiterungen. Beim vorhandenen Datei-Download wird auf die fehlenden
Bibliotheksangaben hingewiesen; ein Minimalbeispiel ersetzt den aktuellen
Sketch erst nach Bestätigung (Abschnitt 8).

Servo und LiquidCrystal waren ausschließlich unverbindliche Katalogbeispiele
der Skizze. Ihre Aufnahme
und ihre Simulationsunterstützung sind damit nicht zugesagt.

## 2. Zuständigkeiten und fachliche Quellen

Es gelten drei getrennte, miteinander verknüpfte Zustände:

1. Der vom Betrieb ausgelieferte Katalog bestimmt, welche Pakete und Versionen
   angeboten und bereitgestellt werden.
2. Die Projektkonfiguration enthält die ausdrücklich ausgewählten
   Bibliotheken mit konkreten Versionen.
3. Der serverseitig aufgelöste Build enthält diese Auswahl und ihre
   vollständigen transitiven Abhängigkeiten mit überprüfter Paketidentität.

Der Browser DARF den serverseitigen Katalog weder erweitern noch installieren.
Der Server DARF die Auswahl eines Projekts nicht als globale Auswahl für
andere Projekte oder Nutzer behandeln. Ein Include im Quelltext ist ein
Verwendungshinweis, aber kein Ersatz für die festgelegte Projektversion.

Weitere fachliche Grenzen:

- Boards und angebotene Laufzeiten folgen der
  [Boards-SSOT](ssot_function_definition_Boards.md).
- Ausführung, Zeitmodell und bestehende Laufsteuerung folgen der
  [SimulationRuntime-SSOT](ssot_function_definition_SimulationRuntime.md).
- Serielle Ausgabe folgt der
  [SerialOutput-SSOT](ssot_function_definition_SerialOutput.md).
- Quellenwahl und Laden externer Beispiele folgen der
  [ExternalExamples-SSOT](ssot_function_definition_ExternalExamples.md).
  Dieses Dokument ergänzt dafür die projektbezogenen Bibliotheksangaben.
- Die Compile-Grenze und die Identität des Flash-Artefakts folgen dem
  [Sicherheitsvertrag](../docs/SECURITY.md) und
  [ADR 0010](../docs/adr/0010-compile-sandbox-and-flash-artifact.md).
- Die statische I/O-Analyse folgt der
  [I/O-Registry-SSOT](ssot_function_definition_IoRegistry.md). Sie verspricht
  keine vollständige Analyse fremder Bibliotheksimplementierungen.

## 3. Kuratierter Katalog und Versionen

Die Paketmetadaten bauen auf dem Arduino-Bibliotheksformat
`library.properties` auf. UnoSim ergänzt Angaben für das eigene Angebot und
die geprüfte Simulation. Eine zentrale Definition MUSS Clientdarstellung,
serverseitige Auflösung und Bereitstellung miteinander verbinden; eine
unabhängige handgepflegte Bibliotheksliste im Frontend ist unzulässig.

Jede angebotene Paketversion enthält fachlich mindestens:

| Angabe | Bedeutung |
| --- | --- |
| Kanonischer Name | Eindeutiger Paketname, unabhängig vom Dateinamen des Headers |
| Exakte Version | Konkrete Paketversion, kein beweglicher Branch oder `latest` |
| Beschreibung und Autor | Informationen für die Auswahl durch Studierende |
| Öffentliche Header | Zuordnung bekannter Includes zum Paket |
| Standard-Includes | Die beim Einbinden einzufügenden Include-Zeilen |
| Abhängigkeiten | Vollständig auf feste Paketversionen aufgelöste Abhängigkeiten |
| Integrität | SHA-256 der fest bereitgestellten Paketquelle beziehungsweise ihres unveränderlichen Archivs |
| Dokumentation und Lizenz | Herkunft und Nutzungsinformationen des Pakets |
| Beispiele | Zugeordnete eingebaute Beispielprojekte mit ihrem Hauptdateipfad nach Abschnitt 8.2 |
| Kompatibilität | Getrennte Compile- und Laufzeitaussagen nach Abschnitt 9 |

In der ersten Ausbaustufe bietet der Katalog je Bibliothek eine kuratierte
Version an. Ein allgemeiner Versionsauswahldialog und ein interaktiver
Versionskonfliktlöser sind nicht erforderlich. Das Datenmodell behält die
Version trotzdem ausdrücklich bei.

Die Identität aus Name und Version bindet unveränderlich die Paketquelle,
deren Integrität und den kuratierten Abhängigkeitsgraphen. Derselbe Paketstand
darf in späteren Bereitstellungen nicht unter derselben Identität durch andere
Inhalte oder eine andere Abhängigkeitsauflösung ersetzt werden. Zusätzliche
Kompatibilitätsnachweise dürfen die Beschreibung desselben Paketstands
ergänzen.

Ein Katalogupdate DARF eine bereits festgelegte Projektversion nicht
automatisch ändern. Ist die benötigte Version auf einem anderen Deployment
nicht vorhanden, bleibt die Anforderung erhalten und wird als nicht verfügbar
angezeigt. Ein Ersatz durch eine andere Version ist kein erfolgreicher Load
oder Build derselben Anforderung.

## 4. Bibliotheksauswahl des Projekts

Der gemeinsame fachliche Vertrag für den aktiven Projektzustand, Beispiele
und Compile-Snapshot ist eine Liste direkter Abhängigkeiten:

```json
{
  "libraries": [
    { "name": "AUnit", "version": "1.7.1" }
  ]
}
```

Dies ist der Bibliotheksanteil der Projektmetadaten. Der Ausschnitt legt weder
einen neuen vollständigen Projektdateivertrag noch einen bereits vorhandenen
API-Vertrag nahe. Die konkreten Transportformate werden bei der Umsetzung
festgelegt; sie MÜSSEN diesen fachlichen Inhalt verlustfrei tragen. Ein
persistentes Projekt- oder Exportformat ist keine Voraussetzung der ersten
Ausbaustufe; dafür gilt ausschließlich die spätere Erweiterung in Abschnitt 8.4.

Es gelten folgende Regeln:

- Fehlende Bibliotheksangaben eines geladenen Sketches oder Beispiels bedeuten
  eine leere Auswahl. Reine Header-Ergänzungen behalten die bisherige Auswahl
  bei (Abschnitt 8.1).
- Ein Name DARF im Projekt nur einmal mit einer Version vorkommen.
- Sternchen, Versionsbereiche und unversionierte Anforderungen sind keine
  festgelegte Projektversion.
- Die Reihenfolge der Auswahl beeinflusst weder die Auflösung noch die
  Build-Identität. Die Darstellung DARF stabil nach Namen sortieren.
- Transitive Abhängigkeiten werden aus dem kuratierten Paketgraphen bestimmt;
  sie sind keine zweite, unabhängig bearbeitbare Projektauswahl.
- Bibliotheksquelltext wird weder in die eigenen Editor-Tabs kopiert noch
  beim Einbinden in den eigenen Quelltext hineinkopiert.
- Löschen einer Include-Zeile entfernt nicht automatisch die zugehörige
  Projektabhängigkeit. Eine ausgewählte, derzeit ungenutzte Bibliothek ist
  zulässig.

In der ersten Ausbaustufe gehören Hinzufügen, erneutes Einfügen des Includes
und unmittelbares Rückgängigmachen zur Bedienung. Ein allgemeiner
Entfernen- oder Versionswechsel-Dialog war nicht Teil des abgestimmten
Screens und bleibt eine spätere Erweiterung.

## 5. Aufruf und Bibliotheksdialog

### 5.1 Einstieg

Der Dialog MUSS über **Sketch → Libraries…** aufrufbar sein. Zusätzlich MUSS
das Optionsmenü der Dateitabs (⋮) einen Eintrag **Libraries (n)** enthalten,
der denselben Dialog öffnet. Die Tab-Leiste selbst erhält dafür keinen
eigenen Button (Änderung vom 2026-10-28). `n` zählt die direkt ausgewählten Bibliotheken des aktuellen Projekts,
einschließlich einer angeforderten, auf diesem Deployment fehlenden Version.
Transitive Abhängigkeiten erhöhen diese Zahl nicht.

Öffnen, Schließen, Suchen und Wechseln der Katalogansicht verändern weder
Quelltext noch Bibliotheksauswahl. Es startet dadurch keine Kompilierung.

### 5.2 Inhalt

Der Dialog zeigt das aktuelle Board und die gewählte Laufzeit als Kontext.
Er enthält eine Suche sowie die Ansichten **Verfügbar** und **Im Projekt**:

- **Verfügbar** zeigt das vom Server angebotene Bibliotheksangebot.
- **Im Projekt** zeigt die ausdrückliche Auswahl und ihre festgelegten
  Versionen. Fehlende Versionen bleiben hier sichtbar.
- Die Suche berücksichtigt mindestens Name und Kurzbeschreibung und filtert
  die aktuell gewählte Ansicht.
- Eine leere Projektauswahl, keine Suchtreffer, ein leerer Katalog, Laden und
  ein Abruffehler sind unterschiedliche, ausdrücklich benannte Zustände.
- Ein Abruffehler löscht keine Projektabhängigkeiten. Der Dialog bietet einen
  manuellen erneuten Abruf an.
- Eine gewählte Bibliothek bleibt beim Wechsel der Ansicht gewählt, sofern
  die andere Ansicht sie ebenfalls listet.
- Ein Listeneintrag zeigt nur genau die ausgewählte Version als **Im
  Projekt**; ist eine andere Version desselben Pakets ausgewählt, lautet der
  Status **Andere Version im Projekt**.

Ein ausgewählter Eintrag zeigt Name, Version, Beschreibung, Autor,
Standard-Include, Dokumentation, verfügbare Beispiele und den Projektstatus.
Vom Kompatibilitätsstatus erscheint nur ein ausdrückliches **nicht
unterstützt** für das aktuelle Board beziehungsweise die gewählte Engine,
mit Begründung; `verified` und `untested` werden im Dialog nicht angezeigt
(Vereinfachung vom 2026-10-28). Solange keine Bibliothek gewählt ist, bleibt
der Detailbereich leer. Direkte Abhängigkeiten sind als **Im Projekt**
erkennbar. Technische Paketpfade und Installationsschritte sind keine
Bedienaufgabe für Studierende.

Die Detailansicht bietet **Einbinden** oder, bei bereits ausgewählter
Bibliothek ohne Include in der aktiven Datei, **Include einfügen**. Ist die
Version ausgewählt und das Include dort vorhanden, zeigt sie den erreichten
Zustand **✓ Bereits eingebunden** als Status, nicht als Schaltfläche; es
entsteht keine doppelte Änderung. Diese Aktion steht als Hauptaktion an
fester Stelle direkt unter Name und Autor, darunter die **Zieldatei** mit
ihrem Dateinamen; der vollständige Pfad lässt sich bei Dateien in Ordnern
aufklappen. **Minimalbeispiel öffnen** ist eine sekundäre Aktion am Ende der
Details.

Fehlt die angeforderte Version auf diesem Deployment, zeigt **Im Projekt**
Name, angeforderte Version und **Nicht verfügbar** mit Begründung. Für diesen
Eintrag werden **Einbinden** und **Include einfügen** nicht angeboten. Eine
andere verfügbare Version wird weder als Ersatz aktiviert noch als bereits
eingebunden dargestellt.

### 5.3 Darstellung und Bedienbarkeit

Die Umsetzung verwendet die gemeinsamen Dialog-, Tab-, Toolbar-, Input- und
Scroll-Komponenten sowie die semantischen Tokens aus
[STYLE_GUIDE.md](../client/src/STYLE_GUIDE.md) und der
[Typografie-SSOT](ssot_function_definition_Typography.md). Die eigenständige
HTML/CSS-Skizze ist keine alternative Komponentenarchitektur.

Suche, Auswahl, Einbinden und Schließen MÜSSEN per Tastatur erreichbar sein.
Der Dialog besitzt eine zugängliche Beschriftung und ein geregeltes
Fokusverhalten: Nach dem Schließen kehrt der Fokus zum auslösenden
Bedienelement zurück (bei einem Menüeintrag zu dessen Menü), nach
**Einbinden** in den Editor. Die Ansichts-Tabs sind ihren Inhaltsbereichen
zugänglich zugeordnet. Die Dialoghöhe ist fest, damit sich Suche und Listen
beim Suchen und Auswählen nicht verschieben. Auf schmalen Bildschirmen
stehen Katalog und Details untereinander; Inhalte und Aktionen müssen
erreichbar bleiben. Namen, Status und Beispieltitel brechen auch bei großer
Schrift um und werden nicht abgeschnitten.

## 6. Aktion „Einbinden“

**Ausgangszustand:** Ein Projekt und eine bearbeitbare Quelldatei sind offen;
eine angebotene Bibliotheksversion ist im Dialog ausgewählt.

**Trigger:** Die studierende Person wählt **Einbinden**.

**Ergebnis:**

1. UnoSim validiert Paketversion und den benötigten Abhängigkeitsgraphen.
2. Die exakte Version wird in die direkten Projektabhängigkeiten aufgenommen.
3. Die Standard-Includes werden in die aktive Quelldatei eingefügt. Für AUnit:

   ```cpp
   #include <AUnit.h>
   ```

4. Der Dialog schließt. Ein sichtbarer Hinweis nennt Paketversion und
   betroffene Datei. Die Änderung ist unmittelbar im Editor sichtbar.

Metadatenänderung und Einfügen sind eine zusammengehörige Aktion. Schlägt die
Validierung oder die Bearbeitung fehl, dürfen keine Teiländerungen entstehen.
Während einer asynchronen Prüfung dürfen weder ein inzwischen anderes
Projekt noch spätere manuelle Änderungen mit einem alten Snapshot
überschrieben werden.

Für das Einfügen gilt:

- Ziel ist die bei Auslösen der Aktion aktive, bearbeitbare Quelldatei,
  einschließlich eines eigenen Headers. Fehlt ein geeignetes Ziel, ist
  Einbinden mit einer verständlichen Begründung nicht ausführbar.
- Neue Includes stehen im Include-Bereich am Dateianfang, hinter bereits
  vorhandenen Includes. Vorhandene Dateikopfkommentare und Header-Guards
  bleiben sinnvoll erhalten; Quelltext wird nicht vollständig neu formatiert.
- Eine vorhandene gleichwertige Include-Direktive wird nicht verdoppelt.
  Whitespace sowie `#include "AUnit.h"` und `#include <AUnit.h>` werden unter
  Beachtung der lokalen Headerauflösung berücksichtigt. Auskommentierte
  Zeilen zählen nicht als vorhandenes Include.
- `using namespace`, Testfunktionen sowie Änderungen an `setup()` oder
  `loop()` werden durch Einbinden nicht automatisch ergänzt.
- Die Änderung am Quelltext ist eine regulär rückgängig machbare
  Editoränderung. Die unmittelbare Aktion **Rückgängig** aus dem Hinweis
  entfernt die durch diese Aktion eingefügten Include-Zeilen und nimmt eine
  durch genau diese Aktion neu hinzugefügte direkte Abhängigkeit zurück.
  Bereits vorher ausgewählte Pakete und vorhandene Includes bleiben erhalten.
- Diese gemeinsame Rückgängig-Aktion ist nur verfügbar, solange seitdem keine
  weitere Quelltext- oder Projektänderung stattgefunden hat. Ab der nächsten
  Bearbeitung, dem nächsten Bibliothekswechsel oder einem Wechsel des
  Projekt-/Board-/Enginekontexts wird sie entfernt beziehungsweise deaktiviert.
  Eine bereits ausgelöste, inzwischen überholte Aktion darf ebenfalls nichts
  mehr zurückschreiben. Damit wird kein älterer Gesamtsnapshot über neue
  Eingaben gelegt.
- Das Entfernen eines Includes über die normale Editorhistorie allein löscht
  keine Projektabhängigkeit. Diese Editorhistorie bleibt auch dann bedienbar,
  wenn die gemeinsame Rückgängig-Aktion nicht mehr angeboten wird.

Die erneute Einbindung derselben Version ist idempotent. **Include einfügen**
ergänzt nur die aktive Datei und ändert keine bereits festgelegte Version.

## 7. Manuell geschriebene oder kopierte Includes

Wird ein bekannter Bibliotheksheader verwendet, ohne dass das Projekt eine
zugehörige direkte oder transitive Abhängigkeit besitzt, SOLL UnoSim einen
Hinweis mit einer Aktion zum Hinzufügen anbieten, zum Beispiel:

> AUnit.h erkannt. AUnit fehlt noch in den Projektbibliotheken.

Die Aktion nennt die konkrete Version, etwa **AUnit 1.7.1 hinzufügen**. Sie
registriert diese Projektabhängigkeit und erhält die vorhandene Include-Zeile.
Bloßes Tippen oder Einfügen von Quelltext installiert kein Paket, ändert keine
Metadaten und wählt keine Version ohne ausdrückliche Aktion aus.

Der Hinweis ist eine Hilfestellung für bekannte literale Includes, kein
vollständiger C++-Präprozessor. Maßgeblich für den tatsächlichen Build bleibt
die Toolchain. Insbesondere gilt:

- Eigene lokal auflösbare Header haben bei zitierten Includes Vorrang und
  werden nicht als fehlende Bibliothek umgedeutet.
- Header aus Core und Standard-Toolchain erfordern keine zusätzliche
  Projektbibliothek.
- Header einer bereits transitiv aufgelösten Bibliothek sind bewusst ohne
  weiteren Hinweis verwendbar. Ein direktes Include befördert das Paket nicht
  automatisch zu einer direkten Projektabhängigkeit und erhöht die Anzahl
  **Libraries (n)** nicht. Die Bindung ist durch den unveränderlichen
  Abhängigkeitsgraphen der direkten Auswahl festgelegt. Fällt die transitive
  Abhängigkeit durch eine spätere ausdrückliche Auswahländerung weg, wird der
  fehlende Header wieder wie eine fehlende Bibliothek behandelt.
- Können mehrere Katalogpakete denselben Header bereitstellen, wird keines
  automatisch gewählt. UnoSim bietet eine ausdrückliche Paketauswahl an.
- Unbekannte Header lösen keinen Downloadversuch und keine Vermutung über
  eine GitHub- oder ZIP-Quelle aus.
- Ein fehlender ausgewählter Header bleibt ein verständlicher Buildfehler;
  die Bibliothek wird nicht still aus einer fremden lokalen Installation
  ergänzt.

## 8. Sitzungszustand, Datei-Download und Beispiele

### 8.1 Erste Ausbaustufe und bestehender Dateiumgang

Der aktuelle Code hält die eigenen Quelltextdateien im flüchtigen
Clientzustand. Einstellungen in `localStorage` sind keine Projekt-Persistenz.
[Download all files](../client/src/hooks/use-file-manager.ts) lädt die Tabs als
einzelne Dateien herunter; der Dateilader akzeptiert `.ino` und `.h`.
Vollständigen Projekt-Import/-Export und die Wiederherstellung eines Projekts
nach einem Browserneustart gibt es derzeit nicht.

Die erste Ausbaustufe ergänzt die Bibliotheksauswahl im aktiven Zustand
desselben Sketches. Sie wird zusammen mit dessen Dateien für Compile-Snapshots
verwendet, aber nicht unabhängig davon als globale Browserpräferenz
gespeichert. Ein Reload stellt weder den bearbeiteten Sketch noch dessen
Auswahl wieder her. Projekt-Persistenz und ein neues Projektdateiformat sind
kein Teil dieses Features.

**Download all files** bleibt ein Quelltext-Download. Sind direkte
Projektbibliotheken ausgewählt, MUSS vor oder beim Download sichtbar sein:

> Der Download enthält nur Quelltextdateien. Bibliotheksauswahl und Versionen
> sind nicht enthalten und müssen beim erneuten Laden wieder hinzugefügt werden.

Der Hinweis nennt die direkten Paketnamen und exakten Versionen in kopierbarer
Form, etwa **AUnit 1.7.1**. Es wird keine verlustfreie Projektübertragung
zugesagt und keine Metadatendatei als verstecktes zusätzliches Downloadformat
eingeführt.

Beim Ersetzen eines Sketches durch geladene `.ino`-/`.h`-Dateien beginnt die
Bibliotheksauswahl leer. Includes können anschließend den Hinweis aus
Abschnitt 7 auslösen; aus ihnen wird keine Version still rekonstruiert. Werden
nur eigene Header zum bestehenden Sketch hinzugefügt, bleibt dessen Auswahl
erhalten.

### 8.2 Beispiele und Minimalbeispiel im aktuellen Tab

Eingebaute und externe Beispiele verwenden dasselbe Datenmodell direkter
Abhängigkeiten. Externe Beispiele erhalten die Angaben aus dem v2-Manifest
nach Abschnitt 8.3. Eingebaute Paketbeispiele erhalten sie aus der Zuordnung
im zentralen Bibliothekskatalog:

- Das Feld **Beispiele** eines Paketstands referenziert die Hauptdatei des
  eingebauten Beispiels über ihren normalisierten relativen Pfad unter
  `public/examples`. Die konkrete Ablage der Katalogdefinition ist Teil der
  Umsetzung; eine zusätzliche Begleitdatei je Beispiel ist nicht erforderlich.
- Ein zugeordnetes Beispiel erhält den kanonischen Namen und die exakte
  Version dieses Paketstands automatisch als direkte Abhängigkeit. Das dem
  Paket **AUnit 1.7.1** zugeordnete Minimalbeispiel erhält damit
  `libraries: [{ "name": "AUnit", "version": "1.7.1" }]`.
- Die Zuordnung MUSS auf einen sicheren Pfad, ein vorhandenes eingebautes
  Beispiel und genau einen Paketstand geprüft werden. Mehrdeutige oder
  ungültige Zuordnungen dürfen nicht still als leere Auswahl behandelt werden.
- Der `BuiltInProvider` beziehungsweise die gemeinsame Aufbereitung seiner
  Einträge MUSS diese Zuordnung in das normale `libraries`-Feld überführen.
  Katalog- und Detailantwort sowie der aktive Projektzustand erhalten diese
  Liste unverändert. Das gilt sowohl beim Aufruf aus dem allgemeinen
  Beispiele-Menü als auch bei **Minimalbeispiel öffnen** im Bibliotheksdialog.
- Die Ableitung erfolgt aus der Katalogdefinition, unabhängig davon, ob das
  Paket tatsächlich bereitgestellt ist. Bei fehlender Paketversion bleibt
  die Anforderung sichtbar. Die Oberfläche erfindet keine eigene
  Bibliotheksauswahl und leitet sie nicht aus dem Beispielquelltext ab.
- Nicht zugeordnete eingebaute Beispiele haben eine leere Bibliotheksauswahl.
  Der heutige Verzeichnisscan allein enthält diese Metadaten nicht; die
  beschriebene Anreicherung ist Teil der ersten Ausbaustufe.

Der Weg von der jeweiligen Metadatenquelle über Katalog und Detailantwort bis
zum aktiven Projektzustand MUSS die Angaben erhalten. Ein Beispiel ohne
Bibliotheksangaben übernimmt keine Auswahl des zuvor geöffneten Sketches.
Ungültige Angaben dürfen den bisherigen Zustand nicht teilweise ersetzen.
Eine gültige Anforderung einer auf diesem Deployment fehlenden Version bleibt
beim Anzeigen des Beispiels erhalten; der Eintrag ist nicht verfügbar und der
Build scheitert nachvollziehbar, statt eine andere Version zu verwenden.

**Minimalbeispiel öffnen** lädt das Beispiel in der ersten Ausbaustufe in den
aktuellen Browser-Tab. Vor dem Ersetzen fragt UnoSim ausdrücklich, ob die
aktuellen Dateien und die Bibliotheksauswahl durch das Beispiel ersetzt werden
sollen, und bietet **Ersetzen** und **Abbrechen** an. Diese Rückfrage ist Teil
des neuen Bibliotheks-Einstiegs; sie wird nicht als bereits vorhandenes
Verhalten aller bisherigen Beispielaufrufe vorausgesetzt.

Abbrechen erhält Dateien, Bibliotheksauswahl und einen laufenden Sketch.
Erst nach bestätigtem Ersetzen werden die Beispieldateien und ihre direkte
Bibliotheksauswahl zusammen aktiviert. Dabei wird ein laufender Sketch über
den bestehenden Ersetzen-/Stop-Lebenszyklus beendet. Lade- oder
Validierungsfehler erhalten den bisherigen Zustand. Die Bestätigung gilt für
den Sketch, wie er beim Bestätigen war: Ändern sich Dateien oder
Bibliotheksauswahl, während das Beispiel noch lädt, bleiben diese Änderungen
erhalten und das Beispiel wird nicht übernommen. Während des Ladens zeigt
UnoSim **Beispiel wird geladen …**. Ein Beispiel mit eigenem
`setup()` und `loop()` wird nicht als weitere `.ino`-Datei ergänzt und nicht
automatisch gestartet.

Es werden weder ein neuer Browser-Tab noch eine zusätzliche WebSocket-Sitzung
oder ein zusätzlicher Simulationsplatz angelegt. Beispiel-Deep-Links und die
Übertragung von Projektzustand an einen neuen Tab sind keine Voraussetzung
dieser Ausbaustufe.

### 8.3 Manifestversion und Grenze älterer Server

Die Garantien zum Erhalt von Bibliotheksangaben gelten für die neue
Implementierung. Bereits ausgelieferte Server können nicht nachträglich dazu
verpflichtet werden, unbekannte Felder zu erhalten. Insbesondere entfernt das
heutige v1-`manifestExampleSchema` ein unbekanntes `libraries`-Feld still.
Ein solches v1-Manifest ist deshalb kein verlässliches Austauschformat für
Bibliotheksanforderungen.

Bibliotheksangaben externer Beispiele MÜSSEN die bereits vorhandene
Root-Manifestversion **`schemaVersion: 2`** verwenden. Die erste Ausbaustufe
erweitert deren striktes Beispieleintrag-Schema um das optionale Feld
`libraries` mit der Liste aus Abschnitt 4. Der optionale Tutor-Deskriptor von
v2 bleibt davon unabhängig. Bibliotheksangaben gehören zur validierten
Examples-Capability, nicht zu einem optional verwerfbaren Tutor-Zusatz.

Für diese Erweiterung gilt:

- Neue Server lehnen ein in einem v1-Beispieleintrag vorhandenes
  `libraries`-Feld ausdrücklich ab, statt es zu entfernen. Die Prüfung muss
  vor dem verwerfenden v1-Parsing stattfinden.
- Bestehende v1- und v2-Manifeste ohne `libraries` bleiben gültig und bedeuten
  eine leere Auswahl je entsprechendem Beispiel.
- Die Bibliotheksliste und ihre Einträge werden strikt validiert. Fehlende
  Paketversionen sind von strukturell ungültigen Anforderungen zu
  unterscheiden; nur letztere machen die Examples-Capability ungültig.
- Ein alter v1-only-Loader lehnt das v2-Manifest ab. Der heute vorhandene
  v2-Loader lehnt `libraries` wegen seiner strikten Beispieleinträge ebenfalls
  ab. Diese vorhandenen Leser laden damit keinen scheinbar vollständigen
  Snapshot mit verworfenen Bibliotheksangaben.
- Für ein entgegen diesem Vertrag als v1 veröffentlichtes Bibliotheksbeispiel
  bleibt das stille Verwerfen durch alte v1-Server eine ausdrücklich bekannte
  Grenze. Auch unbekannte historische Implementierungen erhalten keine
  pauschale Kompatibilitätszusage.
- Die bestehenden LKG-Regeln gelten weiter. Ein alter Server darf bei
  Ablehnung einer neuen Revision seinen bisherigen Snapshot als `stale`
  anzeigen; das ist kein erfolgreicher Load der neuen Bibliotheksrevision.

Diese Ergänzung muss bei Umsetzung mit
[ExternalExamples](ssot_function_definition_ExternalExamples.md) und
[CourseContent](ssot_function_definition_CourseContent.md) konsistent
eingeführt werden. Eine neue Root-Version 3 ist für die beschriebenen heutigen
strikten v2-Leser nicht erforderlich.

### 8.4 Spätere Erweiterung: persistente und übertragbare Projekte

Sobald Projekt-Persistenz oder vollständiger Projekt-Import/-Export als
separates Feature eingeführt werden, MÜSSEN sie Dateien und direkte
Bibliotheksanforderungen gemeinsam in einem versionierten, validierten Format
erhalten. Ein vollständiger Roundtrip erhält Namen und Versionen exakt.
Ungültige Daten dürfen das vorhandene Projekt nicht teilweise überschreiben;
auf einem Zielsystem fehlende Versionen bleiben als solche sichtbar.

Diese künftigen Anforderungen sind keine Abnahmekriterien der ersten
Ausbaustufe und keine Migration einer bereits existierenden
Projekt-Persistenz. Ein Beispiel in einem neuen Browser-Tab würde zusätzlich
einen definierten Lade-/Deep-Link-Mechanismus und getrennte Projektzustände
benötigen und bleibt ebenfalls ein eigenes Feature.

## 9. Kompatibilität: Kompilierung und Simulation

Das Vorhandensein eines Headers und die erfolgreiche Kompilierung bedeuten
nicht, dass eine benötigte externe Hardware simuliert wird.

Der Katalog unterscheidet:

| Ebene | Bezugsrahmen | Aussage |
| --- | --- | --- |
| Kompilierung | Paketversion, Board und gepinnte Toolchain | Der Bibliothekscode lässt sich für dieses Ziel bauen |
| Laufzeit | Paketversion, Board, Simulationsengine und benötigte Modelle | Der geprüfte Funktionsumfang lässt sich in dieser Simulation verwenden |

Für beide Ebenen werden **geprüft** (`verified`), **ungeprüft** (`untested`)
oder **nicht unterstützt** (`unsupported`) mit einer verständlichen
Begründung unterschieden. Fehlende Prüfdaten bedeuten `untested`, nicht
`verified` oder eine behauptete Hardwareunfähigkeit.

- `untested` bleibt als Hinweis sichtbar und verhindert allein keinen
  Versuch, zu kompilieren oder die angebotene Simulation zu starten.
- Ein ausdrücklich nicht unterstütztes Compile-Ziel wird mit einer
  verständlichen Diagnose abgewiesen.
- Bei `unsupported` auf Laufzeitebene ist der Simulationsstart gesperrt, auch
  wenn die Kompilierung für das Board erfolgreich war. Die Sperre gilt für
  alle Startwege einschließlich **Compile/Upload**; eine Warnungsbestätigung
  hebt sie nicht auf. Die Oberfläche nennt den Grund und gegebenenfalls eine
  angebotene passende Engine. Sie wechselt die Engine nicht automatisch.
- Ein Board- oder Enginewechsel aktualisiert die Aussagen, ohne die
  Projektbibliotheken zu löschen oder umzuversionieren.
- Bibliotheken für Sensoren, Displays oder Busgeräte versprechen ohne
  entsprechendes Modell keine funktionsfähige Gerätesimulation.
- Der Host-Mock ist separat zu prüfen. AVR-Unterstützung im Browser belegt
  keine Unterstützung des nativen Legacy-Builds.

## 10. Bereitstellung und Kompilierung

Paketquellen und ihr vollständiger fester Abhängigkeitsgraph werden vor dem
Benutzer-Compile bereitgestellt. Im Docker-Profil geschieht dies beim Bau des
Compile-Images. Die lokale Entwicklung verwendet dieselben Paketversionen
und Integritätsangaben über einen reproduzierbaren Bereitstellungsschritt.
Ein allgemeiner Installationsdialog für Studierende ist nicht vorgesehen.

Während einer Kompilierung gibt es keine Paketdownloads, Installation oder
Änderung eines globalen Sketchbooks. Die bestehenden Grenzen der
Compile-Sandbox, einschließlich des fehlenden Netzwerks, bleiben wirksam.

Der Server MUSS:

1. Alle direkten Anforderungen gegen den angebotenen Paketbestand validieren.
2. Den vollständigen festen Abhängigkeitsgraphen auflösen und prüfen.
3. Fehlende Versionen, inkompatible Versionserfordernisse, ungültige Graphen
   und Integritätsfehler vor einem erfolgreichen Build verständlich melden.
4. Der Arduino-Toolchain die vollständigen benötigten Pakete einschließlich
   ihrer `.cpp`-Implementierungen über kontrollierte Bibliothekspfade
   bereitstellen.
5. Die sichtbaren Bibliotheksquellen auf diese Auflösung und die regulären
   Core-/Toolchain-Bibliotheken begrenzen. Zufällig auf dem Host installierte
   Bibliotheken dürfen einen Build nicht beeinflussen.

`arduino-cli compile --library` ergänzt Suchpfade, isoliert aber nicht das
globale Sketchbook. Der Compile-Aufruf MUSS deshalb ein eigenes,
serverkontrolliertes, leeres `directories.user` oder eine nachweislich
gleichwertige isolierte Konfiguration verwenden. Paketpfade werden
ausdrücklich hinzugefügt; auch weitere globale beziehungsweise eingebaute
Bibliothekssuchpfade bleiben auf den kontrollierten Toolchain-Bestand
beschränkt. Hostprofil und Compile-Sandbox müssen beide diese Grenze
einhalten. Die konkrete Config-/Umgebungsübergabe wird im Umsetzungsplan
festgelegt und mit einem zusätzlichen, nicht ausgewählten Hostpaket geprüft.

Der Client übermittelt Paketidentitäten und Versionen, keine frei wählbaren
Dateisystempfade, Download-URLs oder Compilerargumente. Der bestehende
Include-Schutz wird nicht für beliebige Hostpfade geöffnet.

Bei fehlender oder mehrdeutiger Paketauflösung darf die Toolchain nicht
unbemerkt eine andere gleichnamige Bibliothek wählen. Diagnosen sollen den
Paketnamen, die Version und bei Bedarf die Bibliotheksdatei benennen, ohne
interne Host- oder Containerpfade offenzulegen.

## 11. Build-Identität und laufende Compile-Vorgänge

Die Build-Identität MUSS neben Quelltext, Board, Core, Compiler, Buildoptionen
und Artefaktformat die kanonisch sortierte direkte Auswahl sowie den
vollständig aufgelösten Paketbestand mit Versionen und Integritätsangaben
berücksichtigen. Die Fingerprint-Liste beliebiger global installierter
Bibliotheken ist dafür kein Ersatz.

Diese Identität gilt für Worker-Aufträge, Compile-Ergebnisse, Artefakte und
alle vorgeschalteten sowie persistenten Caches. Unterschiedliche Versionen
oder Paketinhalte dürfen keinen identischen Cachetreffer erzeugen. Eine
unbeteiligte Ergänzung des Katalogs ändert nicht die effektive
Bibliotheksauflösung eines bestehenden Projekts.

Änderungen der Projektbibliotheken gelten für Compile-Snapshots und
Ergebniszuordnung wie relevante Quelltextänderungen. Ein verspätetes Ergebnis
einer früheren Auswahl darf nicht als aktueller Build angezeigt oder für
einen neuen Start wiederverwendet werden. Ob ein bereits laufender Sketch
gestoppt wird, folgt dem bestehenden Verhalten bei Quelltextänderungen; dieses
Feature führt dafür keinen abweichenden Lebenszyklus ein.

## 12. AUnit als erste Bibliothek

Der erste konkrete Paketstand ist **AUnit 1.7.1**, Standardheader **AUnit.h**.
Die Herkunft ist die
[AUnit-Veröffentlichung v1.7.1](https://github.com/bxparks/AUnit/releases/tag/v1.7.1).
Die Aussage ist eine Versionsfestlegung und kein Versprechen, stets die
neueste Veröffentlichung anzubieten.

Ein eigenständiges Minimalbeispiel enthält mindestens:

```cpp
#include <AUnit.h>

test(addition) {
  assertEqual(2 + 3, 5);
}

void setup() {
  Serial.begin(115200);
}

void loop() {
  aunit::TestRunner::run();
}
```

Die Ergebnisse erscheinen im vorhandenen seriellen Monitor. Der Sketch
verwendet die originale Bibliothek; UnoSim ersetzt die Assertions nicht durch
eigene JavaScript-Tests. **Einbinden** erzeugt nur die Abhängigkeit und das
Include; das vollständige Grundgerüst gehört zum eigenständigen Beispiel.

Die erste Freigabe wird für **Uno + Browser-Emulation** geprüft. Erforderlich
sind Compile- und Laufzeitnachweise für erfolgreiche Assertions,
fehlschlagende Assertions, den kooperativen AUnit-Runner-Timeout sowie die
serielle Zusammenfassung. Ein fehlgeschlagener Test ist ein Testergebnis und kein
Compilefehler oder Emulatorabsturz.

Der Timeout von AUnit 1.7.1 ist eine gemeinsame Frist des gesamten Runners,
keine neu startende Frist pro Test. `setupRunner()` setzt einmal `mStartTime`;
`runTest()` prüft bei der kooperativen Weiterverarbeitung gegen diese Zeit
und `mTimeout`. Die Zeit folgt dem emulierten `millis()`. Ein Test, der nie an
den Runner zurückkehrt, wird dadurch nicht unterbrochen. Nach Ablauf der
gemeinsamen Frist werden alle zu diesem Zeitpunkt noch nicht abgeschlossenen
Tests beim Erreichen der Timeout-Prüfung im Zustand `kLifeCycleSetup` als
abgelaufen behandelt. Das umfasst kooperative `testing()`-Fälle und einfache
`test()`-Fälle, deren erster `loop()` noch nicht ausgeführt wurde. Sie erhalten
keine eigene volle Frist. `setTimeout(0)` deaktiviert diese Runner-Frist.

Der Nachweis MUSS mehrere noch offene Tests umfassen, darunter einen
kooperativen `testing()`-Fall und einen einfachen `test()`-Fall, der vor
Ablauf der gemeinsamen Frist noch nicht zu seinem ersten `loop()` gekommen
ist. Beide müssen die gemeinsame Frist statt einer neuen Frist je Test
verwenden.
Überwachung und Laufzeitgrenzen des Emulators folgen weiterhin ihrem eigenen
Vertrag und sind davon unabhängig. Grundlage ist der
[gepinnte TestRunner-Quelltext](https://github.com/bxparks/AUnit/blob/v1.7.1/src/aunit/TestRunner.h).

Weitere Boards, Speichergrenzen kleiner AVR-Ziele und der Host-Mock bleiben
ungeprüft, bis eigene Nachweise vorliegen. Im initialen Bedienungsentwurf ist
der Status daher ausdrücklich **noch zu prüfen**. Ein eigener Test-Runner-
Screen, automatische Auswertung der seriellen Testergebnisse oder ein
automatisches Stoppen nach der Zusammenfassung sind nicht Teil der ersten
Ausbaustufe.

## 13. Akzeptanzanforderungen

Die Umsetzung MUSS mindestens folgende beobachtbaren Fälle abdecken:

| Fall | Erwartetes Verhalten |
| --- | --- |
| Hauptmenü und Optionsmenü der Tabs | Beide öffnen denselben Dialog für das aktuelle Projekt; Anzahl und Projektauswahl stimmen überein |
| Katalogsuche und Fehler | Suchtreffer, keine Treffer, leeres Projekt und Abruffehler sind unterscheidbar; Projektzustand bleibt erhalten |
| Erstes Einbinden von AUnit | Exakte Version und Include werden zusammen ergänzt; Dateiname und Paketversion werden bestätigt |
| Wiederholtes Einbinden | Keine doppelte Abhängigkeit und keine doppelte Include-Zeile |
| Vorhandenes Include, fehlende Abhängigkeit | Hinzufügen registriert die Version und erhält den Quelltext |
| Vorhandene Abhängigkeit, weitere Quelldatei | Include lässt sich dort ergänzen, ohne die Version zu ändern |
| Fehlende Version im Dialog | Name und angeforderte Version bleiben unter Im Projekt sichtbar; Einbinden und Include einfügen werden nicht angeboten |
| Eigenes gleichnamiges Headerfile | Ein lokal auflösbarer zitierter Header wird nicht als fremdes Paket umgedeutet |
| Direktes Include eines transitiven Headers | Kein Hinzufügen-Hinweis und keine automatische direkte Abhängigkeit; unveränderliche transitive Auflösung bleibt wirksam |
| Mehrdeutiger Katalogheader | Keine automatische Paket- oder Versionswahl |
| Fehler, Rückgängig und parallele Bearbeitung | Keine Teiländerung; gemeinsame Rückgängig-Aktion nur bis zur nächsten Änderung; kein Überschreiben neuerer Eingaben |
| Sitzung und Datei-Download | Auswahl gehört zum aktiven Sketch; Quelltext-Download weist mit Paketnamen und Versionen auf fehlende Metadaten hin |
| Reines Dateiladen | Ersetzter Sketch beginnt mit leerer Auswahl; reine Header-Ergänzung erhält die Auswahl; keine stille Versionsrekonstruktion |
| Minimalbeispiel im aktuellen Tab | Ersetzen erst nach Bestätigung; Abbrechen und Ladefehler erhalten bisherigen Sketch und Lauf; Bestätigen übernimmt Dateien und Bibliotheken zusammen |
| Eingebautes Paketbeispiel | Katalogzuordnung liefert Paketname und exakte Version als direkte Abhängigkeit in Katalog, Detail und aktivem Sketch, unabhängig vom Aufrufweg; unzugeordnete Beispiele bleiben ohne Bibliotheksauswahl |
| Manifestversionen | Bibliotheksbeispiele nur in v2; neue Server lehnen libraries in v1 ab; heutige alte v1-/strikte v2-Loader verlieren die Angaben nicht still beim Laden eines solchen v2-Manifests |
| Fehlende Paketversion | Anforderung bleibt sichtbar und erhalten; kein stiller Ersatz und kein erfolgreicher Build mit anderer Version |
| Transitive Abhängigkeiten | Vollständige feste Auflösung; direkte Projektanzahl enthält keine transitiven Pakete |
| Kontrollierter Paketbestand | Ein zufällig zusätzlich auf dem Host installiertes Paket beeinflusst Auflösung und Build nicht |
| Cache und überholtes Ergebnis | Geänderte Version oder Integrität verhindert den alten Treffer; überholte Ergebnisse werden nicht aktuell |
| Board- und Enginewechsel | Status wird passend aktualisiert; Compile- und Laufzeitunterstützung bleiben getrennt |
| Nicht unterstützte Laufzeit | Alle Startwege sind gesperrt, Compile kann bei unterstütztem Compile-Ziel weiter verwendet werden; Grund wird angezeigt |
| AUnit im Uno-Browserlauf | Pass und Fail führen zu den richtigen seriellen Ergebnissen und einer lesbaren Zusammenfassung |
| AUnit-Runner-Timeout | Offene testing()-Fälle und noch nicht ausgeführte test()-Fälle laufen bei Erreichen der Timeout-Prüfung nach derselben Runner-Frist ab; kein neuer Timeout pro Test; Emulator-Watchdog bleibt getrennt |
| Schmaler Bildschirm und Tastatur | Suche, Details, Einbinden und Schließen sind ohne abgeschnittene Pflichtaktionen bedienbar |

Die konkreten Testklassen folgen den
[Testing Standards](../docs/TESTING_STANDARDS.md). Die HTML-Skizze ersetzt diese
Nachweise für die Produktimplementierung nicht.

## 14. Umsetzungsfreiraum und Abgrenzung

Die produktive Umsetzung ist ein eigener Arbeitsschritt. Folgende technische
Details bleiben dem Umsetzungsplan überlassen:

- Ablage und Generierung des zentralen Katalogs und der gepinnten Pakete;
- konkrete Namen von Katalog-Endpunkten und deren Schema-Versionierung;
- Anbindung der Bibliotheksauswahl an den flüchtigen Projektzustand sowie den
  bestehenden Datei-Download und Ersetzen-Pfad;
- Anreicherung eingebauter Beispiele aus der Paket-/Beispielzuordnung des
  zentralen Katalogs, einschließlich Weitergabe in Katalog- und Detailantwort;
- Erweiterung des vorhandenen strikten Root-v2-Beispieleintrags und explizite
  Ablehnung von Bibliotheksangaben in v1 vor dem verwerfenden Parsing;
- Isolation des CLI-Sketchbooks über ein eigenes `directories.user` und
  kontrollierte weitere Suchpfade, nachgewiesen auch im lokalen Hostprofil;
- Abbildung des neuen fachlichen Bibliotheksmodells auf die vorhandenen
  Compile-Transporte und die Übergangsbehandlung des bisherigen optionalen
  `libraries: string[]`;
- interne Typen, Komponentenaufteilung und Bereitstellungsskripte.

Dabei gelten sämtliche oben beschriebenen fachlichen Regeln. Insbesondere
dürfen alte unversionierte Bibliotheksangaben nicht unbemerkt zu einem
erfolgreichen Build mit einer beliebigen aktuellen Version führen. Die
Transportmigration muss sie entweder nachvollziehbar auf eine ausdrücklich
gebundene Version überführen oder mit einer verständlichen Diagnose ablehnen.

Ergänzend zum bestätigten Bedienablauf konkretisiert diese SSOT insbesondere
die Anzahl direkter Abhängigkeiten, das Verhalten fehlender Versionen, den
Umgang mit lokalen Headern, die Grenze von Rückgängig und die Trennung
zwischen Compile- und Laufzeitstatus. Der Umfang bleibt dabei ausdrücklich
beim Sitzungszustand, dem Download-Hinweis und dem bestätigten Ersetzen des
aktuellen Sketches durch ein Beispiel. Das sind Festlegungen dieses
Fachvertrags, keine Behauptungen über vorhandenes Produktverhalten.

Nicht Teil dieser ersten Ausbaustufe sind Projekt-Persistenz und vollständiger
Projekt-Import/-Export, Beispiel-Deep-Links und ein neuer Browser-Tab mit
übertragenem Projektzustand, freie GitHub-/ZIP-Importe,
Installationen während des Kompilierens, ein Administrations-UI, allgemeine
Bearbeitung fremder Bibliotheksquellen, beliebige neue Gerätemodelle und eine
eigene Oberfläche für AUnit-Testergebnisse.

## 15. Externe Grundlagen

- [Arduino-Bibliotheksformat](https://docs.arduino.cc/arduino-cli/library-specification)
  – Metadaten, Header, Implementierungsdateien und Abhängigkeiten.
- [Arduino CLI: compile](https://arduino.github.io/arduino-cli/latest/commands/arduino-cli_compile/)
  – kontrollierte Bereitstellung von Bibliothekspfaden.
- [Arduino CLI: Konfiguration](https://arduino.github.io/arduino-cli/1.5/configuration/)
  – `directories.user` und weitere Bibliothekssuchpfade.
- [AUnit 1.7.1: Dokumentation](https://github.com/bxparks/AUnit/tree/v1.7.1)
  – Bibliotheksverwendung, Test-Runner und serielle Ergebnisse.
- [AUnit 1.7.1: TestRunner](https://github.com/bxparks/AUnit/blob/v1.7.1/src/aunit/TestRunner.h)
  – gemeinsame Timeout-Frist ab Runner-Initialisierung.

## 16. Umsetzung der ersten Ausbaustufe

Umgesetzt am 2026-10-28. Die fachlichen Regeln oben bleiben maßgeblich; diese
Übersicht nennt nur Ort und Nachweis.

| Bereich | Umsetzung | Nachweis |
| --- | --- | --- |
| Gemeinsame Regeln (§3, §4, §6, §7, §9) | `shared/library-requirements.ts`, `shared/libraries.ts`, `shared/library-catalog-schema.ts` | `tests/shared/libraries.test.ts` |
| Katalog und Bereitstellung (§3, §10) | `shared/library-catalog.json`, `scripts/provision-libraries.mjs` (`npm run provision:libraries`), Stufe `libraries` in `Dockerfile.compile-sandbox` | `tests/server/scripts/provision-libraries.test.ts`, `tests/server/services/libraries/library-service.test.ts` |
| Isolierter Compile (§10) | eigenes `directories.user` und leeres eingebautes Bibliotheksverzeichnis (`server/services/compiler/cli-isolation.ts`), `--library` je Paket, `__FILE__` als `sketch.ino` | `tests/integration/library-aunit.test.ts`, `tests/integration/compile-sandbox-libraries.test.ts` |
| Build-Identität und Caches (§11) | Pakete mit Version und SHA-256 in Sketch-Hash, Build-Identität und Ergebnis-Cache | `tests/server/services/arduino-compiler-artifact.test.ts`, `tests/server/routes/libraries.routes.test.ts` |
| Transport (§14) | `libraries: [{ name, version }]` im Compile-Request; reine Namen werden mit Diagnose abgelehnt | `tests/server/routes/compiler.routes.test.ts` |
| Katalog-API und Beispiele (§8.2, §8.3) | `GET /api/libraries`, Zuordnung eingebauter Beispiele, `libraries` in v2-Manifesten, Ablehnung in v1 | `tests/server/examples/example-libraries.test.ts`, `tests/server/services/course-content/course-content-libraries.test.ts` |
| Dialog und Bedienung (§5–§8.1) | `client/src/components/features/libraries-dialog.tsx`, `client/src/hooks/use-project-libraries.tsx`, Hinweisleiste, Download-Hinweis, Startsperre | `tests/client/libraries-dialog.ui.test.tsx`, `tests/client/hooks/use-project-libraries.test.tsx`, `e2e/libraries.spec.ts` |

AUnit 1.7.1 ist für **Uno** beim Kompilieren und in der **Browser-Emulation**
als `verified` eingetragen: Die Nachweise decken erfolgreiche und
fehlschlagende Assertions, die gemeinsame Runner-Frist einschließlich noch
nicht gestarteter `test()`-Fälle und die serielle Zusammenfassung ab, lokal
und in der Compile-Sandbox. Für die Legacy-Engine ist die Laufzeit
`unsupported`, weil ihr nativer Server-Build keine Projektbibliotheken
einbindet; alle übrigen Boards bleiben `untested`.

