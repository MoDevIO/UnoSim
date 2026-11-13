# Klassische UML-Grafiken für Tutorfragen – Arbeitsbericht

Stand: 2026-11-13. Umsetzung, unabhängige Gesamt-/Nachprüfung und sämtliche Abschlussgates bestanden. Kein Commit, kein Push/Merge und keine echten Tutor-/Judge-Aufrufe. Die vorherige Erweiterung „Grafiken immer anfordern“ bleibt im selben Arbeitsbestand erhalten. Maßgeblich ist das [freigegebene Konzept](../superpowers/specs/2026-11-12-tutor-classic-uml-design.md).

## Verhalten gegenüber vorher

Das neue ausgehandelte Profil `uml1-classic-v1` verwendet Aktivitäts-, Klassen- und Sequenzdiagramme mit festen klassischen Symbolen. Das Modell liefert eine strikte Struktur mit Codebelegen statt freier Renderanweisungen. Konservative Lezer-C++-Prüfungen, feste Exportvorlagen und ein app-eigener Arduino-Laufzeitkatalog begrenzen die Aussagen. `not-useful` ist auch bei ausdrücklicher Anforderung zulässig. Frage, Bewertung und Fortschritt bleiben maßgeblich; Grafikfehler erhalten den Text.

Profil und Modus werden vor dem ersten Await eingefroren. Ohne angekündigte Fähigkeit bleibt das Legacyprotokoll erhalten; Profilanfragen bekommen keinen stillen Mermaid-Ersatz. Der Browser zeigt neue Bilder über Blob/`img` in natürlicher Größe, mit Scrollen und zugänglichem Zoom. Support und Replays speichern private Referenzen auf ein kanonisches Artefakt; der Review speichert Vorschläge/Entscheidungen, niemals Bilder oder private Handles.

## Gepinnte Laufzeit und Lizenzen

| Bestandteil | Festlegung |
| --- | --- |
| PlantUML | MIT-Distribution 1.2026.10, SHA-256 in `scripts/tutor-uml-runtime.lock.json`; MIT-Lizenz |
| Layout | Smetana im gepinnten JAR, kein externer Graphviz-Prozess |
| Java | Eclipse Temurin JRE 21.0.13+9 für macOS arm64 und Linux amd64/arm64; OpenJDK GPLv2 mit Classpath-Ausnahme, Lizenz-/Legaldateien im entpackten JRE |
| Schrift | DejaVu Sans 2.37, Archive-SHA-256 gepinnt; DejaVu-/Bitstream-Vera-Lizenztexte im Schriftpaket |
| Parser | `@lezer/cpp@1.1.6`, MIT; ausschließlich serverseitig |
| SVG-Prüfung | `saxes@6.0.0`, ISC; ausschließlich serverseitig |

`npm run provision:tutor-uml` installiert nur unter ignoriertem `cache/tutor-uml`. Hashprüfung erfolgt vor atomarer Veröffentlichung. Die Laufzeit prüft JAR-Hash, Java-Version, Plattformkennung und vollständige benötigte Schriftfamilie. Fehlende Installation führt zu einem festen Grafikfehler, nicht zu einem Download im Request. Docker/Ubuntu-Installer und CI verwenden denselben Provisionierer. `npm run check:tutor-uml-runtime` prüft drei echte Renderfälle; das gebaute CLI liegt unter `dist/tutor-uml-runtime-check.js`.

SANDBOX, headless und deaktivierte Quellenmetadaten; feste Spawn-Argumente, minimale Umgebung ohne geerbte Zugangsdaten; begrenzte Ausgabe und Prozessgruppe mit Kill/Wait bei Abbruch. Zehn Sekunden, 256 MiB Java-Heap, zwei aktive Prozesse und acht Wartende sind technische Grenzen. Es gibt ausdrücklich kein hartes plattformübergreifendes Gesamt-RAM-Limit.

## Echte Renderer-/Darstellungsnachweise

Eigene Referenzen: [Aktivität](../examples/tutor-uml/activity.png), [Klasse](../examples/tutor-uml/class.png), [Sequenz](../examples/tutor-uml/sequence.png). Verzweigung mit `InsideDiamond` liefert wirkliche Rauten; Vererbung zeigt das leere Dreieck, Sequenzen unterscheiden Aufruf/Rückgabe/Selbstaufruf. Tatsächliche Labels und Pfeile wurden betrachtet. Die erste Layoutvariante lieferte sechseckige Entscheidungen; diese wurde vor Integration ersetzt.

