# Konzept: Grafiken für Tutorfragen immer anfordern

Stand: 2026-11-12. Freigegebener Sollvertrag; Umsetzung und Prüfnachweise im [Arbeitsbericht](../../proposals/report-tutor-question-graphics-mode.md). Basis: `main` auf `1f5c59512` nach PR #379. Arbeitsbranch: `feature/tutor-question-graphics-mode`.

Eine separate Leseprüfung des Entwurfs hat keine wesentlichen offenen Umsetzungsfragen gefunden. Der Nutzer hat diesen Entwurf am 2026-11-12 freigegeben.

Die [Ergänzung für fachlich hilfreiche Grafiken in klassischer UML-Notation](2026-11-12-tutor-classic-uml-design.md) wurde am 2026-11-12 freigegeben und ist am 2026-11-13 umgesetzt und unabhängig nachgeprüft; Nachweise stehen im [UML-Arbeitsbericht](../../proposals/report-tutor-classic-uml.md). Die nachfolgenden Mermaid-Regeln beschreiben weiterhin den Legacyvertrag ohne ausgehandeltes UML-Profil.

## 1. Ziel und bestätigter Umfang

Der Nutzer möchte Grafiken im normalen Tutor gezielt anfordern können. Er hat den Umfang ausdrücklich auf **Tutorfragen** beschränkt. Die bisherige automatische Entscheidung bleibt als Standard erhalten.

In den Settings erscheint der Schalter **„Grafiken immer anfordern“**, standardmäßig aus. Er wird lokal gespeichert und wirkt auf nachfolgend erzeugte Fragen. Hilfetext: „Fordert zu neuen Tutorfragen eine Grafik an. Das kann zusätzliche Wartezeit und Modellanfragen verursachen.“

Bei eingeschaltetem Modus darf eine fehlende oder nicht nutzbare Grafik nicht unbemerkt bleiben. Der Modus erzwingt eine überprüfbare Anforderung, keine Garantie, dass ein externes Modell eine gültige, fachlich passende Grafik erzeugt.

## 2. Geltungsbereich

| Vorgang | Verhalten bei eingeschaltetem Schalter |
| --- | --- |
| Erste Frage oder neue Lernrunde | Grafik zur endgültig ausgewählten Frage anfordern. |
| Neue Folgefrage nach einer Antwort | Grafik zu dieser Folgefrage anfordern; bestehendes Zurückhalten bis „Weiter“ beibehalten. |
| Neue Frage nach Überspringen | Grafik zur tatsächlich gelieferten nächsten Frage anfordern. |
| Schwache Antwort; aktuelle Frage bleibt offen | Keine zusätzliche Grafik allein wegen der Wiederholung derselben Frage anfordern. Bestehende gültige Grafik kann bleiben. |
| „Weiter“ | Bereits empfangene Frage und Grafik anzeigen; keine neue Modellanfrage. |
| Hinweis oder Klärungserklärung, einschließlich als Text formulierter Hilfebitte | Bisheriger textbasierter Vertrag bleibt unverändert. |
| Musterantwort oder Abschluss ohne nächste Frage | Keine neue Grafik anfordern. |
| Einstellungswechsel bei sichtbarer oder laufend angeforderter Frage | Keine nachträgliche Generierung oder Umdeutung der laufenden Antwort. Änderung gilt für den nächsten neu gestarteten Vorgang, der eine neue Frage erzeugt. |
| Historie | Kein rückwirkendes Generieren und kein neues Grafikarchiv. |

Die Begrenzung richtet sich nach dem tatsächlichen fachlichen Ergebnis. Der Endpoint `/api/tutor/support` kann mit `skip` eine neue Frage erzeugen; umgekehrt kann `/api/tutor/dialog` eine reine Klärung liefern. Ein pauschales Verhalten allein nach Endpoint genügt deshalb nicht.

## 3. Ansatz und Abwägung

