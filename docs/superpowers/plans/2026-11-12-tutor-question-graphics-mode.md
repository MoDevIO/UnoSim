# Umsetzung: Grafiken für Tutorfragen immer anfordern

> Ausführung: inline mit `superpowers:executing-plans`, danach eine unabhängige Gesamtprüfung.

**Spec:** [Freigegebenes Konzept](../specs/2026-11-12-tutor-question-graphics-mode-design.md).

**Ziel:** Lokaler Settings-Schalter; explizite Grafikanforderung für neue endgültige Tutorfragen, höchstens eine gezielte Nachforderung. Automatik bleibt Standard. Keine echten Modellaufrufe.

**Architektur:** Optionaler Requestmodus `graphicsMode: auto | always`; app-eigener Antwortstatus `graphicStatus: provided | unavailable`. Eigenständige Grafikgenerierung im Provider, nach finaler Fragenentscheidung und vor Transaktionscommit. Vorhandene Sicherheitsprüfung und Renderer bleiben maßgeblich. Modus wird je Aktion eingefroren, einschließlich Retry und Replay. Neue Felder laufen durch die bestehenden bereinigten Diagnose-/Reviewverträge.

**Globale Grenzen:** Keine Änderung bestehender fachlicher Tests. Nur notwendige, dokumentierte Prompt-Revisions-/Digestmigrationen. Keine neuen Lösungstexte im Grafikprompt. Kein Zusatzaufruf für Hilfe, offen gehaltene Frage, Weiter oder Replay. Providerfehler erhalten gültigen Lerninhalt, Abbruch verhindert Commit. Budget für echte Tutor-/Judge-Aufrufe: 0. Arbeit im bestehenden Featurebranch in der gemeinsamen IDE.

### Task 1: Verträge und begrenzte Grafikgenerierung

**Dateien:** `shared/tutor{,-requests,-support}.ts`, neues `shared/tutor-graphics.ts`, Provider und neuer Grafikservice, neue Server-Tests.

**Interfaces:** Optionaler Modus, optionaler app-eigener Status; `LLMProvider.generateGraphic` liefert ausschließlich strukturierten, noch ungeprüften Inhalt. Grafikservice nimmt endgültige Frage und vollständigen Sketch entgegen.

1. Neue Tests für fehlenden/ungültigen Modus, höchstens einen Versuch, sichere/unsichere/zusätzliche Ausgabefelder, Credential-/Modellweitergabe und Abbruch schreiben; RED beobachten.
2. Verträge, separaten Grafikprompt mit Revision und Provideraufruf implementieren. Keine Veränderung des Lerninhalts aus Grafikoutput übernehmen.
3. Gezielte Tests erneut ausführen. Expected: alle neuen Tests grün.

### Task 2: Fachlicher Ablauf, Routen und Budget

**Dateien:** Tutorservice, Tutor-/Support-Routen, Evaluationsprovider, neue Service-/Routentests.

**Interfaces:** Task 1; Status erst nach finaler Fragenwahl setzen; kein app-eigener Providerstatus akzeptieren. Mode Bestandteil des bestehenden Fingerprints.

1. RED-Tests für Auto, vorhandene Grafik, Fragenersetzung, Folgefrage, Skip, Hilfe/Retain, Fehler und Abort schreiben.
2. Primären Prompt nur bei `always` ergänzen; nach finaler Auswahl und vor Commit gezielt nachfordern. Frage/Bewertung/Fortschritt bleiben unverändert. Graphikaufrufe als Tutor-Generierungen zählen.
3. Routen und Replay einbinden. Promptrevision und Digest nachvollziehbar migrieren.
4. Neue Tests und `npm run test:tutor-quality`. Expected: grün, Defaultfälle unverändert.

### Task 3: Einstellung, Requestsnapshot und Anzeige

**Dateien:** Settings, Präferenzmodul, `use-tutor`, Lernschritt und MermaidPreview, neue Clienttests.

**Interfaces:** Tasks 1–2; Modus wird vor erstem Await gelesen, bei Retry wiederverwendet. Frage, Grafik und Hinweis bleiben gemeinsam gehalten.

1. RED-Tests für Settings/Persistenz, Requestsnapshot/Retry sowie Fehlerhinweise schreiben.
2. Schalter gemäß Spec, lokale Präferenz und Requestweitergabe implementieren. Rendererfehler nur im expliziten Modus sichtbar machen.
3. Clienttests ausführen. Expected: grün, Weiter erzeugt keinen Request.

### Task 4: Diagnose und kopierbarer Review

**Dateien:** Gemeinsame Review-/Diagnoseverträge, Collector, Browserstore und Export, neue Tests.

**Interfaces:** Tasks 1–3; mode, Status, Zusatzversuch und Grafikpromptrevision sind begrenzte geprüfte Daten. Bestehende Bereinigung, Limits und Erfassungsepochen gelten.

1. RED-Tests für Verlauf mit übernommenem Diagramm, Nachforderung und Fehlschlag sowie Geheimnisbereinigung schreiben.
2. Durchgängige Erfassung und lesbaren Export ergänzen. Kein Rohlog und keine SVG-Aufnahme.
3. Review-/Diagnosetests ausführen. Expected: Modus und tatsächliche Stationen vollständig, bereinigt.

### Task 5: Browsernachweis und Abnahme

**Dateien:** Neuer Browsertest, Benutzerhilfe/SSOT/Befundbericht; notwendige Detailkorrekturen.

**Interfaces:** Vollständiger Pfad Settings → echte Route → kontrollierter Provider → sichtbare Grafik bzw. Fehlhinweis.

1. Browserfälle für Erfolg und fehlgeschlagene Grafik, Wechsel während Anfrage und gehaltene Folgefrage ergänzen. Netzwerk ausschließlich lokal/kontrolliert.
2. Ausführen: neue und bestehende Tutor-Browserspecs ohne Retries, vollständige Unitprüfung, `check`, `lint`, `check:docs`, `./run-tests.sh --knip-gate-only`, Build/Bundlebudget, `git diff --check`, Coverage/Sonar mit konkretem Gateergebnis. Expected: grün; Fehler ursächlich beheben.
3. Eine unabhängige Gesamtprüfung mit frischem Kontext durchführen. Relevante Befunde mit Regressionen korrigieren und betroffene Prüfungen wiederholen.
4. Bericht mit tatsächlichen Aufrufzahlen, DOM-Nachweisen, Grenzen und Prüfergebnissen schreiben. Keine Behauptung echter Modellqualität. Änderungen bleiben bis zum Abschluss reviewbar; Commit-/Integrationsschritt nach verifizierter Umsetzung.
