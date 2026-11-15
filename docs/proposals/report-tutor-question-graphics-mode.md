# Arbeitsbericht: Grafiken für Tutorfragen immer anfordern

Stand: 2026-11-12. Branch `feature/tutor-question-graphics-mode`, Basis `1f5c59512`.
Auftrag: [freigegebener Entwurf](../superpowers/specs/2026-11-12-tutor-question-graphics-mode-design.md).

## Ergebnis

Settings → Tutor enthält **Grafiken immer anfordern**, standardmäßig aus und lokal gespeichert. Eine neue Aktion übernimmt den Modus vor ihrem ersten Await; Retry behält ihn samt Aktionskennung. Bei gesperrtem Browser-Speicher gilt die Auswahl wenigstens im aktuellen Tab. Laufende Anfragen ändern ihren Modus beim Umschalten nicht.

Der Primärprompt fordert im Modus `always` eine Grafik an. Erst nach der endgültigen Fragenwahl wird entschieden: passende, geprüfte Grafik übernehmen oder höchstens einen separaten Grafikaufruf ausführen. Der Zusatzaufruf bekommt dieselbe tatsächlich aufgerufene Modell-ID, denselben Zugang, Sketch mit Headern und Hauptdateinamen sowie den Boardkontext. Zurückgemeldete Modellversionen werden nicht als aufrufbare IDs verwendet. Der strikte Grafikoutput darf weder Frage noch Bewertung, Fortschritt oder Lernplan verändern.

Dies gilt für erste Fragen, neue Folgefragen und die nächste Frage nach Überspringen. Keine Nachforderung für Hilfe/Klärung, Musterantwort, offen gehaltene Frage, Abschluss ohne neue Frage, Weiter, Replay oder Rendererfehler. Bewertung und Fortschritt werden nach der Grafikstation höchstens einmal übernommen; Abbruch verhindert die Übernahme. Eine fehlgeschlagene Grafik erhält gültigen Lerninhalt und zeigt **Grafik konnte nicht bereitgestellt werden.** Eine spätere Rendererablehnung zeigt **Grafik konnte nicht dargestellt werden.**

Frage, Grafik und Hinweis bleiben bis Weiter zusammen zurückgehalten. Die explizite Grafik bzw. ihr Fehlerstatus bleibt serverseitig an die offene Frage und ihren Kontext gebunden, auch über mehrere schwache Antworten. Ein Kontextwechsel verwirft sie; eine neu akzeptierte Primärgrafik ersetzt den gespeicherten Zustand. Gespeichert wird höchstens eine bereits geprüfte Grafik (12.000 Zeichen) pro aktiver Frage unter den bestehenden Sitzungsgrenzen und Ablaufzeiten.

## Diagnose und Review

- Request: `graphicsMode: auto | always`; fehlendes Feld bedeutet Automatik. Unbekannte Werte werden abgewiesen.
- Antwort: app-eigener `graphicStatus: provided | unavailable`; Provider dürfen diesen Status nicht setzen.
- Diagnose: Modus und Zusatzversuch 0/1, Sicherheitsprüfung, Provider-/Rendererstationen.
- Review: Modus, Auslieferungsstatus und `graphic`-Entscheidungen mit endgültiger Frage, Zustand, Zusatzversuch, festem Grund und Grafikpromptrevision.
- Dieselben Bereinigungen, Größenlimits und Erfassungsepochen wie bisher. Kein weiterer Rohlog, keine SVG-Aufnahme.
- Grafikgenerierung zählt im CountingProvider zu Tutor-Generierungen, nicht zu Judge-Aufrufen.

Promptrevision ist `tutor-prompts-v11`; ihr Digest umfasst die neue bedingte Anforderung und `tutor-question-graphic-v1`. Die Automatikprompts bleiben inhaltlich unverändert. Genau eine bestehende Revisionspin-Assertion wurde aufgrund dieser tatsächlichen Revision migriert, wie im freigegebenen Entwurf erlaubt. Keine fachliche Assertion wurde abgeschwächt.

## Tests und unabhängige Prüfung

40 neue deterministische Tests in vier Dateien:

- `tests/server/services/tutor/tutor-question-graphics-mode.test.ts`: Requestgrenzen, Auto/Always, eine Nachforderung, Zusatzfelder/ungültiger Inhalt, Providerfehler, Modell/Alias/Auto-Zuordnung mit echtem Adapter, endgültige Lehrkraftfrage, Mehrdatei-/Boardkontext, Abbruch und Transaktionszustand, Skip/Retain/Abschluss, Diagnose und Evaluationsbudget.
- `tests/server/routes/tutor-graphics-mode.routes.test.ts`: echte HTTP-Routen, Hilfe/Klärung/Skip, unterstützter Dialog, Replay, Moduskonflikt sowie Grafikzustand über mehrere schwache Antworten und Kontextwechsel.
- `tests/client/tutor-question-graphics-mode.test.tsx`: Settings/Persistenz, blockierter Speicher, Rendererfehler und unveränderlicher Modus samt Aktionskennung bei Frage-/Dialog-/Support-Retry.
- `tests/client/tutor-graphics-review.test.ts`: gespeicherter und kopierter Modus, Status und bereinigte Grafikentscheidungen.

