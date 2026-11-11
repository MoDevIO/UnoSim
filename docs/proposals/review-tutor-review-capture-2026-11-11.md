# Unabhängige Nachprüfung: Tutor-Mitschnitt, Etappe 4

Stand: 2026-11-11. Nicht normativ. Ergebnis: **Nachbesserung erforderlich; noch nicht abnahmebereit.**

Aktueller Stand nach der vierten unabhängigen Nachprüfung: Die zuletzt offenen drei Restbereiche sind geschlossen; offen bleibt die unten dokumentierte Bereinigung fester Strukturcodes. Frühere Befunde und Nachbesserungen bleiben als Prüfverlauf erhalten.

Geprüft wurde der uncommittete Working Tree auf `feature/tutor-debug-graphics`, einschließlich unversionierter Dateien. Basis und HEAD: `da65ea1b7478c2c8d394fbc0868ae93c74fd42be`. Maßstab: [Konzept §12](../superpowers/specs/2026-11-11-tutor-debug-graphics-design.md), [Umsetzungsprompt](../superpowers/prompts/2026-11-11-tutor-review-capture.md) und LearningQuestions-SSOT §12.7.

Die unabhängige Prüfung erfolgte durch einen getrennten Agenten mit frischem Kontext; der Hauptagent prüfte zusätzlich Secret-Ausschluss, Vollständigkeit und konkrete Grenzfälle. Produktcode und bestehende Tests wurden bei dieser Nachprüfung nicht verändert. Reproduktionen verwendeten ausschließlich synthetische Daten und lokale Modulaufrufe, keine Provideranfragen oder echten Zugangsdaten.

## Tragfähige Grundlagen

Inhaltsstore, technische Diagnose und Lernschemas sind getrennt. Der Codekontext stammt aus dem tatsächlich gesendeten Request. Der Serializer erstellt eine Momentaufnahme, Serverentscheidungen sind an ihren tatsächlichen Entscheidungsstellen instrumentiert und Debugdetails verwenden Textdarstellung. Die gemeinsame Rubrikquelle benötigt keinen Clientimport des Serverprompts.

## Offene wesentliche Befunde

### 1. Bekannte Zugangsdaten gelangen in den Mitschnitt

Fundstellen: [credentialSpellings](../../shared/tutor-review.ts), [requestRecord](../../client/src/lib/tutor-review-store.ts).

- `credentialSpellings` überspringt Schlüssel mit weniger als acht Zeichen vollständig. Ein sechsstelliger Test-Key ist nach `tutorQuestionRequestSchema` zulässig und bleibt im Antworttext sowie im Reviewstore unverändert. Direkte Reproduktion: `credentialAccepted: true`, `secretInStore: true`, `redactionCount: 0`.
- `requestRecord` übernimmt `courseContent.repository`, `ref`, `revision` und `exampleId` ohne die sonst angewendete Bereinigung. Ein langer Test-Key in `ref` bleibt im Store, während derselbe Key im Frage-/Feedbacktext entfernt wird.

Erforderlich: Alle unterstützten nichtleeren Zugangsdaten unabhängig von einer angenommenen Mindestlänge bereinigen; sämtliche erlaubten Textfelder vor Übernahme durch dieselbe Bereinigung führen. Neue Regressionen müssen den Store vor dem Export prüfen.

### 2. Das tatsächliche Exportlimit wird erheblich überschritten

Fundstellen: Größenschätzung und `reserve` in [tutor-review-store.ts](../../client/src/lib/tutor-review-store.ts), [buildTutorReviewExport](../../client/src/lib/tutor-review-export.ts).

Reproduktion: acht verschiedene Kontexte mit `code: "//" + i + "\u2028".repeat(128000)` und Board `uno`. Alle Requests erfüllen das Tutorschema und bleiben unter dem RESTlimit. Ergebnis:

| Messgröße | Byte |
| --- | ---: |
| Store-Schätzung | 6.171.232 |
| Tatsächlicher Export | 15.372.191 |
| Erlaubter vollständiger Export | 8.388.608 |

Der Mitschnitt bleibt dabei `recording`. Die Formel `2 * JSON-Bytes + 1024` berücksichtigt die Expansion der sichtbaren Steuerzeichenmarkierungen und Textpräfixe nicht ausreichend. Eine tatsächliche abschließende Größenbegrenzung fehlt ebenfalls.

Erforderlich: Formatierungsbeiträge korrekt inkrementell zählen oder eine belegbar sichere Obergrenze verwenden; auch den endgültigen Gesamttext begrenzen. Regressionen mit zeilenreichen und Unicode-haltigen Inhalten ergänzen.

### 3. Zulässiger Mehrdatei-Kontext bricht den Export ab

Fundstellen: `contextLines` in [tutor-review-export.ts](../../client/src/lib/tutor-review-export.ts), Aufbereitung in [tutor-review-panel.tsx](../../client/src/components/features/tutor-review-panel.tsx).

Reproduktion des Hauptagenten: Code mit 100.000 Zeilenumbrüchen und zwölf Headern mit je 32.000 Zeilenumbrüchen; Requestschema gültig, JSON-Body 968.488 Byte und damit unter 1 MiB. `buildTutorReviewExport` wirft `RangeError: Maximum call stack size exceeded`. Ursache ist das Anhängen sehr großer Arrays als Funktionsargumente über `lines.push(...block(...), ...headers.flatMap(...))`.

Der Größen-Timer fängt diesen Serialisierungsfehler nicht ab. Auch die Kopierfunktion baut den Export vor ihrem `try` auf.

Erforderlich: Große Zeilenlisten iterativ verarbeiten und Serialisierungsfehler in der Oberfläche isolieren; einen zulässigen zeilenreichen Mehrdatei-Sketch als Regression verwenden.

