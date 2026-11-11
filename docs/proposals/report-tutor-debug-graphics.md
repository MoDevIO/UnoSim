# Tutor-Diagnose und Grafikfähigkeiten

Status: Umsetzung und Verifikation vom 2026-11-11 abgeschlossen; lokal auf `feature/tutor-debug-graphics`, noch nicht committet. Nicht normativ.

## Ergebnis und Umfang

Die neue Diagnose verbindet Provider-Parsing, serverseitige Sicherheits- und Inhaltsentscheidungen, HTTP-Ergebnis und lokale Darstellung. Im Debug-Tab lassen sich Tutor-Einträge nach Kategorie, Anfragekennung, Verarbeitungsschritt, Ergebnis und Grund auswerten und kopieren. Die Sammlung enthält ausschließlich erlaubte Metadaten; der vorhandene Provider-Rohtextlog wurde entfernt.

Die Serverfreigabe erfolgt über `UNOSIM_TUTOR_DIAGNOSTICS_ENABLED`: Entwicklung standardmäßig an, Produktion und Tests standardmäßig aus. Der Nutzer aktiviert zusätzlich den Browser-Debug-Modus. Ohne Serverfreigabe sind lokale Schritte möglich, die fehlende Serverspur ist ausdrücklich erkennbar. Die sichere Konfiguration nutzt dafür das zusätzliche boolesche Feld `tutorDiagnosticsAvailable`; der bestehende Vertrag `tutor: { provider }` bleibt erhalten.

Die Diagnose wird erst bei Bedarf geladen, die erweiterte Debug-Ansicht beim Öffnen ihres Tabs. Das bestehende Start-Bundle-Budget wird nicht angehoben. Eine kleine Ladeansicht erhält die grundlegenden Debug-Bedienelemente. Der eigentliche Diagrammrenderer lädt weiterhin erst für eine vorhandene Grafik.

## Belegte Grafikfehler und Korrekturen

| Befund vor der Änderung | Verhalten der Umsetzung | Nachweis |
| --- | --- | --- |
| Verkettung `A --> B --> C` verliert die zweite Kante und den letzten Knoten. | Alle drei Knoten und beide Kanten bleiben erhalten. Auch kompakte Schreibweise `A-->B-->C` wird erkannt. | Renderer-Regressionssuite, SVG-DOM mit wörtlich erwarteten Knoten-/Kantenzahlen. |
| Zustandsübergang `Aus --> An : Taster gedrückt` verliert den Text. | Übergangsbeschriftung wird als Text gerendert. | Renderer-Regressionssuite. |
| `A -- ja --> B` zeichnet `ja` als Knoten und verliert B. | Genau zwei Knoten und ein beschrifteter Übergang. | Renderer-Regressionssuite. |
| Das Label `click` ist unabhängig vom Kontext gesperrt. | Textlabel erlaubt, tatsächliche Interaktionsanweisung gesperrt. | Gemeinsame Server-/Client-Sicherheitsfälle. |
| `x<b && c>d` wird als HTML missverstanden. | Vergleichstext wird sicher in SVG escaped; echte Tags bleiben gesperrt. | Renderer-/Server-Gegenproben für Vergleich und Script-/IMG-/SVG-Markup. |
| Teilweise bekannte Diagramme verlieren unbekannte Konstrukte ohne Hinweis. | Nicht unterstützte Konstrukte verwerfen die ganze Grafik mit festem Grund. | Gemischte Flow-/Sequenzsyntax mit Textfallback. |
| `RL` und `BT` wirken wie die Vorwärtsrichtung. | Positionen und Pfeile folgen der umgekehrten Richtung. | Positionsprüfung im erzeugten SVG. |
| Planung ersetzt eine Frage und übernimmt eine fremde Grafik. | Bei tatsächlicher Fragenersetzung wird die Grafik entfernt. Entscheidend ist das endgültig akzeptierte Ergebnis. | Finalisierungssuite mit akzeptiertem und verworfenem Planner-Ergebnis. |

