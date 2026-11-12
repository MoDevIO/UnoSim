# Arbeitsauftrag für Claude Sonnet: Tutor-Tests vollständig ergänzen

Dieser Text ist als Ausführungsauftrag für Claude Sonnet formuliert und kann ebenso mit dem vom Nutzer gewählten Opus ausgeführt werden. Das Bereitstellen der Datei allein führt noch keine Implementierung aus. Der Nutzer kann die gewählte Instanz mit „Lies diesen Arbeitsauftrag und führe ihn vollständig aus“ starten.

---

Du arbeitest als **ausführender Implementierungsagent** mit dem vom Nutzer gewählten Modell im Repository `/Users/to/Documents/TT_Web/UnoSim`. Setze den gesamten nachfolgend verlinkten Testergänzungsplan selbstständig um. Liefere einen geprüften Arbeitsstand und einen belastbaren Abschlussbericht. Beschränke dich nicht auf eine weitere Analyse oder einen Vorschlag. Der historische Modellname im Dateinamen verlangt keinen Modellwechsel.

## Sprache und Übergabe an Codex

- Schreibe Fortschrittsmeldungen, neue Arbeitsberichte und die Abschlussantwort auf **Deutsch**. Code, Bezeichner, zitierte Toolausgaben und vorhandene normative englische Dokumente behalten ihre jeweilige Sprache.
- Formuliere die Abschlussantwort als **technische Übergabe an Codex zur unabhängigen Nachprüfung**. Beginne direkt mit „Übergabe an Codex zur unabhängigen Nachprüfung.“ Verzichte auf Adressatenfloskeln wie „Written for: you“ und auf die Aufforderung an den Nutzer, allein anhand deiner Selbstprüfung über den Commit zu entscheiden.
- Nenne Ausgangsstand, Änderungen, genaue Prüfergebnisse, Gegenproben, offene Punkte und Berichtspfade. Selbstprüfung und unabhängige Prüfung ausdrücklich unterscheiden; Sonar-Gate-Status und Kommando-Exitcode getrennt ausweisen.
- Die Übergabe erfolgt durch Bericht, Dateien und Abschlussantwort. Behaupte keine direkte Agentenverbindung oder bereits erfolgte Prüfung durch Codex. Der Nutzer entscheidet über die Integration; Codex prüft zunächst den übergebenen Stand.

## 1. Auftrag, Freigaben und Grenzen

Arbeitsgrundlage ist [der detaillierte Arbeitsplan](../plans/2026-11-11-tutor-test-completion.md). Lies ihn vollständig einschließlich der Anhänge. Der Auftrag umfasst Aufgaben **1–8**, die dort beschriebenen begrenzten Produktkorrekturen, die Evaluatorerweiterung für Initialfragen/Grafik-Evidenz, Regressionen, Dokumentation und Prüfungen.

**Du sollst nach jedem bestandenen Arbeitspaket automatisch weiterarbeiten.** Keine Zwischenfreigabe nach drei Aufgaben, keine wiederholte Frage „Soll ich weitermachen?“, kein Abbruch wegen einer normalen roten Regression, eines TypeScript-Fehlers oder eines nötigen lokalen Refactorings. Die Ausführung durch das vom Nutzer gewählte Modell ist bereits beauftragt. Skills dürfen den Ablauf strukturieren; Routinen, die nur aus Prozessgründen eine neue Planfreigabe oder einen Ausführungsmodus verlangen, sind hier nicht erneut nötig.

Du darfst neue Tests und Fixtures erstellen, bestehende Tests additiv ergänzen und die zur beschriebenen Vertragsänderung nötigen Typ-/Fixture-/Versions-/Hash-Anpassungen vornehmen. Diese begrenzte Freigabe ist ausdrücklich für die Testschutzregel aus `ssot/ssot_agent_policy.md` bestimmt:

- Korpusversion und Digest in `tests/server/services/tutor/evaluation/anchor-corpus.test.ts` an die tatsächlich erweiterten Korpusdaten anpassen.
- Judge-Revision, Promptdigest, Typ-Fixture und Zitatquellen-Erwartung in `tests/server/services/tutor/evaluation/judge.test.ts` auf den im Plan beschriebenen Vier-Quellen-Vertrag migrieren. Die drei bisherigen Quellen bleiben gültig; zusätzliche Tests sichern die neue Quelle und ihre Grenzen ab.
- Rein technische Testanpassungen, die aus genau dieser additiven Schnittstellenänderung folgen, mit Dateiliste und Begründung im Bericht festhalten.

**Nicht freigegeben** sind das Löschen alter Gegenbeispiele, abgeschwächte fachliche Erwartungen, breitere Bewertungsbänder, höhere Limits, pauschale Suppressions, zusätzliche Skips oder Updates beliebiger Snapshots, um einen Fehler zu verdecken. Ein neuer Test, der einen bestehenden Produktvertrag verletzt sieht, ist Anlass für eine begrenzte Produktkorrektur. Ein Konflikt zwischen zwei gültigen Verträgen ist ein größerer Befund gemäß Abschnitt 5.

Der Auftrag endet mit geprüftem Code, aktualisierten Unterlagen und Bericht. Keine automatische Git-Integration im Rahmen dieses Testauftrags; vorhandenes Staging nicht als Freigabe verstehen, fremde Änderungen mitzucommitten. Ein separater Integrationsauftrag ist gesondert mit seinen Voraussetzungen zu behandeln.

**Reales Modellbudget für diesen Auftrag: 0 Calls.** Implementiere und teste den gesamten deterministischen Umfang einschließlich Evaluator, Korpus und vorbereitetem Live-Protokoll. Starte keine echten KI:connect- oder Judge-Anfragen. Tatsächliche Modellmessung ist separat als „nicht ausgeführt – kein Budget beauftragt“ auszuweisen; sie blockiert die übrige Arbeit nicht. Das Finden eines gespeicherten Keys ist keine Freigabe für dessen Nutzung.

## 2. Einstieg und Schutz des Ausgangsstands

Lies vor Änderungen:

1. Tatsächlich vorhandene `AGENTS.md`/`CLAUDE.md` im Projekt und `ssot/ssot_agent_policy.md`.
2. Den verlinkten Arbeitsplan samt Anhängen und den dort referenzierten Tutor-SSOTs.
3. [Die bisherige Testanalyse](../../proposals/report-tutor-test-coverage-2026-11-11.md).
4. Die im jeweils nächsten Arbeitspaket genannten Produktions- und Testdateien. Große Dateien gezielt nach den relevanten Funktionen lesen; nicht alle Dateien ständig vollständig erneut einlesen.

Erfasse `git status --short`, aktuellen Branch und HEAD. Es können viele bereits gestagte, ungestagte oder unversionierte Änderungen vorhanden sein. Bewahre sie. Kein Reset, Restore, automatisches Stash, Entfernen unbekannter Dateien oder Branchwechsel zur Herstellung einer sauberen Basis. Bereits vorhandene Strukturcodekorrekturen zuerst prüfen; den historischen Befund nicht ungeprüft erneut reparieren.

Lege zu Beginn `docs/proposals/report-tutor-test-completion.md` an beziehungsweise ergänze eine vorhandene Fassung. Halte darin Ausgangsstand, eigene geänderte Dateien, Aufgabenstatus und erste Prüfresultate fest. Der Bericht darf nicht erst nach einem langen Lauf aus dem Gedächtnis entstehen. Bei Hinweisen auf gleichzeitige Bearbeitung derselben Dateien zuerst die neuen Inhalte lesen und erhalten; bei unvereinbaren konkurrierenden Änderungen gezielt blockieren, keine fremde Arbeit überschreiben.

## 3. Arbeitsfolge und laufende Verifikation

Arbeite in dieser Reihenfolge: **1 → 2 → 3 → 4 → 5 → 6 → 8 → 7**.

Für jedes Arbeitspaket gilt:

1. Anforderung und vorhandene Abdeckung prüfen. Ein vorhandener Test genügt nur, wenn seine Assertions die betreffende Regel tatsächlich erzwingen. Wiederverwendung mit konkretem Nachweis ist erlaubt; überflüssige Duplikate sind nicht gewünscht.
2. Fehlende Regressionen mit kontrollierten Providerantworten hinzufügen. In den zentralen Integrationstests bleiben Klassifikation, Bewertung, Planer und Stores echt. Keine „passende“ Planerantwort mocken, wenn gerade die Planerentscheidung geprüft wird.
3. Bei einem echten Produktfehler den fachlichen Fehlschlag vor der Korrektur beobachten, Ursache verfolgen und minimal korrigieren. Bei bereits korrektem Verhalten Gegenkontrollen verwenden; nicht künstlich einen fehlenden Import als relevante rote Regression ausgeben.
4. Die im Plan genannten gezielten Tests sowie betroffene Nachbarsuiten ausführen. Fehler beheben, bevor ein davon abhängiger Schritt begonnen wird. Ein vorgefundener Fehler wird mit seinem Ausgangsnachweis getrennt von neuen Regressionen dokumentiert.
5. Matrix, Checkboxen und Bericht aktualisieren. Kurze Fortschrittsmeldung mit Ergebnis und nächstem Schritt senden, **ohne** eine Freigabe abzuwarten. Anschließend fortfahren.

Prüfintervalle:

| Anlass | Prüfung |
| --- | --- |
| Nach jeder relevanten Änderung | Betroffene Testdatei; zugehörige Positiv-/Negativkontrolle |
| Nach jedem Paket | Im Plan genannte Tests und betroffene Nachbarsuiten |
| Nach jeweils zwei Paketen | Zusätzlich `npm run test:tutor-quality` |
| Nach Änderung gemeinsamer Typen oder öffentlicher Signaturen | Zusätzlich `npm run check` |
| Nach Grafik-/UI-Integration in Aufgabe 6 | Neuer Browserlauf und vorhandene Tutor-Grafik-/Review-Browsertests |
| Nach Aufgabe 8 | Neue Evaluatortests, bestehende Judge-/Korpus-/HTTP-Replay-Tests und Tutor-Quality-Gate |
| Zum Schluss in Aufgabe 7 | Gesamtabnahme nach Abschnitt 6 |

Nutze vorhandene Testkommandos. Neue HTTP-Routentests müssen in `vitest.config.ts` dem richtigen seriellen Projekt zugeordnet sein. Ein Filter ohne gefundene Tests gilt nicht als Erfolg. Provider-Fakes dürfen nicht durch unbegrenzte Defaultantworten unerwartete weitere Aufrufe verdecken.

Für Verzögerungen kontrollierte Promises oder lokale HTTP-Freigaben verwenden, keine langen Sleeps. Keine produktiven Module allein für Testkomfort umgestalten. Sonar-/Lint-Befunde an der Ursache lösen. Schemas nicht zu beliebigen Strings erweitern, wenn öffentliche Strukturcodes erhalten bleiben müssen.

Wenn ein vorhandener Test die intern geänderte Darstellung statt den zugesagten öffentlichen Vertrag prüft, untersuche die Abhängigkeit zuerst. Die begrenzte Freigabe für die Evaluatormigration erlaubt technische Anpassungen mit Begründung; sie erlaubt keine Änderung unabhängiger fachlicher Sollwerte.

## 4. Was Sonnet selbst entscheiden und reparieren soll

- Auswahl kleiner vorhandener Fixtures, Verteilung zusätzlicher Tests auf Dateien, Benennung interner Hilfsfunktionen und begrenzte Refactorings innerhalb der betroffenen Module.
- Fehlende Imports, falsche Testprojektzuordnung, problematische Async-Reihenfolge, lokale Portkollisionen und andere normale Ausführungsfehler.
- Nachgewiesene lokale Verstöße gegen bereits festgelegte Verträge: etwa falsch gezählte Versuche, doppelte Evidenz, veraltete Grafikzuordnung oder ungültige bereinigte Reviewdaten.
- Die im Arbeitsplan bereits festgelegte Evaluatorerweiterung und ihre dokumentierte Migration; dafür keine zweite Architektur-/Designrunde starten.
- Eine bessere Dateiaufteilung als im Plan, falls der aktuelle Code sie nahelegt. Fachliche Anforderungen, IDs und Nachweise erhalten und Abweichung dokumentieren. Nicht an einem vorgeschlagenen Dateinamen scheitern.

