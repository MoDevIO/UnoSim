# Tutor-Review: Exportformat und Prüfcheckliste

Der Tutor-Review ist der lokale Mitschnitt eines Tutor-Testlaufs ([LearningQuestions §12.7](../ssot/ssot_function_definition_LearningQuestions.md)). Bei aktivem Debug-Modus erfasst der Browser jede Tutor-Anfrage mit dem tatsächlich gesendeten Code und der ausgelieferten Antwort. Der Server ergänzt Modellentwurf und Entscheidungen, sofern seine Diagnose aktiviert ist. **Copy Tutor review** im Debug-Tab (Kategorie *Tutor*) kopiert einen Mitschnitt vollständig, unabhängig von Nachrichtenfilter und Debug-Puffer.

Ein [Beispielexport](examples/tutor-review-example.txt) stammt aus einem kontrollierten Browserlauf mit neun Antworten und einem Codewechsel.

## Aufbau

Der Export ist UTF-8-Text in fester Reihenfolge. Protokoll und Legende sind deutsch.

1. **Kopf** (`=== UnoSim Tutor-Review · Format unosim-tutor-review v1 ===`): Mitschnitt-ID, Zeitraum, Aufnahmezustand, Vollständigkeit mit Gründen, Umfang, Größe in KiB, App-Revision, angezeigter Bewertungsdurchschnitt mit Anzahl und Bezugsfenster.
2. **Protokoll** (`== Protokoll ==`): ein Abschnitt `[n]` je Schritt in lokaler Reihenfolge. Er enthält Kontextverweis (`K1`, `K2` …), beantwortete Frage, Antwort, Einstufung, Bewertung, Feedback, Folgefrage, Grafik, Modell, Prompt-Revision und die Serverangaben (Entwurf, Entscheidungen, Sketchfakten).
3. **Codekontexte** (`== Codekontexte (so gesendet) ==`): jeder verschiedene gesendete Stand einmal, mit Board, Entry-Datei und Headern, ungekürzt.
4. **Legende** (`== Legende ==`): Bewertungsrubrik und Schwierigkeitsbänder aus denselben Texten, die der Tutor verwendet, dazu die Bedeutung aller Codes.
5. **JSON** (`== JSON ==`): derselbe Inhalt maschinenlesbar.
6. **Abschlussmarkierung** `=== ENDE UnoSim Tutor-Review v1 · runId … ===`. Fehlt sie oder lässt sich das JSON nicht lesen, ist die Kopie abgeschnitten und unvollständig.

Jede Inhaltszeile im Protokoll und in den Codekontexten beginnt mit `| `, damit kein Inhalt eine Abschnittsüberschrift vortäuschen kann. Steuerzeichen erscheinen als `⟦U+XXXX⟧`; im JSON stehen sie unverändert, nach JSON-Regeln escaped. Ein im Text gefundener Zugangsschlüssel ist vor der Speicherung durch `[REDACTED-CREDENTIAL]` ersetzt, unabhängig von seiner Länge und auch in Kurskennungen; die Anzahl steht im Kopf. Ein kurzer Testschlüssel kann dabei auch ein gleichlautendes Wort verdecken. Bereinigt werden ausschließlich freie Inhalte: Fragen, Antworten, Rückmeldungen, Erklärungen, Code, Dateinamen und Headerinhalte, Grafiktexte, Musterantworten, Regeltexte, Modell- und Kurskennungen, Fehlercodes des Servers sowie dynamische Lernkennungen (`topicId`, `conceptId`, `questionId`, `indicatorId`, `strategyId`, `contentRevision`). Feste öffentliche Codes werden zuerst gegen ihre Aufzählung geprüft und dann unverändert übernommen, unbekannte Werte entfallen, ebenso Zähler außerhalb ihres Bereichs (Support-Zähler, Fokusbereiche), weil der Mitschnitt die Antwort vor der Prüfung gegen das Lernschema erfasst: `responseStyle`, `learnerInput`, `questionStatus`, `questionKind`, `strategySource`, `learningPhase`, Support-`outcome`, Fokus-`state`, Referenz-`status`/`reason`, `board`, Server-`kind`, `trigger`, `followUpSource`, `graphic`, `omitted` und Replay-`reason`. Stimmt ein Schlüssel zufällig mit einem solchen Code überein, steht dort weiterhin der Code: Er stammt aus der festen Aufzählung, nicht aus einem Inhaltsfeld, und verrät so wenig wie der öffentliche Marker. Das erlaubt nicht, Zugangsfelder, Header oder Rohantworten zu speichern. Die Bereinigung lässt vorhandene Marker unberührt; ein zweiter Durchlauf (Server, dann Browser) ändert deshalb nichts mehr. Wäre ein Schlüssel über den Rand eines Markers hinweg sichtbar, wird der ganze Text zu einem Marker. Bereinigte Texte werden nie gekürzt: Jede ersetzte Schreibweise hat mindestens ein Zeichen und wird zu einem Marker mit 21 Zeichen, also gilt in Servercollector, Transport, Store und Export dieselbe Feldgrenze von ursprünglicher Grenze mal 21. Lernkennungen sind im Export freier Text statt Slug.