Server und Renderer nutzen dieselben Header-, Längen- und Sicherheitsregeln aus `shared/tutor-mermaid-rules.ts`. Sicherheitsprüfung und syntaktische Darstellbarkeit bleiben eigene Schritte. Alle Texte werden unabhängig von der vorgelagerten Prüfung beim SVG-Aufbau escaped.

## Zugesicherter und begrenzter Grafikumfang

| Fähigkeit | Zustand |
| --- | --- |
| Kleine Flow-/Graph-Diagramme mit Knoten, Verkettungen und beschrifteten Kanten | Unterstützt im dokumentierten Ausschnitt. |
| Einfache Zustandsübergänge mit Text und Start-/Endsymbolen | Unterstützt im Ausschnitt; keine vollständige Mermaid-Zustandsgrammatik. |
| Einfache Sequenznachrichten zwischen mindestens zwei Teilnehmern | Unterstützt; erweiterte Blöcke wie `loop` werden vollständig abgelehnt. |
| Gepunktete Kanten, Subgraphs, komplexe Direktiven und umfangreiche Layoutregeln | Keine allgemeine Unterstützung; feste Ablehnung anstelle stiller Teilinterpretation. |
| Aufwendige geometrische Anordnung und besondere Knotensymbole | Bestehender einfacher Renderer mit Kästen und Pfeilen; kein allgemeines Mermaid-Layoutsystem. |
| Lange Beschriftungen | Bisherige Begrenzung auf 48 sichtbare Zeichen mit Ellipse bleibt; für kompakte Diagramme gedacht. |
| Selbstschleifen beziehungsweise Diagramme mit weniger als zwei Knoten | Kein zugesicherter Umfang; kein gerendertes Teildiagramm als Ersatz. |
| Grafiken in Erklärungen/Hinweisen | Bestehender Supportvertrag gibt Text aus; eine mitgelieferte sichere Grafik wird mit `support-graphics-not-supported` diagnostiziert. |
| Grafiken im Dialogverlauf | Nicht gespeichert/angezeigt; keine neue Grafikarchivierung. |
| Zeit bis „Weiter“ | Grafik kann bereits empfangen sein und wird als zurückgehalten protokolliert; Render-Erfolg folgt erst nach SVG-Einbindung. |

Ein vollständiger Mermaid-Runtimewechsel ist für diese Reparaturen nicht erforderlich. Die Häufigkeit, mit der ein echtes Modell Grafiken erzeugt, ist damit nicht belegt. Es wurden keine persönlichen Keys verwendet und keine kostenpflichtigen Live-Anfragen ausgelöst. Die optionale Promptregel und das Fehlen konkreter Einsatzbeispiele bleiben mögliche Erklärungen für seltene Lieferung; dafür wird kein erfundener Messwert angegeben. Eine Diagrammquote ist kein Qualitätsziel.

## Erste Live-Beobachtung und Promptänderung

Ein Testlauf am 2026-11-11 mit `openai-gpt5.5` zeigte bei drei Antwortdialogen jeweils `parsing: not-provided`: Das Modell hat kein `mermaid`-Feld geliefert; Parser, Sicherheitsprüfung und Renderer waren nicht beteiligt. Der Prompt erlaubte Grafiken bis dahin nur („optional mermaid“) und nannte weder Einsatzfälle noch ein Beispiel.

`tutor-prompts-v10` ergänzt deshalb Einsatzkriterien (Ablauf, Zustandswechsel, Signal- und Datenfluss), den Verzicht bei einfachen Faktenfragen, den vollständig darstellbaren Syntaxumfang mit ausgeschlossenen Konstrukten und ein Beispiel. Hinweise und Klärungen erhalten ausdrücklich kein `mermaid`. `tutor-mermaid-prompt.test.ts` sichert ab, dass Beispiel und erlaubte Formen gerendert und ausgeschlossene abgelehnt werden. Ob das Modell nun häufiger passende Grafiken liefert, ist noch nicht gemessen; die Beobachtung erfolgt über den Debug-Tab in normalen Testläufen.

