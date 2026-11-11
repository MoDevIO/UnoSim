# Korrekturprompt für Opus: Tutor-Mitschnitt vor dem Commit abschließen

Stand: 2026-11-11. Der aktuelle Working Tree ist noch nicht freigegeben. Dieser Auftrag korrigiert den verbliebenen Befund der vierten Nachprüfung; er ist kein erneuter Gesamtumbau des Tutors.

---

Du arbeitest als Opus in `/Users/to/Documents/TT_Web/UnoSim`. Behebe den strukturellen Bereinigungsfehler des Tutor-Mitschnitts, prüfe die Korrektur und liefere einen belastbaren Abschlussbericht.

## Auftrag und Ausgangslage

Lies zuerst:

- `docs/proposals/review-tutor-review-capture-2026-11-11.md`, besonders „Vierte unabhängige Nachprüfung“.
- `docs/superpowers/specs/2026-11-11-tutor-debug-graphics-design.md`, §12.
- `docs/superpowers/prompts/2026-11-11-tutor-review-capture.md`.
- `ssot/ssot_agent_policy.md` und LearningQuestions-SSOT §12.7.

Alles liegt uncommittet auf `feature/tutor-debug-graphics`; der Ausgangscommit war `da65ea1b7478c2c8d394fbc0868ae93c74fd42be`. Prüfe den tatsächlichen aktuellen Stand, einschließlich unversionierter Dateien. Bewahre sämtliche vorhandenen Änderungen. Kein pauschales Restore, Reset, Stash, Branchwechsel oder Bereinigen fremder Dateien.

Die bisherigen Korrekturen zu Grenzen, Marker-Idempotenz, Historie, Replay, Kontexten, Legendensätzen und Erfassungsepochen müssen erhalten bleiben. Allgemeine Tutor-Didaktik und Fragenkataloge gehören nicht zu dieser Korrektur. Keine echten Modellanfragen und keine persönlichen Keys für Tests.

## Konkreter, bestätigter Fehler

`redactTutorReviewValue` maskiert rekursiv alle Stringwerte. Das trifft auch feste öffentliche Strukturcodes.

1. Der synthetische Request-Key `answer` ist nach dem Requestschema zulässig.
2. Eine gültige Lernantwort enthält `learnerInput: "answer"`.
3. Nach `receiveTutorReviewResponse` steht im gespeicherten Datensatz `learnerInput: "[REDACTED-CREDENTIAL]"`.
4. Der Export lässt sich erzeugen, scheitert aber an `tutorReviewExportSchema`: `steps[0].response.learnerInput`, `invalid_value`.
5. In der echten Collectorstrecke wird `{ kind: "classification", learnerInput: "answer" }` ebenfalls beschädigt: `entries: []`, `dropped: 1`.

Fundstellen: `shared/tutor-review.ts`, `server/services/tutor/tutor-diagnostics.ts` (`reportTutorReview`) und `client/src/lib/tutor-review-store.ts` (`responseRecord`, `redactedValue`, `serverRecord`).

## Erwartete Korrektur

- Trenne schemaerlaubte freie Inhalte ausdrücklich von festen öffentlichen Strukturcodes. Maskiere Credentials weiterhin vor der Speicherung in Fragen, Antworten, Rückmeldungen, Code, Headerdateiinhalten, Grafiktexten, freien Modell-/Kurskennungen und Regeltexten.
- Bewahre bereits gegen ihre festen Aufzählungen geprüfte Codes: etwa `learnerInput`, `questionStatus`, Antwortstil, Server-Entry-`kind`, Entscheidungsauslöser, Ergebnisquelle, Grafikstatus, feste Replay-/Auslassungsgründe und weitere tatsächlich vorhandene Strukturcodes.
- Untersuche sämtliche Aufrufstellen der generischen Bereinigung auf Server und Browser. Behebe die gemeinsame Ursache; baue keine Sonderbehandlung nur für das Wort `answer`.
- Eine Feldnamen-Ausnahme darf ungeprüfte externe Werte nicht durchlassen: erst erlaubte Struktur prüfen beziehungsweise aus festen Werten aufbauen, dann ausschließlich erlaubte freie Inhaltsfelder bereinigen. Unbekannte Felder und unzulässige Codes bleiben ausgeschlossen.
- Beliebige dynamische Bezeichner werden nicht allein dadurch öffentlich, dass sie „ID“ heißen. Beispielsweise sind freie Kurskennungen weiterhin zu bereinigen.
- Erweitere Enumfelder nicht zu beliebigen Strings, um nur die Validierung grün zu bekommen. Klassifikation und Struktur müssen für die Qualitätsprüfung erhalten bleiben.
- Präzisiere die Dokumentation: Eine zufällige Übereinstimmung mit einem festen öffentlichen Code ist wie beim öffentlichen Marker kein Übernehmen eines vertraulichen Schlüsselwerts aus einem Inhaltsfeld. Das ist keine Freigabe zum Speichern von Credentialfeldern, Headern oder Rohantworten.
- Erhalte Idempotenz, Markergrenzen, dieselbe Längenschranke in allen Verträgen, tatsächliche UTF-8-Budgets, vollständige Inhalte, sichtbare Unvollständigkeit und die Trennung von Diagnose und Lernschema.
- Diagnosefehler dürfen gültigen Lerninhalt nicht verändern oder blockieren.