### 4. Gesendete Historie wird falsch rekonstruiert

Fundstelle: `historyRefs` in [tutor-review-store.ts](../../client/src/lib/tutor-review-store.ts).

Reproduktion: zweimal dieselbe Frage und dieselbe Antwort, aber unterschiedliche Rückmeldungen und Bewertungen. Der nächste Request sendet den zweiten Turn in seiner Historie. Der Export verweist auf den ersten Schritt, weil die Suche nur Frage und Antwort vergleicht und den ersten Treffer nimmt. Damit erscheint falsches Feedback beziehungsweise eine falsche Bewertung als tatsächlich mitgesendeter Modellkontext.

Erforderlich: Den vollständigen gesendeten Turn vergleichen und die passende abgeschlossene Instanz bestimmen. Ist keine eindeutige Zuordnung möglich, den genauen Historieneintrag als eigenen Datensatz erhalten.

### 5. Skip verliert Inhalte der ausgelieferten nächsten Frage

Fundstelle: `responseRecord` in [tutor-review-store.ts](../../client/src/lib/tutor-review-store.ts).

Eine schemafähige Supportantwort mit `action: "skip"` und `next` einschließlich Frage, Mermaid, Schwierigkeit, Thema und Strategie wird auf Modellname und `nextQuestion` reduziert. Besonders bei deaktivierter Serverspur fehlt dadurch der Grafikquelltext vollständig, obwohl die nächste Frage mit Grafik im Lernbereich angezeigt werden kann.

Erforderlich: Alle erlaubten ausgelieferten Inhalte von `next` vollständig und eindeutig zugeordnet aufnehmen. Regression mit grafiktragender Skipantwort ohne Serverdiagnose ergänzen.

### 6. Unvollständige Serverdaten werden als vollständig bezeichnet

Fundstellen: `serverRecord` in [tutor-review-store.ts](../../client/src/lib/tutor-review-store.ts), `tutorReviewRecord` in [tutor-review-export.ts](../../client/src/lib/tutor-review-export.ts).

Direkte Reproduktion: Ein gültiger Serverumschlag mit `entries: []` und `dropped: 1` wird aufgenommen. Der Export enthält `server.dropped: 1`, zugleich aber `capture.complete: true` und leere `incompleteReasons`.

Erforderlich: Fehlende Serverevidenz in den Vollständigkeitsstatus übernehmen, einschließlich gezielt ausgelassener erforderlicher Daten. Ein Hinweis tief in den Details ersetzt keinen korrekten Berichtskopf.

### 7. Empfangene Serverblöcke werden nicht auf ihr Bytelimit geprüft

Fundstellen: `tutorReviewEnvelopeSchema` in [tutor-review.ts](../../shared/tutor-review.ts), `serverRecord` in [tutor-review-store.ts](../../client/src/lib/tutor-review-store.ts).

Reproduktion des unabhängigen Prüfers: ein formal gültiger Umschlag mit 64 Drafts und je 12.000 Zeichen Mermaid, insgesamt 771.024 Byte. Der Browser akzeptiert und speichert alle Einträge als `received`; erlaubt sind höchstens 131.072 Byte. Die Begrenzung des eigenen Servercollectors ersetzt die vorgeschriebene clientseitige Prüfung empfangener Blöcke nicht.

Erforderlich: Tatsächliche UTF-8-Größe prüfen und übergroße Blöcke als `review-invalid` verwerfen; gültigen Lerninhalt weiterverwenden.

### 8. Historische Legendensätze werden nicht erfasst

Fundstellen: Legendenfelder in [tutor-review.ts](../../shared/tutor-review.ts), `tutorReviewRecord` in [tutor-review-export.ts](../../client/src/lib/tutor-review-export.ts).

Die Texte der Rubrik und Schwierigkeit stammen beim Export stets aus den aktuellen Clientkonstanten. Der Serverblock enthält nur eine `guidanceRevision`. Bei einem Wechsel v1 → v2 bleiben die Texte von v2 unbekannt; der Bericht zeigt ausschließlich v1 und einen globalen Abweichungshinweis. Der vorhandene Test prüft lediglich verschiedene Revisionsnamen und diesen Hinweis. Die geforderten unveränderlichen, pro Request passenden Legendensätze fehlen.

Erforderlich: Legendensätze mit Revision erfassen und je Request referenzieren; nicht verfügbare Regeln requestbezogen als unbekannt ausweisen.

## Kleinerer Befund

Eine bereits geöffnete Detailansicht eines laufenden Schritts kann nach eintreffender Antwort veralteten Text behalten. `StepDetails` memoisiert anhand von `run` und `step`, während der Store dieselben Objekte mutiert. Die Zusammenfassung aktualisiert sich, die Memoabhängigkeiten ändern sich nicht. Eine Schrittversion oder unveränderliche Stepobjekte lösen das. Dieser Befund folgt aus dem Codepfad; ein eigener DOM-Reproduktionstest wurde dafür noch nicht ausgeführt.

## Verifikation und Abgrenzung

- Frisch ausgeführt: `vitest run --project=unit-client` für `tutor-review-capture`, `tutor-review-example`, `tutor-review-loader` und `tutor-review-panel`: **4 Dateien, 24 Tests bestanden**.
- Zusätzlich wurden die oben beschriebenen Gegenbeispiele direkt mit `node --import tsx --input-type=module` reproduziert. Sie zeigen Lücken trotz grüner vorhandener Tests.
- Die gemeldeten vollständigen Unit-, Browser-, Build- und Sonarläufe wurden für diese lesende Nachprüfung nicht wiederholt. Ihr Ergebnis wird dadurch weder widerlegt noch als unabhängiger Nachweis aller Grenzfälle ausgegeben.
- Fragenqualität, Fehlklassifikationen und fachlich falsche Tutorbewertungen wurden nicht repariert; das ist ausdrücklich außerhalb dieser Etappe. Die frühere Diagnoseintegration wurde nur im Zusammenhang mit dem neuen Mitschnitt betrachtet.