Derselbe Lauf zeigte bei jeder erfolgreichen Anfrage `model-id-not-listed`: KI:connect meldet zum gelisteten Alias einen eigenen Versionsnamen zurück. Die Diagnose zeigt diesen zurückgemeldeten Namen jetzt nach Formatprüfung als `modelReturned`; nur ein unzulässiger Name entfällt mit `model-id-withheld`.

Eine neue Testmatrix (`tutor-graphic-matrix.test.ts`) prüft Frage, Antwortdialog und Hilfe jeweils ohne, mit gültiger und mit unsicherer Grafik. Sie deckte auf, dass eine gültige Grafik doppelt als `safety: accepted` gemeldet wurde, weil die Qualitätsprüfung der endgültigen Frage die Sicherheitsprüfung erneut meldete; das ist behoben.

## Ergänzende Analyse der übrigen Tutorfunktionen

Die ergänzende Untersuchung blieb innerhalb des vereinbarten 60-Minuten-Budgets und wurde nach Bereitstellung der Diagnose anhand der vorhandenen Tests und relevanter Datenwege durchgeführt. Grafikarbeit und erforderliche Implementierungsprüfungen sind darin nicht enthalten.

| Bereich | Stand der Prüfung | Evidenz und Grenze |
| --- | --- | --- |
| Einrichtung und Modellwahl | Teilweise geprüft | Vorhandene Provider-/Konfigurations- und Hooktests decken manuelle/automatische Wahl, veraltete Auswahl und fehlende Freigabe ab. Zusätzliche Diagnosekonfiguration geprüft. Keine neue Erhebung echter KI:connect-Modelllisten. |
| Initialfrage, freier Tutor und Lehrerfokus | Geprüft für ausgewählte kontrollierte Fälle | Service-/Routentests und `focus-session` prüfen Zuordnung, Qualitätsfallback und Fortschritt. Neue Finalisierungssuite prüft Grafikbesitz nach Planner-Ablehnung. Keine vollständige fachliche Prüfung sämtlicher Kursinhalte. |
| Antwortdialog, Bewertung und „Weiter“ | Teilweise geprüft | Bestehende Hook-/Support-/Fokustests und neue Diagnosefälle. Die Diagnose misst keine neue fachliche Bewertungsqualität; Schwierigkeit und Rubrik wurden nicht umgestellt. |
| Klärung, Hinweis, Musterantwort, Überspringen und Replay | Teilweise geprüft | Vorhandene Support-Routen-/UI-Tests; neuer echter HTTP-Test belegt Replay ohne neuen Modellaufruf und ohne alte Diagnosehülle. Zusätzliche Provider-freie Referenz-/Fallbackstationen sind in dieser ersten Diagnoseetappe nicht flächendeckend instrumentiert. |
| Kontext, Abbruch und verspätete Ergebnisse | Geprüft für ausgewählte kontrollierte Fälle | Bestehende Lernkontext-/Sketchtests sowie neue Regression für verworfene gehaltene Grafik beim Dialogreset. Keine vollständige Last-/Mehrbenutzer-Browserprüfung; Collector-Isolation für parallele Requests separat getestet. |
| Strukturiertes Providerformat für Evaluation/Judge | Nicht Teil dieser Diagnoseetappe | Dieser Datenweg dient dem Evaluator und ist nicht der normale Tutor-HTTP-Pfad. |

Eine breite Überarbeitung von Didaktik, Curriculum oder Antwortbewertung wurde nicht aus dieser Untersuchung abgeleitet.

## Diagnosekorrekturen aus der unabhängigen Prüfung

Eine unabhängige Codeprüfung benannte drei wesentliche Probleme im ersten Implementierungsstand. Alle drei erhielten neue Regressionen, die zunächst fehlschlugen:

- Ungültige Lernantworten einschließlich `null` und nicht passender Objektstruktur müssen am Client als `request/failed/invalid-response` enden. HTTP 200 allein ist kein erfolgreicher Lerninhalt.
- Eine verworfene Planner-Kandidatenfrage darf keine endgültige Grafikverwerfung vortäuschen. Inhaltsentscheidungen werden nach der Finalisierung protokolliert.
- Ein Kontextreset schließt auch die Spur eines bereits empfangenen und bis „Weiter“ zurückgehaltenen Diagramms mit `discarded/context-changed`.

