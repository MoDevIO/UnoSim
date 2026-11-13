# Unabhängige Gesamtprüfung: klassische Tutor-UML-Grafiken

Stand: 2026-11-13. Geprüft wurde der uncommittete Gesamtstand auf
`feature/tutor-question-graphics-mode` gegenüber `1f5c59512`, einschließlich der
vorausgehenden Einstellung „Grafiken immer anfordern“. Eine getrennte Instanz
hat Spezifikation, Gesamtänderungen, Tests, Renderreferenzen und Deployment
unabhängig gelesen und gezielte Gegenbeispiele ausgeführt. Anschließend wurde
**eine gemeinsame Nachbesserung beider Befunde** gezielt unabhängig nachgeprüft.
Die Prüfer haben keine Produktdateien verändert und keine echten Tutor-/Judge-
Aufrufe oder pauschalen Wiederholungen der Testsuiten durchgeführt.

**Endurteil: Beide ursprünglichen P2-Befunde sind behoben. Spezifikations- und
Qualitätsnachprüfung bestanden; keine wichtige durch die Korrektur verursachte
Regression festgestellt.** Die anschließend frisch ausgeführten technischen
Gates stehen im [Arbeitsbericht](report-tutor-classic-uml.md).

## Befunde der ersten Gesamtprüfung

### P2: Aufrufe in Standardargumenten fehlen in einer akzeptierten Sequenz

Der Aufrufpfad prüfte geschriebene Argumente und den Funktionskörper, aber nicht
die Initialisierer von Standardparametern. Dieses gültige C++ wurde akzeptiert:

```cpp
int measure() { return 2; }
class Sensor { public: int read(int value = measure()) { return 1; } };
Sensor sensor;
void run() {
  sensor.read();
}
```

Die Sequenz zeigte nur `run → sensor.read()` und `return 1;`. Der tatsächlich
vor dem Methodeneintritt ausgeführte Aufruf `measure()` fehlte. Das widersprach
dem behaupteten vollständigen geraden Aufrufpfad. Auch Standardargumente aus
einer getrennten freien Funktionsdeklaration mussten berücksichtigt werden.

**Behebung:** Der konservative Quellenbeleg weist nicht unterstützte
Standardinitialisierer im Einstieg, Ziel und passenden Deklarationen zurück.
Gewöhnliche Aufrufe und unterstützte Literaldefaults bleiben belegt. Die App
behauptet keine allgemeine C++-Auswertung. Nichtliterale Defaults können auch
dann abgelehnt werden, wenn ein bestimmter Aufrufer explizite Argumente liefert;
das ist eine bewusste konservative Grenze dieses Profils.

**Unabhängige Gegenprobe:** Der ursprüngliche Fehlerfall wird nun mit
`invalid-evidence` abgewiesen; der Literaldefault-Positivfall wird angenommen.

### P2: Ein akzeptierter Replay verliert sein Bild vor der Auslieferung

Die Prüfung reproduzierte ausschließlich über öffentliche Store-/Poolmethoden:
Eine alte Grafikantwort plus 31 weitere Ergebnisse füllen den Replaycache.
Während die 33. Aktion abgeschlossen wird, wird der älteste Replay angenommen.
Vor dessen anschließender Serialisierung verdrängt die neue Aktion den alten
Cacheeintrag. Ohne eigene Auslieferungsreferenz wurde das kanonische Artefakt
bereits gelöscht: Ergebnis `status: ok`, aber kein Bild mehr vorhanden. Weder
Sessionablauf noch fremde Identität oder ungültiger Fingerprint waren nötig.

**Behebung:** `deliveryRequested` erfasst jeden zugelassenen HTTP-Verbraucher
in dessen eigenem Requestkontext. Cached-, Pending-Duplikat- und aktuelle
Ergebnisse erwerben ihre eigene Auslieferungsreferenz vor dem asynchronen
Übergang zur HTTP-Antwort. `pinDelivery` validiert Besitzer und Session atomar,
zählt den kanonischen Inhalt einmal und berücksichtigt aktive Auslieferungen
weiter im Sessionbudget. Finish/Close/Abort geben die jeweilige Referenz
idempotent frei; spät abgeschlossene bereits geschlossene Requests halten
nichts zurück. Logischer Cache-/Sessionablauf entfernt keine noch benötigte
Auslieferung. Nach der letzten Referenz wird der Inhalt freigegeben.