Ein unklarer Detailpunkt rechtfertigt keine Unterbrechung, wenn er aus dem tatsächlichen Code, SSOT oder vorhandenen Mustern entschieden werden kann. Die Entscheidung mit kurzer Begründung im Bericht festhalten und weiterarbeiten.

Umgebungsprobleme zuerst von Produktfehlern unterscheiden. Beispiel: `listen EPERM` eines lokalen `tsx`-IPC-Sockets kann eine Sandboxgrenze sein. Den vom Werkzeug vorgesehenen Freigabeweg verwenden, falls nötig; niemals die Testerwartung an das Socketverbot anpassen. Fehlende Sonar-/Docker-Verfügbarkeit nicht als bestandene Prüfung ausweisen. Unabhängige Pakete währenddessen weiterbearbeiten. Keine fremden Prozesse beenden, keine Schutzmechanismen umgehen und keine Zugangsdaten ausgeben.

## 5. Wann tatsächlich unterbrochen werden soll

Eine normale Fehlersuche ist kein Abbruchgrund. Ein **größerer Blocker** liegt vor, wenn mindestens eine dieser Bedingungen erfüllt ist:

- Die Lösung benötigt eine neue fachliche Entscheidung außerhalb dieses Plans, etwa geänderte Bewertungsrubrik, neue Einwandsklasse, andere Verdict-Schwellen oder eine grundlegende Tutorarchitektur.
- Bestehende normative Anforderungen widersprechen sich und beide lassen sich mit dem vorgesehenen Verhalten nicht erfüllen.
- Es besteht konkrete Gefahr, fremde Arbeit zu überschreiben, Daten zu verlieren, Credentials offenzulegen oder Test-/Sicherheitsgates umgehen zu müssen.
- Eine wesentliche Ursache bleibt nach drei nachvollziehbar unterschiedlichen, getesteten Hypothesen ungeklärt und weitere Änderungen wären spekulativ. Keine drei Blindversuche zählen; Hypothese und Befund gehören in den Bericht.
- Erforderliche externe Infrastruktur oder Berechtigungen sind nach gezielter Diagnose nicht verfügbar und der verbleibende Umfang kann ohne sie nicht sinnvoll weitergeführt werden.

Blockiert ein Problem nur einen Teil, diesen Teil kennzeichnen und die unabhängigen Aufgaben fertigstellen. Den gesamten Lauf erst beenden, wenn entweder alle ausführbaren Aufgaben abgeschlossen sind oder der größere Blocker die weitere sinnvolle Arbeit verhindert. Ein fehlender Zweitagent, ein nicht verfügbarer Skill oder das ausdrücklich nicht beauftragte Livebudget ist allein kein solcher Blocker.

Bei Unterbrechung einen Bericht mit genau diesen Angaben liefern:

1. Aufgabe, Fall-ID und reproduzierbarer Fehler beziehungsweise Vertragskonflikt.
2. Erwartetes und tatsächliches Verhalten, betroffene Dateien und Befehle.
3. Untersuchte Hypothesen mit konkreten Ergebnissen; keine bloße Aufzählung versuchter Edits.
4. Erhaltener Arbeitsstand: erledigt, noch offen, blockiert; zuletzt bestandene Prüfungen.
5. Genau benötigte Entscheidung oder externe Voraussetzung und der nächste ausführbare Schritt.

Kein pauschales „zu komplex“ und keine Vermischung von fehlender Infrastruktur mit schlechter Modellqualität. Keine unvollständige Arbeit als insgesamt abgeschlossen bezeichnen.

## 6. Gesamtabnahme

Nach allen Implementierungsarbeiten einschließlich Aufgabe 8 mindestens ausführen:

```bash
npm run test:tutor-quality
npm run test:unit
npm run check
npm run lint
npx knip
npm run check:docs
git diff --check
npm run build
```

Der Build enthält die Bundlebudget-Prüfung. Das vorhandene Startbudget nicht erhöhen; eine nur für Tests beziehungsweise serverseitige Evaluation nötige Abhängigkeit darf nicht in den initialen Browserpfad geraten.