Die unabhängige Prüfung ist damit nachgeholt. Die wesentlichen Befunde bleiben vor einer Abnahme zu beheben und durch neue Regressionen abzusichern; die bisherige Aussage, die fehlende unabhängige Prüfung sei die einzige Abweichung, ist nicht bestätigt.

## Nachbesserung (2026-11-11)

Alle Befunde wurden behoben. Jede Regression prüft den Store vor dem Export oder das Verhalten der Oberfläche; die Gegenbeispiele oben sind als Tests in [tutor-review-findings.test.ts](../../tests/client/tutor-review-findings.test.ts) und [tutor-review-panel.test.tsx](../../tests/client/tutor-review-panel.test.tsx) enthalten.

| Befund | Behebung | Regression |
| --- | --- | --- |
| 1. Zugangsdaten | Keine Mindestlänge mehr; zusätzlich die Schreibweise „wie gesendet“. `courseContent` läuft durch dieselbe Bereinigung. | Sechsstelliger Schlüssel in Code, Header, Kurskennungen, Frage, Antwort, Historie und Feedback; der Store enthält ihn vor dem Export nicht. |
| 2. Exportlimit | Neue obere Schranke `tutorReviewExportBytes` in [tutor-review-text.ts](../../client/src/lib/tutor-review-text.ts), die Markierungen, Zeilenpräfixe und JSON-Escapes je Text zählt und dieselbe Markierungsfunktion wie der Export verwendet. Ein Export über 8 MiB wird abgewiesen (`TutorReviewExportTooLargeError`), nie gekürzt. | Zeilentrenner, Steuerzeichen und Zeilenumbrüche je zwölf Kontexte: Aufnahme stoppt mit `capture-limit`, Export ≤ 8 MiB, Schranke ≥ tatsächliche Größe. |
| 3. Mehrdatei-Sketch | Zeilenlisten werden iterativ angehängt; Größenanzeige und Kopie fangen Aufbaufehler ab und melden sie, ohne den Debug-Tab zu stören. | 100.000 Codezeilen plus zwölf Header mit je 32.000 Zeilen; Panel mit nicht exportierbarem Lauf zeigt den Fehler und kopiert nichts. |
| 4. Historie | Abgleich aller gesendeten Turnfelder (Frage, Antwort, Feedback, Bewertung, Antwortstil) gegen abgeschlossene Schritte, in Historienreihenfolge. Nicht eindeutige Einträge bleiben wörtlich mit `reason: ambiguous`, ohne `capture-started-late`. | Gleiche Frage und Antwort mit verschiedenen Bewertungen; zwei völlig gleiche Turns. |
| 5. Skip | `response.next` mit Frage, Feedback, Thema, Schwierigkeit, Mermaid, Lernmetadaten und Fokusstand; lesbar unter „Nächste Frage“. | Skip mit Grafik und Metadaten ohne Serverblock. |
| 6. Vollständigkeit | Neuer Grund `server-review-truncated` bei `dropped > 0` oder ausgelassenen Sketchfakten; verlorene technische Ereignisse setzen `capture-limit`. | Block mit `dropped: 1` und Block mit `facts.omitted`. |
| 7. Blockgröße | Der Browser misst die UTF-8-Größe jedes empfangenen Blocks und verwirft Blöcke über 128 KiB als `invalid`; der Lerninhalt bleibt. | 64 Entwürfe mit je 12.000 Zeichen Mermaid. |
| 8. Legendensätze | Der Serverblock trägt die Regeltexte (`guidance`). Abweichende Sätze stehen unter `legend.serverSets`, jeder Schritt nennt seine Revision; ohne Serverdaten steht am Schritt „Bewertungsregeln dieses Requests unbekannt“. Bestätigt ist die Legende nur, wenn Revision und Texte übereinstimmen. | Wechsel v1 → v2 mit eigenen Texten; Routentest prüft die Texte im echten Serverblock. |
| Kleiner Befund | `StepDetails` formatiert bei jeder Store-Version neu. | Geöffneter laufender Schritt zeigt nach Eintreffen der Antwort den neuen Inhalt. |

SSOT §12.7 und [das Exportformat](../tutor-review-format.md) beschreiben die neuen Felder und Regeln. Das [Beispiel](../examples/tutor-review-example.txt) wurde aus einem frischen Browserlauf neu erzeugt.

## Zweite unabhängige Nachprüfung der Nachbesserung (2026-11-11)

Ergebnis: **Die ursprünglichen Gegenbeispiele sind behoben; vier verbleibende beziehungsweise neu entstandene Lücken verhindern die Abnahme weiterhin. Noch nicht commitreif.** Die Nachprüfung erfolgte wieder lesend durch den getrennten Prüfer und ergänzende Reproduktionen des Hauptagenten. Kein Produktcode, Test, Index oder Branch wurde dabei verändert.

Bestätigt wurden insbesondere der reparierte Unicode-Grenzfall (7.691.135 Byte tatsächlicher Export bei 7.733.640 Byte konservativer Schranke), der zuvor abbrechende Mehrdatei-Kontext (4.363.675 Byte Export ohne Exception), der vollständige Historienabgleich, die verschachtelten Skip-Inhalte, die Blockgrößenprüfung, der Vollständigkeitsstatus für verlorene Servereinträge und die Aktualisierung geöffneter Details. Die erklärte Änderung des noch unveröffentlichten Formats innerhalb Version 1 wurde für diese Prüfung akzeptiert.