Die erneute unabhängige Prüfung bestätigte die Korrekturen und meldete keine weiteren wesentlichen Befunde. Ergänzende Regressionen sichern den Ausfall des optionalen Diagnoseladers, den Renderer-Ladefehler, die einmalige Erfassung kopierter Antworten, die Nichtübernahme von Diagnosefeldern in Verlauf/Storage sowie die Behandlung getrimmter Credentials und kollidierender Diagnosekennungen ab.

Die Browserprüfung deckte außerdem einen überlappenden Debug-Kopf bei umgebrochenen Filtern auf: Die globale feste Kopfhöhe passte nicht zu mehreren Filterzeilen. Der erweiterte Debug-Kopf verwendet jetzt seine tatsächliche Inhaltshöhe. Kopieren, Ansichtswechsel und Details sind ohne erzwungene Klicks erreichbar; die Details wurden auch per Tastatur bei gemessener XXL-Skalierung `1.5` geöffnet.

## Verifikation

- Vollständiger App-Lauf auf dem endgültigen Teststand: **4.253 Tests bestanden**, ein vorhandener Test übersprungen; 438 Testdateien bestanden, eine übersprungen.
- Emulator-Suite: **697 Tests bestanden**.
- Browser: **5 Fälle bestanden**. Ablauf-, Zustands- und Sequenzdiagramme durchlaufen den echten Provider-/HTTP-/Servicepfad mit kontrolliertem lokalem Provider bis zum sichtbaren SVG. Weitere Fälle prüfen die sichere Ablehnung mit erhaltener Textfrage sowie Zurückhalten/„Weiter“, XXL und Tastaturdetails. Kopien enthalten weder Grafikrohtext noch Test-Key; das Anzeigen von Details erzeugt keinen weiteren Provideraufruf.
- Typprüfung (`npm run check`), vollständiger Build (`npm run build`), vollständiges Lint (`npm run lint`) und Dokumentationsprüfung (`npm run check:docs`) bestanden. `git diff --check` ist sauber; bestehende Testdateien wurden nicht geändert.
- Start-Bundle: Nach der Diagnose-Integration lag es bei 744.826 Byte, nur 174 Byte unter dem unveränderten Limit von 745.000 Byte (Ausgangscommit: 744.684 Byte). Seit der Tutor-Zustand über eine nachgeladene Host-Komponente (`tutor-state-host.tsx`) entsteht, liegen `use-tutor.ts` und die Tutor-Schemas nicht mehr im Startpfad: **726.900 Byte**, rund 18 KB Reserve.
- Sonar: Der erste vollständige Scan meldete 20 neue Befunde, darunter zwei Regexe mit Backtracking. Die Regel für Mermaid-Anweisungen brauchte bei 12.000 Leerzeilen etwa 90 ms je Prüfung; ein Laufzeittest sichert die lineare Fassung ab. Nach den Korrekturen besteht die Qualitätsprüfung ohne neue Befunde.

Die gezielte Browserprüfung ist kein vollständiger Lauf sämtlicher bestehender E2E-, Docker- oder Toolchain-Integrationstests. Es wurde nichts gepusht oder veröffentlicht. Die Laufprotokolle und Screenshots liegen lokal unter `.superpowers/sdd/2026-11-11-tutor-debug-graphics/`; die neuen Unit- und Browserregressionen gehören zum Änderungsumfang.

Maßgeblicher Vertrag: [LearningQuestions-SSOT](../../ssot/ssot_function_definition_LearningQuestions.md). Konzept und Umsetzungsentscheidungen: [Konzept](../superpowers/specs/2026-11-11-tutor-debug-graphics-design.md), [Plan](../superpowers/plans/2026-11-11-tutor-debug-graphics.md).

## Etappe 4: Lokaler Tutor-Mitschnitt (2026-11-11)