Sämtliche Tutor-Browsertests gegen den frisch gebauten Client ausführen:

```bash
npx playwright test --project=browser e2e/tutor-learning.spec.ts e2e/tutor-status-indicator.spec.ts e2e/tutor-debug-graphics.spec.ts e2e/tutor-review.spec.ts e2e/tutor-mocked-lifecycle.spec.ts
```

Bei sinnvoller Umbenennung die tatsächlich implementierte neue Datei einsetzen und im Bericht festhalten. Keine stillschweigende Verringerung der Suiteauswahl. Ein bestandener Retry nach fehlgeschlagenem ersten Versuch bleibt ein untersuchungsbedürftiger Befund.

Coverage und Sonar:

```bash
NODE_ENV=test UNOSIM_SERVER_MODE=local npm run sonar
```

Dieses Kommando enthält bereits den Coverage-Lauf; ihn nicht unmittelbar davor grundlos doppelt starten. Sonar-Befunde beheben und das Gate anhand der frischen Analyse-ID zuordnen. Falls der Sonarserver oder die dafür vorgesehene Berechtigung fehlt: alle übrigen Arbeiten abschließen, `npm run test:coverage` lokal ausführen und Sonar ausdrücklich als extern blockierte Abnahme berichten. Keine Suche nach persönlichen Schlüsseln und keine alten Ergebnisse als neue Abnahme ausgeben. Zusätzliche von Repository-Anweisungen verlangte Checks bleiben einzuhalten.

Abschließend selbst gegen die fünf `Review Focus`-Punkte des Plans prüfen. Eine verfügbare separate Prüfung darf zusätzlich genutzt werden, wenn sie im ausführenden Umfeld autorisiert ist. Sie ist nur dann „unabhängig“, wenn tatsächlich eine andere Instanz geprüft hat; eine Selbstprüfung nicht umbenennen. Fehlende Delegationsmöglichkeiten sind kein Anlass, die Implementierung liegenzulassen.

## 7. Arbeitsgedächtnis und Abschlussbericht

Halte den Bericht und die Plan-Checkboxen nach jedem Paket aktuell. Vor einem Kontextwechsel notieren:

- aktuelle Aufgabe und offene Fall-IDs;
- tatsächlich geänderte Dateien und noch laufende eigene Prozesse;
- letzter Testbefehl mit Ergebnis und exakter nächster Schritt;
- wichtige getroffene Entscheidungen und vorhandene Blockaden.

Nach dem Kontextwechsel von diesem Stand fortsetzen. Bereits nachgewiesene Arbeit nicht ohne Anlass wiederholen. Hatte sich der Code danach geändert, nur die dadurch betroffenen Nachweise erneuern.

Der Abschlussbericht beantwortet:

- Welche Anforderungen sind durch welche Tests belegt? Auf `docs/tutor-test-matrix.md` verweisen.
- Welche Fehler wurden durch neue Tests nachgewiesen und tatsächlich korrigiert?
- Welche bestehenden Tests mussten im erlaubten Rahmen migriert werden und warum bleibt ihre Aussage erhalten?
- Welche Prüfungen wurden ausgeführt: genaue Kommandos, bestanden/fehlgeschlagen/übersprungen, Laufzeiten, Bundlegröße und frische Sonar-Zuordnung?
- Welche Arbeit ist technisch umgesetzt, aber wegen externer Voraussetzungen noch nicht abgenommen?
- Welche echte Modellmessung wurde nicht ausgeführt? Nicht aus Fake-Antworten auf Modellqualität schließen.

Ein abschließendes „alles grün“ ist nur mit passenden tatsächlichen Nachweisen zulässig. Wenn der gesamte lokal ausführbare Umfang fertig ist und nur Sonar oder ein anderer externer Nachweis fehlt, genau das berichten. Bei einem größeren Produkt-/Vertragsblocker den Unterbrechungsbericht aus Abschnitt 5 liefern.

**Starte jetzt mit Aufgabe 1 und arbeite selbstständig durch den gesamten ausführbaren Umfang.**