### A. Neue Legendensätze umgehen die Bereinigung

Fundstelle: `serverRecord` und `keepGuidance` in [tutor-review-store.ts](../../client/src/lib/tutor-review-store.ts).

Der neue `guidance`-Inhalt wird ohne Credentialbereinigung an `keepGuidance` übergeben; lediglich `entries` durchlaufen `redactedValue`. Ein gültiger, korrekt zugeordneter Umschlag mit einem bekannten langen synthetischen Request-Key in `guidance.ratingRubric` führt zu `inStore: true`, `inExport: true`, `sanitized: 0`.

Erforderlich: Auch die neu erlaubten Regeltexte vor Speicherung bereinigen und die Bereinigungen zählen. Regression direkt gegen `run.guidanceSets` und anschließend gegen den Export ergänzen.

### B. Die Grenze für Legendensätze verschweigt fehlende Regeln

Fundstelle: `keepGuidance` in [tutor-review-store.ts](../../client/src/lib/tutor-review-store.ts).

17 gültige Requests mit jeweils anderem Regelstand ergeben 16 gespeicherte Sätze. Schritt 17 nennt `guide-16`, dessen Texte fehlen. Trotzdem bleibt `capture.complete: true` bei leeren `incompleteReasons`; der Grenzfall wird durch ein stilles `return` behandelt.

Erforderlich: An dieser Grenze die Aufnahme sichtbar stoppen oder den nicht aufgenommenen Regelstand eindeutig als fehlende Evidenz kennzeichnen. Ein Schritt darf nicht ohne entsprechenden Hinweis auf nicht gespeicherte Regeln verweisen.

### C. Bereinigungsmarker verletzen die Feldgrenzen des Exportschemas

Fundstelle: `redactedText` in [tutor-review-store.ts](../../client/src/lib/tutor-review-store.ts) und Textgrenzen in [tutor-review.ts](../../shared/tutor-review.ts).

Reproduktion: eine zulässige Antwort aus 333 Wiederholungen eines sechsstelligen Test-Keys, insgesamt 1.998 Zeichen. Nach dem Ersetzen durch `[REDACTED-CREDENTIAL]` stehen 6.993 Zeichen im Store. Das Secret ist entfernt, aber der erzeugte Export scheitert am eigenen `tutorReviewExportSchema`: `steps[0].request.answer`, `too_big`. Die vorhandenen Feldgrenzen werden vor der expandierenden Ersetzung angewendet.

Erforderlich: Bereinigte Texte müssen eine ausdrücklich begrenzte, schemafähige Darstellung behalten und korrekt gegen das Gesamtbudget gerechnet werden. Nicht still nachträglich Inhaltsanteile abschneiden. Regressionen müssen die Schemafähigkeit nach wiederholter Ersetzung prüfen, zusätzlich zur Abwesenheit des Secrets.

### D. Technische Ereignisse alter Requests erscheinen nach Leeren oder DEBUG aus/ein erneut

Fundstelle: `receivePayload`, `forwardServerDiagnostics`, `report` und `bindTutorDiagnosticResponse` in [tutor-diagnostic-runtime.ts](../../client/src/lib/tutor-diagnostic-runtime.ts).

Reproduktion: einen Tutor-Request starten, danach `clearTutorReview()` beziehungsweise DEBUG aus/ein auslösen, erst anschließend die Antwort lesen und binden. Der Reviewstore verwirft die veraltete Antwort korrekt. Trotzdem werden drei alte Ereignisse an `document` weitergegeben: `service/request/completed`, `frontend/request/received` und `frontend/request/completed`. Der normale Debug-Listener nimmt sie wieder auf.

Die Erfassungsepoche wird im Inhaltsstore geprüft; der technische Dispatch prüft lediglich, ob DEBUG gerade an ist. Er ist damit nach dem Leeren beziehungsweise Wiedereinschalten wieder freigegeben.

Erforderlich: Die gemeinsame Gültigkeitsgrenze für alte Requestkontexte auch auf technische Weiterleitung und lokale Abschlussereignisse anwenden. Regressionen müssen den normalen Debug-Puffer beziehungsweise Event-Dispatch prüfen und nicht nur einen leeren Reviewstore.

### Frische Nachweise und Prüfgrenzen

- Hauptagent: fünf Client-Suites (`tutor-review-findings`, `tutor-review-panel`, `tutor-review-capture`, `tutor-review-example`, `tutor-review-loader`): **37 Tests bestanden**, keine übersprungen.
- Unabhängiger Prüfer: `tutor-review-findings` und `tutor-review-panel`: **15 Tests bestanden**, keine übersprungen. Diese Teilmenge ist in den 37 Tests enthalten und wird nicht hinzuaddiert.
- Die neuen Gegenbeispiele wurden direkt mit synthetischen Daten über `node --import tsx --input-type=module` reproduziert. Für den technischen Dispatch genügte ein lokaler `EventTarget` mit kontrollierter Fetchantwort; es gab keinen Netzwerk- oder Provideraufruf.
- Vollständiger Build, Sonar und Browser-/Clipboardabnahme wurden für diese gezielte lesende Nachprüfung nicht erneut ausgeführt. Allgemeine Tutor-Didaktik blieb außerhalb des Auftrags.

Empfehlung: Die vier Restbefunde mit gezielten Regressionen beheben, danach erneut gegen diese konkreten Fälle prüfen und erst anschließend committen. Grüne vorhandene Prüfungen bestätigen die nachgebesserten Gegenbeispiele, decken diese zusätzlichen Fälle aber noch nicht ab.