Die genaue Modulaufteilung ist deine Implementierungsentscheidung. Bevorzuge eine nachvollziehbare, typisierte Auswahl erlaubter Inhaltsfelder statt einer wachsenden Liste nachträglicher Ausnahmen.

## Neue Regressionen

Bestehende Tests sind geschützt; ergänze neue Regressionen. Prüfe reale Datenwege, nicht nur einen isolierten Stringhelper:

1. **Collector → JSON → Browser-Laufzeit → Export** mit Key `answer`: Klassifikation bleibt `answer`, kein Eintrag wird deshalb verworfen, Export validiert. Derselbe Key in Frage/Feedback wird trotzdem maskiert.
2. **Lokaler Mitschnitt ohne Serverspur:** `learnerInput: answer`, `questionStatus: closed` und Antwortstil bleiben gültig; freie Inhalte werden maskiert. Prüfe den Store vor der Serialisierung.
3. Tabelle weiterer öffentlicher Codes, darunter `clarification`, `help`, `normal`, `philosophical`, `open`, `closed`, `draft`, `classification`, `planner-question`, `provider`, `kept` und `support-cache`, soweit sie in den tatsächlichen Schemas vorkommen. Jede Auswahl muss an einer fachlich passenden Stelle geprüft werden.
4. Unbekannte Strukturcodes werden abgelehnt und keine zusätzlichen Rohfelder übernommen.
5. Bestehende Gegenbeispiele erneut: kurze Keys, `ED` und andere Markerüberlappungen, langer bereinigter Text, 100 Regelstände, Größen-/Kontextgrenzen, Skip, Replay und Capturelimit → Clear → verspätete lokale/technische Ereignisse.

Prüfe nicht pauschal, ob der ganze JSON-Text das Wort `answer` enthält: Das Wort ist als öffentlicher Strukturcode und als Feldname legitim. Prüfe gezielt erlaubte freie Inhaltsfelder und die unveränderte Bedeutung der Strukturcodes.

Beobachte RED vor der Korrektur und GREEN danach. Notiere die konkrete Gegenprobe. Ändere keine bestehenden Erwartungen, um das Problem zu verdecken.

## Verifikation und Abschluss

- Führe die neuen Regressionen sowie die sechs vorhandenen Review-Client-Suites aus: `tutor-review-chain`, `tutor-review-findings`, `tutor-review-panel`, `tutor-review-capture`, `tutor-review-example`, `tutor-review-loader`.
- Führe die betroffenen Server-/Routentests, `npm run check`, `npm run lint`, `npx knip`, `npm run check:docs`, die erforderliche vollständige Unit-Prüfung und `npm run build` mit unverändertem Bundlebudget aus. Browserprüfungen laufen gegen den frisch gebauten Client.
- Prüfe `NODE_ENV=test UNOSIM_SERVER_MODE=local npm run sonar`. Ordne das Gate über die frische Analyse-ID zu. Fehlender Zugang oder nicht verfügbarer Sonarserver ist eine benannte Blockade, kein bestandenes Gate; keine Unterdrückungen oder abgeschwächten Budgets.
- Erzeuge bei verändertem Formatinhalt den bereinigten Beispielexport neu und validiere ihn. Dokumentiere Testzahlen mit bestanden/übersprungen und die tatsächlich gemessene Bundlegröße.
- Hole die bereits beauftragte unabhängige Nachprüfung der Korrektur ein. Das ist Teil dieses Auftrags und erfordert keine erneute allgemeine Freigabefrage. Fehlt die technische Möglichkeit, benenne das offen und behaupte keine unabhängige Prüfung.
- Aktualisiere Prüfbericht, Formatbeschreibung und gegebenenfalls den SSOT-Vertrag für die Unterscheidung freier Inhalte und öffentlicher Codes. Historische Befunde erhalten lassen, aktuellen Abnahmestand klar benennen.

Kein Commit, Push, Merge oder Cleanup während noch wesentliche Befunde offen sind. Liefere zunächst den konkreten korrigierten, geprüften Stand mit Aussage, ob der bisherige Gegenbeweis jetzt auf beiden Datenwegen geschlossen ist. Der Nutzer hat eine anschließende Git-Integration nur für einen freigegebenen Stand beauftragt; eine Prüfung oder ein Hook darf dafür nicht umgangen werden.