[Lokaler Laufzeitnachweis](../examples/tutor-uml/runtime-proof.json): zwei Java-Prozesse zusammen maximal 286.960 KiB gemessen, kein externer dot-Prozess, Abbruch aufgeräumt, kein Dateisentinel im Bild und null HTTP-Zugriffe. [Viewport-Kompatibilitätsnachweis](../examples/tutor-uml/viewport-proof.json) im echten Tutorcontainer bei 320/480/800px und Scale 1/1,5; dies war eine kontrollierte SVG-Einspielung, kein vollständiger Produkt-E2E-Nachweis.

[Linux-Buildnachweise](../examples/tutor-uml/deployment-proof.json): gleiche Runtime und Fonts in Docker. arm64 im nativen Linux-VM-Backend: etwa 0,3–0,4s, kombinierte Renderer-Prozessbaumspitze 204.184 KiB; amd64 unter Emulation: etwa 1,5–2,3s und 323.424 KiB. Die Messungen sind funktionale Nachweise und beobachtete Last, keine Worst-Case-Speichergarantie. Beide fertigen Runnerimages wurden zusätzlich als Benutzer `node` mit `--network none` erfolgreich geprüft: arm64 195.780 KiB und amd64 unter Emulation 316.928 KiB beobachtete Renderer-Prozessbaumspitze. Diese Laufzeitprüfung entstand vor den letzten reinen Vertrags-/Qualitätsrefactorings. Finale Produktgates werden darunter ergänzt.

## Budgets und fachliche Grenzen

16 KiB Modellvorschlag, zwölf Knoten/Beteiligte, 24 Kanten/Nachrichten/Member; 512 KiB SVG, 2400 × 4000 Einheiten und mindestens 14px Schrift. Artefakte: 64 MiB global, 8 MiB Identität, 4 MiB Supportsession und 4 MiB aktive/gehaltene Browserdaten. Eine Reservierung deckt das Maximalbild plus 32 KiB serialisierte Metadaten einschließlich Bildheader ab. Abrechnung erfolgt auf die tatsächliche UTF-8-Größe; gültige Replays werden nicht verdrängt.

Parser und Rubrik beweisen keine allgemeine didaktische Eignung, keine vollständige C++-Semantik und keinen allgemeinen Ausschluss sinngemäßen Lösungsverrats. Nicht eindeutige Syntax, Makros, unbekannte Bibliotheksimplementierungen oder nicht unterstützte Kontrollformen werden abgewiesen. Die geforderten Screenshot-Gegenbeispiele sind feste Regressionen; eine Modellmessung bleibt separat budgetiert (derzeit 0 Aufrufe).

## Unabhängige Prüfungen und Nachbesserungen

Rendererprüfung: externe CSS-Paint-URL in anderer Großschreibung sowie CSS/Transform-Schrumpfung reproduziert, mit sechs neuen RED-Fällen behoben und unabhängig nachgeprüft; 29 SVG-/Rendererfälle grün.

Vertragsprüfung: gemischte Klammerung konnte einen if-Zweig auslassen/vertauschen, Parameter konnten einen globalen Sequenzteilnehmer verdecken, und der positive Arduino-Laufzeitfall fehlte. Alle drei ursprünglichen Befunde sind korrigiert. Eine Nachprüfung fand zusätzlich einen geklammerten Callbackaufruf als Umgehung; auch dieser ist mit 34 neuen Regressionen behoben und unabhängig nachgeprüft. Die monochrome Ausgabe ist mit echten Renderings abgesichert.

Artefaktprüfung: Abrechnung/Identitätsbindung positiv gelesen; bei einer werfenden Support-Reconciliation konnte der Cache bereits verändert sein. Die atomare Nachbesserung mit echtem Pool-Gegenbeispiel und unabhängiger Nachprüfung ist abgeschlossen.

## Finale Abnahme