## Zweite Nachbesserung (2026-11-11)

| Befund | Behebung | Regression |
| --- | --- | --- |
| A. Legendensätze | `guidance` läuft vor `keepGuidance` durch dieselbe Bereinigung; Ersetzungen werden gezählt. | Schlüssel in `ratingRubric`: geprüft gegen `run.guidanceSets`, Zähler und Export. |
| B. 17. Regelstand | Grenze `TUTOR_REVIEW_LIMITS.guidanceSets` (16). Ein weiterer Satz setzt `capture-limit`, steht unter `legend.missingServerSets`, der Schritt zeigt „Regeltexte nicht erfasst: Grenze erreicht“, und die Legende gilt nicht als bestätigt. | 17 verschiedene Regelstände. |
| C. Feldgrenzen | Bereinigte Texte werden nie gekürzt. Ihre Exportgrenze ist die ursprüngliche Grenze mal Markerlänge (jede ersetzte Schreibweise hat mindestens ein Zeichen); Lernkennungen sind im Export freier Text. Die Größenschranke rechnet den gespeicherten, bereits expandierten Text. | 333 × sechsstelliger Schlüssel (1.998 Zeichen): 333 Marker, schemagültiger Export; Schlüssel in einer Lernkennung. |
| D. Alte technische Ereignisse | Jeder Requestkontext merkt sich die Erfassungsepoche. `report` und die Weiterleitung der Serverereignisse verwerfen Ereignisse einer beendeten Epoche, also auch lokale Abschluss- und Rendererereignisse. | Clear sowie DEBUG aus/ein während eines laufenden Requests mit Serverereignissen und Grafik: kein Dispatch an `document`. Gegenprobe: Ein Request nach Clear liefert weiter alle Ereignisse. Ohne die Korrektur schlagen beide Fälle fehl (geprüft). |

Belege: Coverage-, Sonar- und Browserläufe siehe Befundbericht.

## Dritte unabhängige Nachprüfung (2026-11-11)

Ergebnis: **Weiterhin nachbessern, noch nicht committen.** Die isolierten Gegenbeispiele A, B mit 17 Regelständen, C mit sechsstelliger Kennung und D für technische Ereignisse sind behoben. Die neue Nachprüfung bestätigt jedoch drei zusammenhängende Restbereiche. Die ausdrücklich genannte Annahme, gleicher Schlüssel auf Server und Browser mache die engeren Serverfeldgrenzen unkritisch, trifft nicht zu.

### 1. Die Bereinigungskette und ihre Schemagrößen sind noch nicht konsistent

Fundstellen: `reportTutorReview` in [tutor-diagnostics.ts](../../server/services/tutor/tutor-diagnostics.ts), `redactTutorReviewText` und Serverschemas in [tutor-review.ts](../../shared/tutor-review.ts), `responseRecord` und `serverRecord` in [tutor-review-store.ts](../../client/src/lib/tutor-review-store.ts).

Zwei direkte Reproduktionen durch den Hauptagenten:

- **Verlust schon vor der Übertragung:** Ein zulässiger Modellentwurf mit 1.998 Zeichen aus 333 Wiederholungen eines sechsstelligen synthetischen Request-Keys wird auf 6.993 Zeichen bereinigt. Der Collector prüft diesen Text anschließend gegen die unveränderte Servergrenze von 2.000 Zeichen. Ergebnis: `dropped: 1`, keine Entwurfseinträge. Der Umschlag ist formal gültig; das Entwurfsfeld fehlt aber bereits, bevor der Browser es erhält. Server und Browser verwenden dabei denselben Schlüssel.
- **Mehrfachbereinigung verändert den Marker:** Für den zulässigen synthetischen Key `ED` enthält der Marker `[REDACTED-CREDENTIAL]` selbst Treffer. Er wächst bei einem weiteren Durchlauf von 21 auf 78 Zeichen. In der echten Collector-/Browserkette wird ein 140 Zeichen langer Entwurf zunächst auf 1.470 Zeichen bereinigt und korrekt übertragen. Der Browser bereinigt nochmals auf 5.460 Zeichen. Der erzeugte Export scheitert an `steps[0].server.entries[0].question`, `too_big`. Auch ohne Serverblock kann `responseRecord` eine zulässige 2.000-Zeichen-Frage durch seinen doppelten Durchlauf auf 78.000 Zeichen vergrößern; die neue Exportgrenze von 42.000 Zeichen reicht dann ebenfalls nicht.

Erforderlich: Eine konsistente Verarbeitung von ursprünglichen und bereits bereinigten Inhalten sowie passende, gemeinsam begrenzte Verträge für Collector, Transport, Store und Export. Eine wiederholte Verarbeitung darf Marker nicht erneut expandieren. Die Lösung soll nicht lediglich einen weiteren unbewiesenen Multiplikator ergänzen. Regressionen müssen die gesamte Collector-zu-Browser-Strecke und Marker überlappende Schlüssel prüfen, nicht nur einen einzelnen Store-Aufruf.

### 2. Die Liste fehlender Legendensätze überschreitet ihr eigenes Schema

Fundstellen: `keepGuidance` in [tutor-review-store.ts](../../client/src/lib/tutor-review-store.ts) und `legend.missingServerSets` in [tutor-review.ts](../../shared/tutor-review.ts).

Der unabhängige Prüfer führte 100 zulässige Requests mit verschiedenen Regelständen aus. Ergebnis: 16 gespeicherte Legendensätze, 84 fehlende Revisionen in `missingServerSets`. Diese Liste erlaubt jedoch nur 64 Einträge. Der Export nennt den Lauf zwar korrekt unvollständig, ist aber erneut nicht schemafähig. Die Prüfung mit genau 17 Regelständen deckt das obere Requestlimit nicht ab.