Drei neue Browserfälle in `e2e/tutor-question-graphics-mode.spec.ts` führen von Settings durch echte Tutor-Routen und den echten KI:connect-Adapter zu einem kontrollierten lokalen Modellendpunkt. DOM-Nachweis im Erfolgsfall: zwei beschriftete Knoten und eine Kante; Folgefrage/Grafik erst nach Weiter. Für zwei Fragen genau vier Generierungen, Weiter ohne weiteren Aufruf. Bei Grafikfehler genau eine Nachforderung, sichtbarer Fehlerhinweis und bedienbares Antwortfeld. Umschalten während einer gehaltenen Grafikantwort wirkt erst auf die nächste Aktion.

Eine unabhängige Leseprüfung mit frischem Kontext fand zwei P2-Befunde: Modellalias und verlorener Retainzustand. Beide wurden vor der Korrektur mit roten Regressionen reproduziert. Eine gezielte Nachprüfung bestätigte die Modellkorrektur und den Kontextreset und fand noch einen Retainverlauf (unavailable → neue Primärgrafik → weiterer schwacher Versuch). Auch dieser Verlauf ist nun als rote/grüne HTTP-Regression abgesichert; der Store merkt sich den tatsächlich ausgelieferten Zustand. Die letzte Store-Nachbesserung ist durch diese Regression, nicht durch eine dritte unabhängige Prüfung belegt.

Zusätzlich gefunden und behoben: fehlender Board-/Hauptdateikontext im ersten Zusatzaufruf, zusätzliche leere Serviceargumente bei alten Requests und ignorierte Auswahl bei gesperrtem localStorage. Bestehende Routenverträge wurden erhalten. Bei einer Testergänzung wurde eine Erwartung versehentlich mit der Fixtureoption überschrieben; die ursprüngliche unabhängige Erwartung `5` ist wiederhergestellt.

## Abschlussprüfungen

| Prüfung auf dem finalen Produktstand | Ergebnis |
| --- | --- |
| Neue Unit-/HTTP-/Clienttests | 40 neue Tests; zusammen mit den unveränderten Routentests 80 gezielt grün |
| `npm run test:tutor-quality` | 66 Dateien, 920 Tests; 5.619 ms von 15.000 ms |
| `npm run test:unit` | App 4.594 grün, 1 vorheriger Skip; Emulator 697 grün |
| Coverage im zweiten Sonar-Lauf | App 4.594 grün, 1 Skip; Emulator 402 grün, 295 Corpus-Skips wie konfiguriert |
| Sechs Tutor-Browserspecs, `--retries=0` | 32/32 grün auf dem neu gebauten finalen Stand |
| `npm run check` | bestanden |
| Lint | bestanden mit 8-GiB-Node-Heap, unveränderte Regeln |
| Beide Knip-Profile | bestanden, 0 neue Befunde |
| Build und Bundlebudget im Browser-Startpfad | bestanden; 728.156 Byte von 745.000, zuvor 728.052 |
| Sonar-Gate, zweite Analyse | PASSED / API `OK`; 0 neue Befunde; New-Code-Coverage 86.7 % |

Sonar-Analyse `8ab961ae-aeff-4c1e-9b4b-666bb1c63d1f`, Task `c957bc39-9242-4979-ab93-2cf05c8f3cf6`. Gate separat über die Analyse-ID verifiziert; kein Rückschluss allein aus dem Prozess-Exitcode. Dokumentationsprüfung und `git diff --check` sind als letzter Dokumentationsschritt bestanden.

Der erste Sonar-Lauf meldete sechs neue Befunde (native Statusausgabe, verschachtelte Templates, redundantes optionales undefined, Parameterzahl und Komplexität). Sie wurden ohne Unterdrückung durch native `output`-Elemente, einfachere Formatierung, präzisere Typen, die vorhandene Tupel-Signaturtechnik und gemeinsame Anfragekonfiguration korrigiert. Ein Lint-Lauf endete am Node-Heaplimit; der Wiederholungslauf mit `NODE_OPTIONS=--max-old-space-size=8192` besteht, ohne Änderung der Lintregeln.

## Grenzen und Arbeitsstand

Keine echten Tutor-, KI:connect- oder Judge-Modellaufrufe; Budget 0. Kontrollierte Antworten belegen Vertragslogik und Darstellung. Fachliche Passung, sinngemäßer Lösungsverrat und Verhalten echter Modelle bleiben durch eine getrennt beauftragte Live-Messung zu prüfen. Der Schalter garantiert eine ausdrückliche Anforderung, keine fachlich richtige oder garantiert darstellbare Grafik.

Änderungen bleiben uncommittet auf dem Featurebranch. Es gab keinen Push, PR oder Merge dieses Features.