Die gezielten Nachbesserungen sind unabhängig nachgeprüft. Die zwölf Qualitätsfälle
sind in der [Testmatrix](../tutor-test-matrix.md#klassisches-uml-profil-2026-11-13)
zugeordnet. Die [unabhängige Gesamtprüfung und Nachprüfung](review-tutor-classic-uml-2026-11-13.md)
hat zwei weitere P2-Befunde reproduziert und nach gemeinsamer Korrektur als
behoben bestätigt: Standardargument-Aufrufe werden konservativ berücksichtigt,
und angenommene Ergebnisse/Replays besitzen eigene Auslieferungsreferenzen.
292 gezielte Tests, echte HTTP-Finish-/Abortfälle und acht rote Gegenproben
sichern die Korrektur ab. Es gibt keinen verbleibenden wichtigen Prüfbefund.

### Erster vollständiger Gate-Lauf und Qualitätsbereinigung

App-Coverage-Lauf: 4.788 Tests bestanden, einer wie zuvor übersprungen; 83,224s
bei 150s Grenze. Emulator vollständig: 697 bestanden; separater Coverage-Lauf:
402 bestanden, 295 Korpusfälle dort planmäßig übersprungen. Typprüfungen,
Dokumentation und Build bestanden; Startpfad 729.222 Byte bei 745.000 Byte Limit.
Der vorherige fokussierte Browsernachweis umfasst 26 Fälle, davon elf neue UML-Fälle.

Sonar-Analyse `74704b37-a7f8-484b-9c1f-8487e8e6d989` war **FAILED**:
49 neue Codequalitätsbefunde, überwiegend Komplexität, verschachtelte Ausdrücke
und Darstellung. Neue Coverage 86,9%, Duplikate 0,02007% und Hotspotprüfung 100%
bestanden. Die Befunde wurden ohne Unterdrückungen behoben. Die statische Nachprüfung
reduzierte sie auf vier kleine Restbefunde; auch diese wurden korrigiert. Das
frische finale Gate steht unten.

Das noch nicht veröffentlichte UML-Entscheidungsschema wechselt dabei von
`then`/`else` zu `whenTrue`/`whenFalse`, Promptrevision r3. Bestehende neue
UML-Fixtures werden ausschließlich strukturell migriert; ihre fachlichen,
Sicherheits- und Lebenszyklusassertionen bleiben erhalten. Legacyverträge bleiben
unverändert. Die echten CLI-Installations-/Smokeprogramme sind explizite
Knip-Entry-Points; ausschließlich für Tests benötigte Helfer gehören unter Tests.

### Technische Endprüfung vor den beiden letzten Nachbesserungen

| Prüfung | Ergebnis am bereinigten Stand |
| --- | --- |
| Vollständige App-Tests mit Coverage | 4.792 bestanden, 1 bestehender Skip; 67,258s bei 150s Grenze |
| Emulator vollständig | 697 bestanden |
| Emulator-Coverage | 402 bestanden, 295 Korpusfälle dort planmäßig übersprungen; separat vollständig ausgeführt |
| Deterministischer Tutor-Qualitätsgate | 1.076 Tests in 80 Dateien, 12,538s bei 15s Grenze |
| Sämtliche Tutor-Browserfälle | 43 bestanden, sieben Spezifikationen, `--retries=0`, 45,8s |
| Typen, Lint, Dokumentation, `git diff --check` | bestanden |
| Knip vollständig und Produktion | beide 0 neue Befunde, keine neue Ausnahme/Baseline |
| Build-/Bundlebudget | bestanden, Startpfad 729.222 Byte bei 745.000 Byte Limit |
| Sonar | Analyse `793ffb2b-0df8-488c-aad7-f6ccefc581d0`: Gate **PASSED**, 0 neue Befunde, Coverage 86,9%, Duplikate 0,01966%, Hotspotprüfung 100% |
| Finale Docker-Runner arm64 und amd64 | Builds und echte Drei-Arten-Smokes als `node`, `--network none`, bestanden |

Der Sonarstatus wurde zusätzlich direkt über die konkrete Analyse-ID aus der
API gelesen. Die Coverageangabe bezeichnet den im Sonarprojekt konfigurierten
Vergleichszeitraum; sie ist keine isolierte didaktische Qualitätskennzahl dieser
Erweiterung. Ein parallel gestarteter Lintlauf hatte temporäre vom Scanner
entpackte TypeScriptdateien mit erfasst; nach Ende des Scanners bestand der
unveränderte Produktlint ohne neue Ignorierregel.

Die finalen Produktionsläufe beobachteten Renderer-Prozessbaumspitzen von
199.900 KiB (arm64) und 324.580 KiB (amd64 unter Emulation). Die Nachweise stehen
im [Deploymentprotokoll](../examples/tutor-uml/deployment-proof.json). Linux
amd64 wurde hier unter Emulation geprüft, nicht auf physischer x86-Hardware.
Eine vollständige Ubuntu/VBox-Gatewayinstallation wurde nicht erneut aufgebaut;
belegt sind die tatsächlichen Rendererpfade der daraus gebauten Serverimages.

Tatsächliche Prompts: `tutor-prompts-v12`, UML `tutor-uml1-classic-v1-r3`,
abgeleiteter Template-Digest
`fb09f3ffccf7c409828b6ecb5ec5becb7711f586ff59166a6fb227cbe0dfa3f4`.
Echte Tutor-/Judge-Aufrufe: **0**. Fachliche Qualität freier Modellvorschläge
bleibt gesondert zu messen. Es wurde nichts committet oder veröffentlicht.

## Festgelegte Umsetzungsentscheidungen

- Der vorhandene Featurecheckout enthält beide uncommitteten Erweiterungen. Er
  bleibt erhalten; getrennte Dateizuständigkeiten und unabhängige Prüfungen
  begrenzen das Risiko vermischter Änderungen. Es gab keinen automatischen Commit.
- Smetana aus dem gepinnten PlantUML-JAR ersetzt eine weitere native
  Graphviz-Abhängigkeit. Neue Diagrammformen müssen ihre Geometrie erneut
  nachweisen; der Renderername allein genügt nicht.
- 32 KiB Metadatenreserve umfasst auch Bildheader; das Vorschlagslimit bleibt
  16 KiB. Künftige größere Metadaten können daher eine neue optionale Grafik
  ablehnen, ohne den Lerntext zu verwerfen. Sessiongültigkeit wird vor und nach
  asynchroner Arbeit geprüft; ein zu spät abgeschlossenes Ergebnis belebt keine
  abgelaufene Session wieder.
- Teilaufgaben und Leseprüfungen liefen in getrennten Agentkontexten. Das
  verändert keine Laufzeitfunktion, kostet aber zusätzliche Prüfzeit und
  Assistenzkontingent. Das Budget für echte Tutor-/Judge-Aufrufe blieb davon
  unabhängig bei null.
- Das unveröffentlichte Entscheidungsschema wurde mit Promptrevision r3 auf
  `whenTrue`/`whenFalse` vereinheitlicht. Falls diese Entscheidung später geändert
  wird, müssen die neuen Schemafixtures erneut migriert werden; ein bereits
  veröffentlichtes Format wurde nicht verändert.
- Das lokale Arbeitsprotokoll bleibt bis zu einem ausdrücklich beauftragten
  Commit erhalten, weil uncommittete Berichte noch keine Git-Historie besitzen.
  Temporäre Renderexperimente wurden als Text archiviert und nicht durch neue
  Lintausnahmen versteckt.

### Endgültige Abnahme nach der gemeinsamen Nachbesserung

| Prüfung | Endgültiges Ergebnis |
| --- | --- |
| App-Tests mit frischer Coverage | **4.810 bestanden**, 1 bestehender Skip; 52,911s bei 150s Grenze |
| Emulator vollständig | **697 bestanden**; unveränderte Emulatorquellen |
| Emulator-Coverage | **402 bestanden, 295 geplante Korpus-Skips**, 27,838s; Korpus separat vollständig grün |
| Deterministischer Tutor-Qualitätsgate | **1.092 Tests**, 81 Dateien, 8,318s bei 15s Grenze |
| Alle Tutor-Browserfälle | **43 bestanden**, sieben Specs, keine Retries, 37,7s |
| Typen, Lint, beide Knip-Profile, Dokumentation, Diffprüfung | **bestanden** |
| Build | **bestanden**, Startpfad weiterhin 729.222 / 745.000 Byte |
| Sonar | **PASSED**, Analyse `cb99ceb9-5b7e-4855-b73d-fc14d279785e`, 0 neue Befunde, Coverage 86,9%, Duplikate 0,0196%, Hotspots 100% |
| Unabhängige Gesamtprüfung mit gezielter Nachprüfung | **beide P2 geschlossen**, kein offener wichtiger Befund |

Die optionale Guard-Stilkorrektur nach der funktionalen Nachprüfung ist
seiteneffektfrei und wurde mit 35 gezielten Auslieferungs-/Quellenregressionen
und anschließend erneut mit dem vollständigen Coverage-/Sonar-Lauf geprüft.
Beide Produktionsimages wurden nach der funktionalen Nachbesserung erneut
gebaut und ohne Netzwerk als Benutzer `node` mit allen drei Diagrammarten
geprüft; die Renderkomponente blieb bei der Guard-Stiländerung unverändert.

Das Arbeitspaket A–D ist abnahmebereit. Live-Studie E bleibt getrennt und
unbeauftragt; insbesondere entsteht aus Fakes, Rendererbelegen oder Sonar kein
Nachweis allgemeiner Modellqualität. Alle Änderungen bleiben uncommittet im
vorhandenen Featurebranch. Bei einem noch laufenden lokalen Backend ist vor
dem manuellen Test ein Neustart nötig, damit dessen Profilverhandlung den neuen
Stand verwendet.