Erforderlich: Requestlimit, Anzahl möglicher fehlender Regelstände und Exportvertrag gemeinsam konsistent begrenzen; bei Überlauf keine Referenzen oder Verlustangaben still entfernen.

### 3. Eine alte lokale Anzeigeaktion kann nach Leeren einen neuen Mitschnitt erzeugen

Fundstelle: `reportTutorReviewAction` in [tutor-diagnostic-runtime.ts](../../client/src/lib/tutor-diagnostic-runtime.ts).

Unabhängig reproduzierter Ablauf: 100 Requestversuche erfassen; einen weiteren Dialogrequest starten, der wegen des Limits keinen Reviewhandle erhält; währenddessen leeren; danach die Antwort binden und den normalen `held`-Schritt melden. Die technischen Alt-Ereignisse werden nun korrekt unterdrückt. Dennoch entsteht ein neuer Mitschnitt mit `{ kind: "held", relatesTo: undefined, status: "recorded" }`.

Die lokale Aktion prüft nur DEBUG. Weil der Reviewhandle fehlt, kann der Store seine Schutzprüfung für veraltete zugeordnete Schritte nicht anwenden.

Erforderlich: Auch lokale Anzeigeaktionen an einen tatsächlich gültigen Browser-/Requestkontext und dessen Erfassungsepoche binden. Der kombinierte Fall Capturelimit → laufender Request ohne Handle → Leeren → verspätete lokale Aktion braucht eine Regression.

### Belegte Verbesserungen und Prüfgrenzen

- Der ursprüngliche Secret-Fall in Serverregeltexten ist behoben: kein Test-Key im Store/Export, Bereinigungszähler 1.
- Der Fall mit genau 17 Regelständen ist schemafähig, unvollständig und benennt den fehlenden Satz.
- Technische Alt-Ereignisse werden auch im kombinierten Fall ohne Reviewhandle nicht mehr weitergeleitet; offen bleibt dort die lokale Aktion.
- Fünf Client-Suites (`tutor-review-findings`, `tutor-review-panel`, `tutor-review-capture`, `tutor-review-example`, `tutor-review-loader`) wurden frisch ausgeführt: **43 Tests bestanden**, keine übersprungen.
- Die beschriebenen zusätzlichen Gegenbeispiele beruhen auf synthetischen lokalen Node-Reproduktionen. Es wurden keine echten Provider aufgerufen, keine Produktdateien oder Tests geändert und keine Commits erstellt. Vollständiger Build, Sonar und Browserabnahme wurden für diese fokussierte Nachprüfung nicht erneut ausgeführt.

Die drei Restbereiche sollten vor einem Commit mit durchgängigen Vertrags- und kombinierten Grenzfalltests geschlossen werden. Die vorhandenen grünen Prüfungen und die bestätigten Verbesserungen bleiben gültige Nachweise für die bereits abgedeckten Fälle.

## Dritte Nachbesserung (2026-11-11)

| Befund | Behebung | Regression |
| --- | --- | --- |
| 1. Bereinigungskette | `redactTutorReviewText` ist idempotent: Vorhandene Marker bleiben unberührt, jede Schreibweise wird nur zwischen Markern ersetzt. Bliebe eine Schreibweise über einen Markerrand sichtbar, wird der ganze Text zu einem Marker (gezählt). Daraus folgt beweisbar: Länge nach Bereinigung ≤ 21 × ursprüngliche Länge, unabhängig von der Zahl der Durchläufe. Diese eine Grenze (`tutorReviewRedactedChars`) gilt jetzt für die Serverentwürfe im Collector, den Transportumschlag, Store und Export. | Echte Strecke Collector → JSON → Browser-Laufzeit → Export mit `k3y-Zq` × 333 (Entwurf bleibt erhalten, `dropped: 0`) und mit `ED` (Marker wächst nicht). Eigenschaftstests für zehn Schlüssel, die Marker überlappen (`ED`, `E`, `[RED`, `L]`, `]x`, `L]X` …): idempotent, begrenzt, keine Schreibweise außerhalb von Markern. |
| 2. Fehlende Legendensätze | Jeder Request nennt höchstens einen Regelstand; `missingServerSets` ist deshalb durch `requestAttempts` begrenzt und nie gekürzt. | 100 Regelstände: 84 fehlende Sätze, schemagültig, jeder Schritt verweist auf gespeicherte oder als fehlend gelistete Texte. |
| 3. Lokale Anzeigeaktion | `held`/`displayed` werden nur für eine im aktuellen Abschnitt erfasste Antwort aufgenommen (Laufzeit prüft Kontext, Handle und Epoche; der Store verlangt für diese Arten einen gültigen Bezug). | Requestlimit → laufender Request ohne Handle → Leeren → verspätetes `held` und `displayed`: kein neuer Mitschnitt. |

Ohne die Korrekturen schlagen 9 der 14 neuen Strecken- und Eigenschaftstests fehl (geprüft), mit ihnen bestehen alle.

## Vierte unabhängige Nachprüfung (2026-11-11)

Ergebnis: **Die drei bisherigen Restbereiche sind geschlossen. Ein wesentlicher struktureller Bereinigungsfehler verhindert noch die Commit-Empfehlung.** Die Prüfung erfolgte wieder lesend durch den getrennten Prüfer und den Hauptagenten; kein Produktcode, Test oder Gitzustand wurde verändert.

### Bestätigte Korrekturen