## JSON-Felder

| Feld | Bedeutung |
| --- | --- |
| `format`, `formatVersion`, `runId` | `unosim-tutor-review`, Version `1`, zufällige Mitschnitt-ID. |
| `capture` | `status` (`recording`, `stopped`, `finished`), `complete`, `incompleteReasons`, `stoppedReason`, `sanitizedTexts`, `notCapturedActions`, `openSteps`, `requestAttempts`. |
| `legend` | Regelstand des Clients `guidanceRevision` mit `ratingRubric` und `difficultyGuidance`; `confirmation` (`confirmed-by-server`: jeder Serverblock nannte dieselbe Revision mit denselben Texten; `differs-from-server`; `client-only`: kein Serverblock); `serverSets[]`: vom Server gemeldete abweichende Regelsätze mit `guidanceRevision` und ihren (bereinigten) Texten, höchstens 16; `missingServerSets[]`: Revisionen, deren Texte an dieser Grenze nicht mehr erfasst wurden (höchstens so viele wie Requests, also vollständig) (der Mitschnitt ist dann mit `capture-limit` unvollständig, der Schritt sagt „Regeltexte nicht erfasst“). Ein Schritt nennt seinen Regelsatz unter `server.guidanceRevision`; ohne Serverdaten sind seine Regeln unbekannt. |
| `contexts[]` | `contextId`, `board`, `entryFile`, `code`, `headers[]` mit `name` und `content`: der Stand, den Requests tatsächlich gesendet haben. |
| `importedHistory[]` | Wörtlich erhaltene mitgesendete Dialogeinträge mit `importId` und `reason`: `before-capture` (vor Beginn des Mitschnitts entstanden) oder `ambiguous` (mehrere erfasste Schritte enthalten genau diesen Turn, keiner steht eindeutig dafür). |
| `steps[]` | Schritte in Reihenfolge, siehe unten. |

Ein Schritt hat `stepId`, `sequence`, `at` (Browserzeit), `kind`, `status` und optional:

- `kind`: `question` (neue Frage), `answer` (Antwort im Dialog), `support` (Lernhilfe: `request.action` = `clarify`, `hint`, `reveal`, `skip`), `models` (Modellliste), `held` (nächste Frage bis „Weiter“ zurückgehalten), `displayed` (nach „Weiter“ angezeigt), `reset` (neue Lernrunde oder Kontextwechsel), `rating-summary` (angezeigter Durchschnitt).
- `status`: `open` (noch ohne Antwort), `completed`, `failed`, `aborted`, `recorded` (lokaler Schritt).
- `traceId`, `requestId`, `attempt`, `relatesTo`: Eine Wiederholung derselben Aktion hat dieselbe `traceId`, `attempt` > 1 und `relatesTo` auf den ersten Versuch. Lokale Schritte verweisen mit `relatesTo` auf ihren Request.
- `contextId`: der gesendete Codekontext.
- `request`: `endpoint`, `action`, `askedQuestion` (die beantwortete Frage), `answer`, `difficulty`, `requestedModel`, `courseContent` (nur Kennungen), `continuesCourseSession`, `history[]`. Ein Historieneintrag verweist mit `{ stepId }` auf den einzigen abgeschlossenen Antwortschritt mit derselben Frage, Antwort, demselben Feedback und derselben Bewertung, in Reihenfolge der Historie; sonst mit `{ importId }` auf seinen wörtlichen Eintrag.
- `response`: das Ausgelieferte, also `question` (bei `answer` die Folgefrage), `feedback`, `answerRating`, `responseStyle`, `learnerInput`, `questionStatus`, `topic`, `difficulty`, `mermaid`, `model`, `explanation`, `reference` (nur eine gezeigte Musterantwort), `next` (nach einem Überspringen die nächste Frage mit `question`, `feedback`, `topic`, `difficulty`, `mermaid`, `learning`, `focusProgress`), `completed`, `learning` (Themen-, Fragen- und Strategiekennungen, Kursrevision), `support` (Zähler ohne Handles), `focusProgress`.
- `server`: `status` (`received`, `unavailable`, `invalid`, `disabled`), `promptRevision` (`id`, `templateDigest`), `guidanceRevision`, `dropped` (vom Server an seiner Grenze verworfene Einträge), `entries[]`. Ein Block über 128 KiB, mit falschem Schema oder fremder Trace-/Request-ID gilt als `invalid`:
  - `draft`: normalisierter Modellentwurf je Versuch (Frage, Feedback, Bewertung, Antwortstil, Thema, Schwierigkeit, Mermaid). Überlange oder falsch typisierte Grafikfelder fehlen; die technischen Ereignisse nennen dann den Grund.
  - `decision`: `trigger` mit `before` und `after`, gesetzt an der tatsächlichen Entscheidungsstelle.
  - `outcome`: Ergebnisquelle (`provider`, `planner`, `application-fallback`), `retained`, `withoutProvider`, endgültige Frage, Grafik `kept`, `discarded` oder `none`.
  - `classification`: Einstufung der Eingabe durch den Server.
  - `facts`: die deterministischen Sketchfakten des Prompts als JSON-Text.
  - `replay`: ein wiederholtes gespeichertes Ergebnis ohne neuen Modellaufruf.
