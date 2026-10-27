# I/O Registry: drei Tabs

Status: aktualisierter Konzeptvorschlag, 2026-10-27. Die Aufteilung folgt dem Nutzerwunsch; die Anwendung ist noch nicht geändert.

## Navigation

Im bestehenden Ausgabebereich wird I/O Registry geöffnet. Darunter stehen:

**Programmed Pins (n) | All Pins | Pin Infos**

Programmed Pins ist der Standard. Die ersten beiden Tabs ersetzen die bisherige Umschaltung zwischen verwendeten und allen Pins. Nutzungstabelle, Herkunftskennzeichnung, Quelltextnavigation und Auge-/Quellstellen-Ansicht behalten ihre Bedeutung.

## Drei Inhalte

| Tab | Inhalt | Datenquelle |
|---|---|---|
| Programmed Pins (n) | Bisherige Nutzungstabelle für verwendete Pins; n wird wie bisher gezählt | Bestehende statische Analyse plus Laufzeitdaten |
| All Pins | Dieselbe Nutzungstabelle für alle Signalpins; unverwendete Pins haben leere Operationsfelder | Bestehende Registry mit den bisherigen Leerzeilen |
| Pin Infos | Alle Eigenschaften aller Pins des gewählten Boards, unabhängig vom Sketch | Board-, MCU- und Core-Metadaten |

Die beiden Nutzungstabellen behalten die Spalten Pin, pinMode, digitalRead, digitalWrite, analogRead und analogWrite. Der Quellstellen-Schalter und sein Zustand gelten weiterhin für beide. Laufzeit-Ergänzungen und die Zählung bleiben an die vorhandene Registry gebunden.

## Pin Infos: kompakte Eigenschaftenübersicht

Alle Eigenschaftsspalten sind direkt enthalten. Es gibt keinen zusätzlichen Schalter zum Verstecken der Schnittstellen. Die bewusste Wahl des Tabs trennt die Referenz von den beiden Nutzungstabellen.

- **Pin:** Boardbeschriftung; beim ATtiny ergänzt eine zweite Zeile die Schreibweise im Code, z. B. PB4 → Code: 4 / A2.
- **Grundfunktionen:** Digital In, Digital Out, Analog In und PWM Out.
- **Bus Connections:** I²C, SPI/USI und Serial/Software-Serial gemeinsam in einer Spalte, jeweils mit Signal/Rolle. Mehrere Verbindungen stehen untereinander.
- **Interrupts:** externe und Pin-Change-Interrupts.
- **Timer:** PWM-Timer und Kanal.

Die Tabelle hat neun Spalten: **Pin | Digital In | Digital Out | Analog In | PWM Out | Bus Connections | Ext. IRQ | Pin Change | Timer**.

Die separate Spalte Sketch/Alias entfällt. Sie sollte bisher die Schreibweise im Code erklären. Eine ergänzende Zeile direkt beim Pin übernimmt das, wenn Beschriftung und Code-Namen voneinander abweichen. Interne Analog-Pinnummern wie 14 für A0 werden nicht angezeigt. Chipbein, Besonderheiten, Port und ADC-Kanal entfallen als Spalten und auch aus der seitlichen Zusammenfassung. Analog In beschreibt weiterhin die Fähigkeit, analoge Werte zu lesen; der ADC-Kanal wird dafür nicht benötigt.

Die GUI der Vorschau ist wie UnoSim durchgehend englisch, einschließlich Hinweisen, Suche, Tooltips und Leerzuständen. Die Tabelle hat nur eine Kopfzeile mit den eigentlichen Spaltentiteln; die bisherige obere Zeile mit Gruppentiteln entfällt. Eine fixierte Pin-Spalte und horizontales Scrollen bei schmalen Panels halten die Tabelle handhabbar. Die Suche umfasst die sichtbaren Pin-Namen und Funktionen, etwa A0, SDA, SPI oder PCINT. Eine Vergrößerung des Registry-Bereichs ist als Komfortfunktion vorgeschlagen. Die Auswahl einer Info-Zeile kann den Anschluss im sichtbaren Board markieren; sie verändert keine Pinwerte.

Fachlich notwendige Einschränkungen bleiben am betroffenen Eintrag erkennbar: etwa RESET statt eines Häkchens für einen reservierten GPIO. Ein Sternchen mit Erklärung per Tooltip kennzeichnet Sonderfälle, ohne eine zusätzliche Besonderheiten-Spalte einzuführen.

Auf schmalen Bildschirmen bleibt die Matrix horizontal scrollbar, während die Pin-Spalte fixiert bleibt. Die zusätzliche Boardvorschau kann dort entfallen. Keine Eigenschaft wird deshalb aus der Tabelle entfernt.