Umgesetzt nach [Konzept §12](../superpowers/specs/2026-11-11-tutor-debug-graphics-design.md) und [Umsetzungsprompt](../superpowers/prompts/2026-11-11-tutor-review-capture.md); Vertrag in [LearningQuestions §12.7](../../ssot/ssot_function_definition_LearningQuestions.md), Format in [Tutor-Review-Format](../tutor-review-format.md).

**Ergebnis.** Im Debug-Tab (Kategorie *Tutor*) kopiert **Copy Tutor review** einen Mitschnitt vollständig, unabhängig von Filtern und vom 500er-Puffer: Kopf mit Vollständigkeit und Größe, chronologisches Protokoll (Frage, Antwort, Einstufung, Bewertung, Feedback, Folgefrage, Grafik, Modell), alle gesendeten Codekontexte mit Headern und Board, Legende aus den Tutor-eigenen Rubrik- und Schwierigkeitstexten (`shared/tutor-assessment-guidance.ts`, Prompt-Digest unverändert), JSON und Abschlussmarkierung. Der Server ergänzt im `review`-Block (höchstens 128 KiB) den normalisierten Modellentwurf, Entscheidungen mit Auslöser (`planner-question`, `repetition-fallback`, `retain-open-question`, `planned-question-rejected`, `non-learning-fallback`, `assisted-question-left`), Ergebnisquelle, Sketchfakten, Einstufung, Replay sowie Promptrevision und Template-Digest.

**Aufnahme.** Die nachgeladene Diagnose-Runtime liest den tatsächlich gesendeten Request und die Antwort; `use-tutor` meldet nur lokale Schritte (zurückgehalten, angezeigt, Reset, Bewertungsdurchschnitt mit Fenster). Kontextstände werden einmal gespeichert und referenziert; die mitgesendete Historie verweist auf erfasste Schritte oder auf ausdrücklich importierte Vorgeschichte. Epochen verhindern, dass Antworten nach Leeren oder DEBUG aus/ein Inhalte wiederherstellen. Grenzen nach §12.5 werden inkrementell und vor Übernahme geprüft.

**Ausgeschlossen.** Schlüssel (auch in Texten, vor Speicherung in vier Schreibweisen ersetzt und gezählt), Header, Support-/Kurs-/Fragen-Handles, Idempotenzschlüssel, nicht gezeigte Musterlösungen, Kursinhalte außer Kennungen, Vollprompt, Provider-Rohantwort, SVG.

**Nachweise.**

- Neue Tests: `tests/client/tutor-review-capture.test.ts` (über acht Antworten, Kontextwechsel, Einwände, Grafikentwurf mit Planerersetzung, Hilfen ohne Handles, Retry/Abbruch, fehlende/ungültige Serverdaten, Schlüssel und feindliche Texte, DEBUG aus/ein und Leeren, laufende Anfrage, Revisionswechsel, 100 Requests, 16 Kontexte, maximaler Mehrdatei-Sketch, 3 Mitschnitte, Antwort nach dem Leeren), `tutor-review-loader`, `tutor-review-panel` (Kopierfehler, inaktiver Text), `tutor-review-example` sowie `tests/server/routes/tutor-review.routes.test.ts` (echter Provider-Parser, Redaktion, keine Promptquellen, Wiederholungsersetzung, Opt-in, Replay, Blockgrenze).
- Browser: `e2e/tutor-review.spec.ts` mit neun Antworten über „Weiter“, Codewechsel, 600 zusätzlichen technischen Meldungen, aktiven Filtern, Tastatur bei XXL und echter UI-Kopie. Der Lauf zeigt, dass der technische Puffer das frühe `renderer: rendered` verdrängt, der Mitschnitt es aber enthält. Sein Export liegt als [Beispiel](../examples/tutor-review-example.txt) bei (103 KiB).
- `npm run check`, `npm run lint`, `npx knip` (ohne Befund), `npm run check:docs` bestanden. `npm run test:unit`: 4.319 bestanden, 1 übersprungen; Emulator 697 bestanden. Alle vier Tutor-Browserdateien: 24 bestanden.
- Startpfad: 726.900 Byte vor, 728.001 Byte nach der Änderung (Limit 745.000); Speicher, Export und Ansicht liegen nur in nachgeladenen Chunks.
- Sonar (`npm run sonar`, Analyse Nr. 255): Quality Gate bestanden, 0 neue Befunde, Coverage auf neuem Code 86,3 %. Der erste Lauf (Nr. 254) meldete 25 Befunde (Komplexität, verschachtelte Ausdrücke); sie wurden ohne Unterdrückung behoben.