- `failure`: `httpStatus`, fester `code`.
- `events[]`: die technischen Diagnoseereignisse dieses Requests (Modell, Dauer, Grafikstationen bis `renderer: rendered`).

## Vollständigkeit und Grenzen

Ein Mitschnitt ist für seinen erfassten Zeitraum vollständig oder nennt feste Gründe: `capture-started-late`, `capture-disabled`, `capture-limit` (auch für verlorene technische Ereignisse, nicht mehr erfasste Regelsätze und gesendete Dateien jenseits der Requestgrenzen, deren Kontext nicht aufgenommen wird), `server-review-unavailable`, `review-invalid`, `server-review-truncated` (Server hat Einträge verworfen oder Sketchfakten ausgelassen), `request-aborted`. Es gelten höchstens 3 Mitschnitte, 8 MiB Export je Mitschnitt und 24 MiB insgesamt, 100 Requests und 16 Kontextstände je Mitschnitt sowie 2 MiB je Kontext. Die Aufnahme rechnet jeden Inhalt mit einer oberen Schranke seiner gerenderten Größe (Markierungen, Zeilenpräfixe und JSON-Escapes eingeschlossen) und endet an einer Grenze sichtbar; danach nicht erfasste Aktionen werden gezählt. Ein Export über 8 MiB wird nie ausgegeben, auch nicht gekürzt; die Kopieraktion meldet dann einen Fehler. Nicht erfasst werden Zugangsschlüssel, Header, Handles, Idempotenzschlüssel, nicht gezeigte Musterlösungen, vollständige Prompts, Provider-Rohantworten und SVG.

Brechende Formatänderungen erhöhen `formatVersion`. Kompatible Ergänzungen fügen optionale Felder hinzu.

## Prüfcheckliste

- **Fragebezug:** Ist jede Frage am damaligen Codekontext (`K…`) belegbar und eindeutig? Nennt sie die gemeinte Variable oder Stelle?
- **Bewertung:** Passt `n/5` zur Rubrik und zur *beantworteten* Frage, nicht zur Folgefrage?
- **Rückfragen:** Wurde eine Rückfrage oder ein Einwand als `answer` eingestuft und bewertet, obwohl `clarification` oder `help` zutreffend wäre?
- **Wiederholung:** Kommt nach einer guten Bewertung dieselbe Frage erneut? Welche `decision` steht dabei?
- **Fachliche Aussagen:** Stimmen Feedback und Fragen mit dem Code überein, etwa behauptete `Serial`-Ausgaben?
- **Kontextwechsel:** Beziehen sich Schritte nach einer Codeänderung auf den neuen Kontext?
- **Grafiken:** Passt eine gelieferte Grafik zur Frage? Warum wurde ein Entwurf verworfen (`decision`, `outcome: discarded`)? Hätte eine Grafik bei einer Ablauf- oder Zustandsfrage geholfen?
- **Vollständigkeit:** Welche Lücken nennt der Kopf, und betreffen sie die geprüfte Stelle?