Besprochen ist ein Schalter mit bisheriger Automatik als Standard, einer ausdrücklichen Grafikanforderung und höchstens einer gezielten Nachforderung. Dieser Entwurf konkretisiert diesen Ansatz; die interne Modulaufteilung bleibt Implementierungsentscheidung.

- **Nur den primären Prompt verstärken:** wenig Aufwand, lässt aber weiter fehlende Grafiken zu und verliert Providergrafiken bei Fragenersetzung durch den Planer. Erfüllt das Ziel allein nicht.
- **Anforderung plus gezielte Nachforderung für die endgültige Frage:** erweitert den bestehenden Ablauf, erhält die fachliche Planerautorität und begrenzt zusätzliche Aufrufe. Das ist der vorgeschlagene Ansatz.
- **Grafiken unabhängig vom Modell automatisch aus beliebigen Sketches ableiten:** wäre ein eigenes Analyse-/Darstellungsprojekt mit anderen fachlichen Grenzen und ist nicht Teil dieses Vorhabens.

## 4. Verbindlicher Ablauf des vorgeschlagenen Modus

1. Der Browser übernimmt den Modus beim Start der jeweiligen Aktion unveränderlich in den Request. Fehlende Angabe bedeutet bisherige Automatik. Der Server validiert den Wert; unbekannte Werte werden nicht stillschweigend akzeptiert.
2. Der normale Tutorablauf entscheidet über Frage, Feedback, Bewertung, Lernphase und Fortschritt. Bei einer möglichen neuen Frage wird im primären Modellaufruf die Grafik ausdrücklich angefordert. Reine Hilfeschritte behalten ihren Textvertrag.
3. Nach Qualitätsprüfung und tatsächlicher Planerentscheidung steht die endgültige Frage fest. Eine bereits gelieferte, akzeptierte Grafik darf nur bleiben, wenn sie noch dieser Frage zugeordnet ist. Eine bei Fragenersetzung entfernte Grafik ist kein erfolgreicher Grafiknachweis.
4. Fehlt für die neue endgültige Frage eine akzeptierte Grafik, folgt **höchstens ein zusätzlicher Generierungsaufruf** ausschließlich für deren Diagramm. Keine rekursive Reparaturschleife und kein erneutes Erzeugen von Frage, Bewertung oder Lernplan. Pro Aktion höchstens ein solcher Zusatzaufruf, auch wenn der bestehende Ablauf intern erneut finalisiert wird.
5. Der Zusatzaufruf verwendet denselben gewählten Modellzugang, den tatsächlich gesendeten Sketch einschließlich Headern/Board, die endgültige Frage und ihre erlaubten Kontextinformationen. Er liefert ausschließlich das erlaubte Grafikfeld. Nicht gezeigte Musterlösungen oder geheime Lehrerhinweise werden dafür nicht zusätzlich offengelegt.
6. Die Grafik durchläuft die vorhandenen Sicherheits- und Formatprüfungen. Das begrenzte Rendererformat bleibt erhalten. Es gibt keinen vollständigen Mermaid-Runtimewechsel und keine Ausführung aktiver Inhalte.
7. Fehlt weiterhin eine Grafik oder scheitert die Zusatzanfrage, bleibt der akzeptierte Lerninhalt nutzbar. Bei der zugehörigen Frage erscheint „Grafik konnte nicht bereitgestellt werden.“ Der technische Grund ist im Debug-Mitschnitt nachvollziehbar; rohe Providerfehler gehören nicht in die Oberfläche.

Es wird zwischen **gelieferter, geprüfter Grafik** auf dem Server und **tatsächlich gerenderter Grafik** im Browser unterschieden. Der Browser darf eine nicht unterstützte Struktur weiterhin ablehnen; dann zeigt er „Grafik konnte nicht dargestellt werden.“ Die Rendererablehnung startet keine weitere Modellschleife.

Kein automatischer zusätzlicher Aufruf im bisherigen Automatikmodus. Kein automatischer Modellwechsel, falls das ausgewählte Modell die Grafikanforderung nicht erfüllt. Alle zusätzlichen Aufrufe zählen zu Laufzeit, Abbruch, Diagnose und Evaluationsbudget.