**Selbstprüfung und Korrekturen.** Behoben wurden: ein Request-Handle hielt den Schlüssel nach einer verspäteten Antwort fort; ein lokaler Schritt einer gelöschten Epoche konnte einen neuen Mitschnitt beginnen; ein an der Grenze verworfener Antwortinhalt erschien später als abgeschlossen; die Übersicht verdeckte bei geringer Höhe die technische Ereignisliste. Eine Prüfung durch einen getrennten Agenten wurde nicht durchgeführt.

**Grenzen.** Eine App-Buildrevision gibt es nicht (`unknown`). Sketchfakten stehen je Request im Export und machen ihn bei vielen Schritten größer. Es gab keine echten Modellaufrufe; die Aufnahme ist mit kontrollierten Providern belegt. Bekannte Tutorfehler (Einstufung von Einwänden, Wiederholungen, unbelegte Aussagen) wurden nicht verändert, sondern sind jetzt im Mitschnitt prüfbar.

### Unabhängige Nachprüfung der Etappe 4

Die zuvor fehlende Prüfung durch einen getrennten Agenten wurde am 2026-11-11 nachgeholt, ergänzt durch direkte Reproduktionen des Hauptagenten. Ergebnis: **Nachbesserung erforderlich; Etappe 4 ist noch nicht abnahmebereit.** Der [Prüfbericht mit Gegenbeispielen](review-tutor-review-capture-2026-11-11.md) dokumentiert offene Lücken bei Secret-Bereinigung, tatsächlichen Exportgrenzen, zeilenreichen Kontexten, Historienzuordnung, Skip-Inhalten, Vollständigkeit, Blockgrößen und historischen Legendensätzen. Vier vorhandene Client-Suites bestanden erneut mit 24 Tests; die Gegenbeispiele sind darin noch nicht abgesichert. Die oben dokumentierten grünen Implementierungsläufe ersetzen diese fehlenden Regressionen nicht. Bei der Nachprüfung wurde kein Produktcode verändert.

### Nachbesserung nach der unabhängigen Prüfung (2026-11-11)

Die acht wesentlichen Befunde und der kleine Befund aus [der Nachprüfung](review-tutor-review-capture-2026-11-11.md) sind behoben und durch 13 neue Regressionen abgesichert (Tabelle dort). Belege nach der Nachbesserung: Coverage-Lauf 4.333 bestanden / 1 übersprungen, Emulator 402 bestanden / 295 übersprungen; Tutor-Browsertests 24 bestanden; Typprüfung, Lint, Knip und Dokumentation grün; Sonar-Gate bestanden; Startpfad unverändert 728.001 Byte. Das Beispiel wurde neu erzeugt.

Nach der zweiten Nachprüfung sind auch deren vier Restbefunde (Bereinigung der Regeltexte, Grenze der Regelsätze, Feldgrenzen nach Bereinigung, technische Ereignisse alter Epochen) behoben und durch 7 weitere Regressionen abgesichert; Einzelheiten im Prüfbericht.

Nach der dritten Nachprüfung sind auch deren drei Restbereiche behoben: Die Bereinigung ist idempotent mit einer gemeinsamen, beweisbaren Längengrenze für Collector, Transport, Store und Export; die Liste fehlender Regelsätze ist durch das Requestlimit begrenzt; lokale Anzeigeaktionen setzen eine im aktuellen Abschnitt erfasste Antwort voraus. 15 weitere Regressionen, davon Strecken- und Eigenschaftstests; Einzelheiten im Prüfbericht.