## Fachliche Regeln

- PWM: **8 Bit, 256 Stufen, 0–255**. ADC: **10 Bit, 1024 Stufen, 0–1023**.
- Nano A6/A7 sind reine Analogeingänge. ATtiny PB5 ist als RESET reserviert; A0 und die GPIO/PCINT-Einschränkungen werden als Sonderfälle kenntlich gemacht.
- Boardbeschriftung und Code-Namen bleiben unterscheidbar: PB4, im Code 4 / A2. Die physische Chipbein-Nummer ist nicht Teil dieser Übersicht.
- Eine Fähigkeit beschreibt weder die aktuelle Verwendung noch beliebige gleichzeitige Nutzbarkeit. Reservierungen bleiben direkt an der betroffenen Fähigkeit erkennbar; die Busspalte zeigt Mehrfachbelegungen.
- Externe und Pin-Change-Interrupts sind getrennte Eigenschaften. Hardware-Registerfähigkeiten und Einschränkungen der Core-Helfer werden nicht gleichgesetzt, etwa bei einzelnen Mega-Pins.
- ATtiny-Busfunktionen heißen USI; SPI-Rollen gelten in der Vorschau für den Core-Master-Modus und unterscheiden sich von ISP-Programmierbezeichnungen.
- Versorgungskontakte erhalten eigene Referenzeinträge ohne erfundene Arduino-Pinnummern. Sie werden nicht zu programmierbaren Registry-Zeilen.
- Hardwarefähigkeit und geprüfte Simulationsunterstützung erhalten getrennte Angaben. Unbekannte Informationen heißen ungeprüft und werden nicht als fehlende Fähigkeit dargestellt.

## Daten und spätere Umsetzung

Die beiden Nutzungstabs verwenden weiterhin dieselbe Registry. Pin Infos nutzt das Boardprofil als gemeinsame Quelle. Vorhandene GPIO-, ADC-, PWM- und Serial-Daten werden um Bus-/Interruptangaben und Kontakt-Aliasse ergänzt, gegen die gepinnten Cores/MCU-Profile geprüft und für die Oberfläche aufbereitet. Eine zweite handgepflegte Liste programmierbarer Pins im Frontend wird vermieden. Pin Infos funktioniert auch ohne Sketch und Simulation.

Eine spätere Umsetzung umfasst Tab-Navigation und Zustandserhalt, vollständige Metadaten, die Eigenschaftenmatrix sowie Prüfungen für Boardwechsel, leere Registry, Laufzeit-Ergänzungen, Sonderpins, Scrollen und Quelltextnavigation. Die Boards- und I/O-Registry-Dokumentation erläutert insbesondere Nutzung versus Fähigkeiten und die fachlichen Datenquellen.

## Umfang der Vorschau

Die Vorschau zeigt die drei Tabs mit einem benannten Beispiel aus drei verwendeten Pins sowie einem leeren Sketch. Die ersten beiden Tabellen stellen das bisherige Verhalten vereinfacht dar. Pin Infos nutzt die vier vorhandenen Boardprofile, die gepinnten Core-Buszuordnungen und die MCU-Pin-Change-Zuordnung. Sie dient der Bewertung von Navigation und Informationsdichte. Vollständige Versorgungskontakte und der Simulationsstatus jeder Funktion gehören zur späteren Produktumsetzung.

## Umsetzungsfreigabe und Integration

Der Nutzer hat am 2026-10-27 die Umsetzung freigegeben. Datei- und Zeilenangaben inklusive vollständigem Navigationstarget bleiben in beiden Nutzungstabs unverändert. Die GUI verwendet die vorhandenen semantischen Farb-, Typografie-, Tab-, Toolbar- und Scroll-Komponenten gemäß `client/src/STYLE_GUIDE.md`. Die bestehende Boardansicht bleibt am bisherigen Ort; eine zusätzliche Boardminiatur und interaktive Pinmarkierung sind optionale Konzeptideen und nicht Teil dieser Umsetzung.

Die Eigenschaften werden aus den Hardwareprofilen abgeleitet und um zentrale Referenzmetadaten ergänzt. Versorgung, Masse, AREF und RESET ohne Arduino-Pinnummer erscheinen als eigene Referenzeinträge, ausschließlich in Pin Infos. Simulationsunterstützung wird unabhängig von der Hardwarefähigkeit erläutert; nicht modellierte I²C-/SPI-/USI-Schnittstellen werden nicht als simuliert ausgegeben.