## 5. Fachliche Integrität und Lebenszyklus

- Die endgültige Frage bleibt für den reinen Grafikaufruf unveränderlich. Keine Übernahme von darin zusätzlich gelieferten Fragen, Ratings, Planerkennungen oder Fortschrittsbehauptungen.
- Bewertung und Lernfortschritt werden aus dem akzeptierten Lernschritt berechnet und höchstens einmal verbucht. Die zusätzliche Grafik erzeugt weder einen Antwortversuch noch neue Kompetenz-Evidenz.
- Der bisherige Abbruchvertrag bleibt erhalten: Ein abgebrochener Vorgang darf keinen neuen Lernzustand übernehmen. Ein bloßes Fehlschlagen der optionalen Grafik darf einen ansonsten gültigen Lernschritt nicht verwerfen.
- Modus, ursprünglicher Request und Antwort bleiben zusammengehörig. Ein Retry wiederholt denselben Request einschließlich Modus. Geänderte Nutzdaten mit alter Aktionskennung werden nicht als identischer Replay behandelt.
- Erfolgreiche Replays nutzen die gespeicherte fachliche Auslieferung; sie lösen keine erneute Zusatzgenerierung aus. Erneutes Öffnen einer Frage, „Weiter“ oder Remounten des Renderers sind ebenfalls keine Generierungsanlässe.
- Kontextwechsel, Reset, DEBUG-Wechsel und Leeren behalten die bestehenden Schutzregeln gegen verspätete Ergebnisse und alte Erfassungsepochen. Der Grafikaufruf ist Teil desselben fachlichen Vorgangs, kein ungebundener Hintergrundjob.
- Das Diagramm soll den Kontext erklären und die gesuchte Antwort nicht vorwegnehmen. Promptregeln, vorhandene deterministische Grenzen und die neuen bekannten Gegenbeispiele bleiben verbindlich. Fachliche Passung und sinngemäßer Lösungsverrat lassen sich dadurch nicht vollständig automatisch garantieren; genau diese Qualität ist später mit echten Modellen zu messen.

## 6. Settings, Anzeige und Diagnose

Die Einstellung nutzt die vorhandenen Settings- und lokalen Speichermechanismen. Es wird weder ein zusätzlicher Bestätigungsdialog pro Grafik noch ein neuer API-Key-Speicher eingeführt. Aus- und Einschalten wirkt ohne Reload auf den nächsten passenden Request; eine laufende Anfrage bleibt bei ihrem gestarteten Modus.

Die Frage und ihre Grafik beziehungsweise ihr Grafikhinweis bilden einen Schritt. Bei einer gehaltenen Folgefrage bleiben beide bis „Weiter“ gemeinsam zurückgehalten. Hinweise und Musterantworten erhalten keine neue Grafikfläche.

Der vorhandene Debug-/Tutor-Review erfasst den angeforderten Modus und die tatsächlichen Stationen: vorhandene Grafik übernommen, wegen Fragenersetzung entfernt, Zusatzanforderung gestartet, Ergebnis angenommen/abgelehnt, kein Ergebnis oder Fehler sowie später die Rendererentscheidung. Die Spur macht auch die Anzahl der Zusatzaufrufe nachvollziehbar. Es gelten dieselben Geheimnisbereinigungen, erlaubten Inhaltsfelder, Größenlimits und Epochenregeln wie bisher; kein zweiter Rohtextlog.

Für den Nutzer wird eine vorhandene gültige Grafik nicht als inhaltlich „richtig bestätigt“ bezeichnet. Technische Bereitstellung und fachliche Qualität sind unterschiedliche Nachweise.

## 7. Betroffene Bereiche und Prüfnachweise