- Collector, Transport, Store und Export verwenden dieselben erweiterten Grenzen für bereinigte Inhaltsfelder. Die Markerbehandlung ist für die geprüften Fälle idempotent, begrenzt und berücksichtigt Überlappungen am Markerrand.
- 100 Regelstände erzeugen 16 gespeicherte und 84 ausdrücklich fehlende Legendensätze; der Export ist schemafähig und nennt die fehlende Evidenz.
- Beim kombinierten Fall Requestlimit → Request ohne Reviewhandle → Leeren → verspätete Antwort → `held`/`displayed` bleiben technische Ereignisse und neue Mitschnitte aus. Runtime- und Storeguard greifen.

### Verbleibender Befund: Feste Schemawerte werden als Freitext bereinigt

Fundstellen: `responseRecord` in [tutor-review-store.ts](../../client/src/lib/tutor-review-store.ts), `reportTutorReview` in [tutor-diagnostics.ts](../../server/services/tutor/tutor-diagnostics.ts) und die generische `redactTutorReviewValue`-Verwendung.

Unabhängig reproduziert und vom Hauptagenten nochmals bestätigt:

1. Der synthetische Key `answer` ist nach dem Tutor-Requestschema zulässig.
2. Eine gültige Tutorantwort enthält `learnerInput: "answer"`.
3. Die generische Bereinigung verarbeitet sämtliche Stringwerte, einschließlich dieses festen öffentlichen Klassifikationscodes.
4. Im Store steht anschließend `learnerInput: "[REDACTED-CREDENTIAL]"`.
5. Der Export lässt sich kopieren, ist aber nicht schemafähig: `steps[0].response.learnerInput`, `invalid_value`.
6. Auch die echte Collectorstrecke verliert einen ursprünglich gültigen Eintrag `{ kind: "classification", learnerInput: "answer" }`: Ergebnis `entries: []`, `dropped: 1`.

Die Textbereinigung funktioniert damit für freie Inhalte, wird jedoch auch auf strukturelle Kennwerte angewendet, deren Identität der Vertrag benötigt. Das betrifft grundsätzlich Diskriminatoren, Klassifikationen und weitere feste Codes; eine Korrektur nur dieses einen Felds wäre zu eng.

Erforderlich: Freitextbereinigung anhand der erlaubten Inhaltsfelder von festen öffentlichen Schemawerten unterscheiden, auf Server und Browser. Solche Codes müssen ihre Bedeutung und Schemafähigkeit behalten. Wie beim öffentlichen Marker ist eine zufällige Übereinstimmung mit einem Key kein Übernehmen eines vertraulichen Schlüsselwerts aus einem Inhaltsfeld. Die freien Inhalte müssen weiterhin vor der Speicherung bereinigt werden. Die Lösung darf nicht lediglich Enumfelder zu beliebigen Strings erweitern und dadurch die Klassifikation unbrauchbar machen.

Regressionen sollten beide Datenwege mit einem gültigen Test-Key prüfen, der einem öffentlichen Code entspricht, und weitere tatsächlich verwendete feste Codes einbeziehen.

### Frische Nachweise und Prüfgrenzen

- Sechs Review-Client-Suites (`tutor-review-chain`, `tutor-review-findings`, `tutor-review-panel`, `tutor-review-capture`, `tutor-review-example`, `tutor-review-loader`): **58 Tests bestanden**, keine übersprungen.
- Zusätzliche deterministische Textprüfung: **22.600 Fälle mit 226 verschiedenen synthetischen Schlüsseln**, einschließlich sämtlicher nichtleerer Markerteilstrings sowie JSON-/URL-Darstellungen und Unicode. Kein Gegenbeispiel für Idempotenz, die geprüfte Längenschranke oder Schlüsselreste außerhalb von Markern gefunden. Diese Textprüfung deckt strukturelle Enumfelder nicht ab.
- Die beiden Klassifikationsgegenbeispiele wurden mit echten Schemas und dem echten Collector beziehungsweise Store lokal über Node reproduziert. Es gab keine Provider- oder Netzwerkaufrufe.
- Vollständiger Build, Sonar, Browserabnahme und allgemeine Didaktik wurden in dieser gezielten Nachprüfung nicht erneut bewertet. Eine Migration des noch unveröffentlichten Formats v1 wird weiterhin nicht verlangt.

Empfehlung: Den zentralen Unterschied zwischen freien Inhalten und festen Strukturcodes korrigieren und beide Wege gezielt nachprüfen; bis dahin nicht committen.

## Vierte Nachbesserung: strukturgeprüfte Bereinigung (2026-11-11)

**Ursache:** Die generische Bereinigung maskierte jeden String, also auch feste öffentliche Codes.

**Behebung (Server und Browser gemeinsam):**
- **Reihenfolge:** Erst werden Struktur und Codes gegen die echten Aufzählungen geprüft (`tutorResponseStyleSchema`, `tutorLearnerInputSchema`, `tutorQuestionKindSchema`, `tutorStrategySourceSchema`, `tutorLearningPhaseSchema`, Support-`outcome`, Fokus-`state`, Referenzgrund, `boardIdSchema` sowie Servereintragsart, Auslöser, Quelle, Grafikstatus, Auslassung und Replay-Grund). Danach werden ausschließlich die freien Inhaltsfelder bereinigt.
- **Servereinträge:** `redactTutorReviewServerEntry` wählt die freien Felder je Eintragsart typisiert aus. Collector und Browser verwenden dieselbe Funktion.
- **Browser-Antworten:** Der Store baut Antworten Feld für Feld auf. Unbekannte Codes und Rohfelder entfallen.
- **Dynamische Kennungen:** Lern-IDs, Inhaltsrevision sowie Kurs- und Modellkennungen bleiben freie Inhalte und werden bereinigt.
- **Bestehender Test:** Ein Test sandte `board: "mega"`, das das Requestschema nicht zulässt. Er sendet jetzt den gültigen Code `mega2560`; seine Aussage bleibt gleich.