**Unabhängige Gegenprobe:** Die ursprüngliche 33.-Ergebnis-Verschränkung wurde
mit echten Produktions-Requestkontexten und Lifecyclehooks erneut ausgeführt.
Der angenommene Replay enthält nun sein SVG. Abschließende und wiederholte
Freigabe löschen den letzten kanonischen Eintrag korrekt.

## Nachweise der gemeinsamen Korrektur

Die Implementierung legte zuerst tatsächlich fehlschlagende Regressionen an.
Der anschließende gezielte Lauf umfasst **292 bestandene Tests in 19 Dateien**,
einschließlich der bisherigen Regressionen. Getrennte Schutz-Deaktivierungen
ließen **acht Regressionen** rot werden; die Korrekturen wurden danach
wiederhergestellt. Dazu gehören echte HTTP-Middlewarefälle für erfolgreiche
Auslieferung und Abbruch. ESLint und beide relevanten Typprüfungen bestanden.

Die unabhängige Nachprüfung untersuchte zusätzlich beide Freigabereihenfolgen
von Produzent und Duplikat, parallele Replays, TTL-/Kapazitätsentfernung der
Session, geschlossene Pending-Verbraucher, kanonische Größenabrechnung,
Besitzer-/Sessionbindung und die atomare Referenzübernahme. Kein neues Await
liegt zwischen erfolgreicher Übernahme und Auslieferungsreferenz. Die
bestehenden Konflikt-, Missing-, Spent- und Aktionszählerregeln bleiben erhalten.

Ein anschließend behobener einzelner Sonar-Stilbefund ersetzt lediglich eine
äquivalente Guard-Bedingung durch Optional Chaining. Die Auslieferungs- und
Defaultargumentfälle sowie sämtliche App-Tests wurden danach frisch geprüft;
die finale Sonar-Analyse ist `cb99ceb9-5b7e-4855-b73d-fc14d279785e`, Gate PASSED.

## Positiv geprüfte Architektur und Grenzen

Die Prüfung bestätigte die explizite Profilverhandlung und Legacykompatibilität,
getrennte Modellvorschläge und app-eigene Artefakte, feste Grenzen, finalen
Frage-/Quelldateibezug, tatsächlichen Modellalias, begrenzte Nachforderung,
Abbruchschutz, Retain-/Supportzustände, normalisierte Reviewdaten ohne Bilder,
geschlossenen lokalen Renderer und die Blob-/Bildanzeige. Die echten
Aktivitäts-, Klassen- und Sequenzreferenzen wurden betrachtet; die Tests
verwenden die reale gepinnte Renderlaufzeit und kontrollierte Provider.

Folgende Fragen wurden bewusst außerhalb einer stärkeren Zusage belassen:

- Allgemeine didaktische Eignung und jeder sinngemäße Lösungsverrat: Dafür fehlt
  die separat zu budgetierende Live-Modellmessung; das vereinbarte Budget ist 0.
- Vollständige C++-Semantik, beliebige Überladungen, implizite Konversionen,
  Makros, Unicode-/Schriftformen und fremde Bibliotheksinternas: Das Profil
  bleibt konservativ; explizite Defaultaufrufe sind dagegen jetzt abgesichert.
- Ein hartes Gesamt-Prozessbaum-RAM-Limit: Vereinbart sind Heap-, Zeit-, Ausgabe-
  und Lastgrenzen sowie gemessene RSS-Werte.
- Ein feindlicher Administrator mit Austauschrechten auf JRE/Fonts oder
  beliebige privilegierte Serveraufrufer außerhalb der geprüften Eingangswege.
- Native x86-Hardwarebenchmarks, vollständiger neuer Ubuntu/VBox-Aufbau und
  Worst-Case-Produktionslast: amd64 wurde ausdrücklich unter Emulation geprüft.
- Die zunächst noch laufende Dokumentation und allgemeine zusätzliche
  Stilbereinigung: Die Dokumentation wurde vom Hauptagenten abgeschlossen;
  hierfür wird keine neue funktionale Prüfung behauptet.

Es verbleibt kein offener wichtiger Befund aus Gesamtprüfung und Nachprüfung.
Die Freigabe bezieht sich auf das vereinbarte kleine UML-Profil und die
nachgewiesenen technischen Verträge, nicht auf eine ungemessene Modellqualität.