Voraussichtliche Berührungspunkte: `settings-dialog.tsx`, lokale Tutorpräferenz, `use-tutor.ts`, Tutor-Request-/Responseschemas, Routen einschließlich `skip`, Servicefinalisierung, reiner Grafik-Provideraufruf, Replaybindung, Rendererstatusanzeige sowie Debug-/Reviewvertrag. Bestehende Signaturen möglichst kompatibel erweitern; keine unnötigen neuen Startpfadimporte.

Für die spätere Umsetzung mindestens deterministisch prüfen:

1. Standard aus, lokales Speichern, Verhalten nach Reload und unveränderlicher Requestmodus bei Umschalten während einer Anfrage.
2. Auto-Modus behält bisherige Ausgaben und Aufrufzahlen. Bereits gültige Grafik im eingeschalteten Modus benötigt keinen Zusatzaufruf.
3. Nach einer Planer-/Lehrkraftfrage wird gezielt für genau diese endgültige Frage angefordert. Die ursprüngliche unpassende Grafik wird nicht wiederverwendet.
4. Erste Frage, neue Folgefrage und `skip` mit nächster Frage erhalten das neue Verhalten. Hilfe/Klärung, Musterantwort, gehaltene offene Frage und Abschluss ohne nächste Frage erzeugen keine Zusatzanfrage.
5. Genau ein zusätzlicher Generierungsversuch bei fehlender/abgelehnter Grafik; bei erneutem Fehler bleibt Lerninhalt erhalten und der Hinweis sichtbar. Keine erneute Anforderung durch Rendererfehler, Replay oder „Weiter“.
6. Zusatzoutput kann Frage, Bewertung und Fortschritt nicht überschreiben. Abbruch und Kontextwechsel verhindern verspätete Übernahme; erfolgreiche Replayzustellung zählt nichts doppelt.
7. Frage/Grafik/Hinweis bleiben beim Halten und Anzeigen zusammen. Debug und Review bilden Modus, Zusatzaufrufe, Ablehnung und Rendererzustand korrekt und bereinigt ab.
8. Mindestens ein Browserlauf führt von der Settingsänderung durch echte Tutor-Routen und einen kontrollierten Provider bis zur sichtbaren Grafik; ein zweiter Fall zeigt den nutzbaren Text mit fehlgeschlagener Grafikanforderung.

Vorhandene Tests bleiben erhalten; reine Versions-/Hashanpassungen sind mit der tatsächlich geänderten Vertrags-/Promptrevision zu begründen. Für die Abnahme sind die relevanten Suiten, vollständige Unit-Prüfung, Typprüfung, Lint, Dokumentation, beide Knip-Profile (`./run-tests.sh --knip-gate-only`), Build-/Bundlebudget, Tutor-Browserprüfungen und das konkrete Sonar-Gate erforderlich. Der Haupt-Tutorprompt beziehungsweise sein Digest wird bei tatsächlicher Änderung ordnungsgemäß revisioniert; der neue Grafikprompt erhält eine nachverfolgbare Revision.

Echte Tutor-/Judge-Aufrufe bleiben ohne gesonderten Auftrag bei **Budget 0**. Technische Tests verwenden kontrollierte Provider. Die spätere gezielte Live-Prüfung muss neben der sichtbaren Grafik auch fachliche Passung, Lösungsverrat, Laufzeit und tatsächliche zusätzliche Aufrufzahlen erfassen.

## 8. Umsetzungsentscheidungen

Vom Nutzer bestätigt: Settings-Schalter als gewünschte Richtung; Umfang ausschließlich Tutorfragen. Die Bezeichnung, Standard aus, lokale Speicherung, Wirkung ab nächstem Vorgang und begrenzte Nachforderung sind die bisher vorgeschlagenen Konkretisierungen dieses Entwurfs. Modulnamen, konkrete optionale API-Feldnamen, interner reiner Grafikaufruf und kleine Hilfsfunktionen kann die Implementierung anhand bestehender Muster festlegen. Die Beschränkungen und Abnahmekriterien dieses Dokuments dürfen dabei nicht stillschweigend verändert werden.