**Regressionen:** [tutor-review-structure.test.ts](../../tests/client/tutor-review-structure.test.ts)
- Strecke Collector → JSON → Laufzeit → Export mit dem Schlüssel `answer`.
- Lokaler Mitschnitt ohne Serverblock mit 14 öffentlichen Codes jeweils als Schlüssel.
- Bereinigung freier Kennungen.
- Ablehnung unbekannter Codes und Rohfelder, auch in Servereinträgen.
- Codes in der nächsten Frage nach einem Skip.

**Gegenprobe:** Vor der Korrektur schlugen 16 von 19 Tests fehl.

**Unabhängige Nachprüfung (getrennter Agent, frischer Kontext):** Urteil „abnahmebereit, mit Vorbehalt“.
- Das Gegenbeispiel ist auf beiden Datenwegen geschlossen.
- 88 eigene Gegenproben mit 44 Schlüsseln, mit und ohne Serverblock, zeigten kein Leck und keinen maskierten Code.
- Drei kleinere Befunde:

| Befund | Behebung | Regression |
| --- | --- | --- |
| B1. Zahlen aus noch nicht lernschemageprüften Antworten (Fokusbereiche, Support-Zähler) machten den Export ungültig | Ganzzahl und Bereich werden vor der Übernahme geprüft; ungültige Blöcke entfallen. | Sechs Fälle (zu viele verstandene Bereiche, 0 Bereiche, Text, Bruchzahl, Bereichsüberschreitung). |
| B2. Mit einem kurzen Schlüssel galt die eigene Legende als abweichend | Der Vergleich mit den Clienttexten läuft vor der Bereinigung; nur abweichende Sätze werden bereinigt gespeichert. | Schlüssel `e`, `a`, `E`, `R`, `.`, `ü`. |
| B3. `failure.code` war weder Code noch bereinigt; `server.guidanceRevision` stand im Exportschema als bereinigter Text | Fehlercodes sind freier Inhalt und werden bereinigt; die Revision wird im Export wie im Umschlag per Regex geprüft. | Fehlercode gleich dem Schlüssel. |

Ohne diese drei Korrekturen schlagen alle 13 Folgetests fehl (geprüft).

### Abnahmestand nach der vierten Nachbesserung

- **Tests:**
  - Review-Suites (acht Dateien mit Server-Routentest): 95 bestanden.
  - Coverage-Lauf: 4.386 bestanden, 1 übersprungen; Emulator: 402 bestanden, 295 übersprungen.
  - Tutor-Browsertests: 24 bestanden, gegen den frisch gebauten Client.
- **Statische Prüfungen:** `npm run check`, `npm run lint`, `npx knip`, `check:docs` und `git diff --check` sind sauber.
- **Bundle:** Der Startpfad misst 728.052 Byte (Limit 745.000). Gegenüber 728.001 Byte sind das 51 Byte mehr, weil die Code-Schemas jetzt exportiert werden.
- **Sonar:** Analyse `0a576d5b-b098-457d-af0f-39508a44d37a` vom 2026-11-11 21:00 UTC, Gate bestanden.
- **Beispielexport:** neu erzeugt, ohne Schlüssel.
- **Offen:** Eine weitere unabhängige Prüfung speziell der Folgekorrekturen B1–B3 steht aus. Sie sind durch rote und grüne Regressionen belegt.

## Fünfte unabhängige Nachprüfung und Abschluss (2026-11-11)

**Ergebnis:** B1–B3 sind unabhängig bestätigt.
- **Vorgehen:** Ein getrennter Agent mit frischem Kontext prüfte 26 eigene Gegenproben.
- **B1:** Zahlen in Antwort, nächster Frage, Anfrage und Historie wurden mit ungültigen Werten geprüft, der Export war jeweils gültig.
- **B2:** Kurze Schlüssel sowie die gleiche Revision mit anderen Texten werden korrekt behandelt.
- **B3:** Fehlercodes sind bereinigt, und `finishStep` überschreibt sie nicht.
- **Neuer Befund N1:** Gesendete Code-Kontexte über den Requestgrenzen (mehr als 20 Header, überlange Datei- oder Headernamen bzw. -inhalte) wurden ungeprüft übernommen und machten den Export schemaungültig.

| Befund | Behebung | Regression |
| --- | --- | --- |
| N1. Kontexte über den Requestgrenzen | Der Store prüft Code, Entry-Datei, Headeranzahl, -namen und -inhalte gegen `INPUT_LIMITS.compile`, bevor er bereinigt. Ein Kontext jenseits davon (den der Server ohnehin ablehnt) wird nicht aufgenommen, statt gekürzt zu werden. Der Schritt bleibt ohne Kontext erhalten, der Mitschnitt ist mit `capture-limit` unvollständig. | Fünf Grenzverletzungen; Gegenprobe genau an den Grenzen. Ohne Korrektur schlagen alle fünf fehl (geprüft). |

**Zur Kenntnis (I1, so entworfen):** Revisionskennungen (`guidanceRevision`, `promptRevision.id`) gelten als vom Server per Regex geprüfte Codes und werden nicht bereinigt.

**Zusätzlich vor dem Commit:**
- Das CI-Dead-Code-Gate (`./run-tests.sh --knip-gate-only`) fand zwei nur von Tests genutzte Exporte. `parseTutorReviewExportJson` liegt jetzt in [tests/client/tutor-review-test-utils.ts](../../tests/client/tutor-review-test-utils.ts). Die Weiterleitung von `retainTutorDebugMessages` entfällt, der Test importiert direkt aus `debug-retention`.
- Der Server-Bundle startet lokal und liefert `/api/config` mit Status 200.
