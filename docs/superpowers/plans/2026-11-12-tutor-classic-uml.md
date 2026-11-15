# Klassische UML für Tutorfragen – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Fachlich gebundene, lesbare Aktivitäts-, Klassen- und Sequenzdiagramme im Profil `uml1-classic-v1` aus einer geprüften Struktur darstellen.

**Architecture:** Bestehende Server-/Browserverträge erhalten einen expliziten optionalen Profilwechsel. Ein serverseitiger Parser gewinnt konservative Codebelege; feste Vorlagen erzeugen PlantUML. Ein begrenzter lokaler Prozess liefert geprüftes SVG, das der Browser ausschließlich als Bild verwendet. Artefakte werden einmal gespeichert und von Support/Replay referenziert.

**Tech Stack:** TypeScript, Zod, React/Vitest/Playwright; PlantUML MIT 1.2026.10, Java 21, Smetana/DejaVu-Fonts; serverseitig `@lezer/cpp@1.1.6` und `saxes@6.0.0`.

**Spec:** [Freigegebenes Konzept](../specs/2026-11-12-tutor-classic-uml-design.md).

## Global Constraints

- Nutzerfreigabe am 2026-11-12 umfasst Planung und Umsetzung A–D; keine weitere Übergabefreigabe. Inline im bestehenden Featurebranch und gemeinsamen IDE-Checkout; keine Worktree-/Branchumschaltung über den uncommitteten Bestand.
- Keine echten Tutor-/Judge-Aufrufe. Netzwerk nur für geprüfte Tool-/Paketbereitstellung; Rendern ausschließlich lokal.
- Profil: Aktion/Entscheidung/Merge/Start/Ende und Schleifen; Klasse/Struct/Attribute/Operationen/Generalisierung/Assoziation; synchrone Aufrufe/Rückgaben/Selbstaufrufe/Aktivierungen. Keine erfundenen Codefakten, Kommentare als Aktion, UML-2-Kombinationsfragmente oder grafischer Lösungsverrat.
- 16 KiB Vorschlag; höchstens 12 Knoten/Beteiligte, 24 Kanten/Nachrichten und 24 Klassenmember. 512 KiB SVG; höchstens 2.400 × 4.000 Einheiten, mindestens 14 CSS-Pixel Schrift.
- Renderer: SANDBOX, headless, Metadaten aus, keine Shell/Geheimnisse/URLs/Includes/Dateizugriffe aus Inhalten; maximal 10 s, 256 MiB Java-Heap, zwei aktive Prozesse und acht Wartende. Gesamt-RSS messen, keine harte Prozessbaum-RAM-Garantie behaupten.
- Artefakte: Server 64 MiB global/8 MiB Identität/4 MiB Supportsession; Browser 4 MiB. Reservieren, kanonisch speichern, Referenzen zählen, keine Verdrängung gültiger Replays. Kein persistenter oder nutzerübergreifender Cache.
- `auto`: keine zusätzliche Modellanfrage. `always`: höchstens eine Nachforderung; `not-useful` beendet den Grafikpfad. Renderer-/Kapazitätsausfall darf den gültigen Lerninhalt nicht verwerfen. Commit/Abbruch und Modellauswahl bleiben atomar.
- Alte Protokollaufrufe ohne Profil bleiben kompatibel. Neue Profilaufrufe erhalten ausschließlich neue UML-Artefakte, keinen stillen Mermaid-Ersatz. Fähigkeiten werden vor neuen Requestfeldern gelesen.
- Ein abschließender unabhängig gelesener Gesamtstand, vollständige Gates. Kein automatischer Push/Merge. Bestehende uncommittete Änderungen bleiben erhalten.

## Review Focus

1. Adversarische Beschriftung mit PlantUML-/XML-/Creole-Syntax darf weder einen zweiten Befehl noch eine Ressource erzeugen (Tasks 1, 2, 3).
2. Ein vorhandener Zeilenverweis auf einen Kommentar oder fremden Member darf keine erfundene Aktion/Klasse/Sequenz legitimieren (Task 3).
3. Diagramm kommt nach Abbruch/Contextwechsel, während alte Replays noch gültig sind: weder Commit noch vorzeitige Artefaktfreigabe (Tasks 4, 5).
4. Fehlende Java-/Layout-/Fontinstallation oder ein Fehlerbild trotz stdout darf keinen falschen Erfolg erzeugen (Tasks 1, 2, 7).
5. Lange Bezeichner und schmale/XXL-Ansicht müssen vollständig lesbar bleiben; Zoom/Theme/Weiter dürfen keine neue Generierung starten (Task 6).

## Dateien und Schnittstellen

Neue Module werden unter `server/services/tutor/uml/` nach Vertrag/Quellen/Export/Prozess/Artefakte/Integration getrennt. `shared/tutor-uml.ts` definiert strikte Vorschläge und öffentliche Artefaktdaten; `shared/tutor-uml-profile.ts` enthält kleine frontendtaugliche Konstanten. Binärdateien liegen ausschließlich im ignorierten `cache/tutor-uml/`, Provisionierung/Lockdatei unter `scripts/`.

Öffentliche neue Felder: Request `graphicsProfile?: "uml1-classic-v1"`; Config `tutorGraphics: { profiles: ["uml1-classic-v1"], available: boolean }`. Ohne Profil bleibt der bisherige Vertrag bestehen. Das Modell liefert im JSON das Feld `diagram`; `ProviderQuestionResult.diagramProposal?: unknown` hält es getrennt vom app-eigenen Ergebnis. Der Service liefert `result.diagram` (normalisierte Metadaten) und einen privaten `diagramArtifact`-Handle. Nur die Ausgangskopie erhält daraus `diagram.image` mit SVG/Abmessungen/Rendererrevision. `graphicStatus` wird um `not-useful` ergänzt.

`TutorUmlProposal` ist eine strikte versionierte Union aus `activity`, `class`, `sequence` und `not-useful`, mit `purpose`, `scope` und Code-/Plattformreferenzen; keine Koordinaten und kein Renderertext vom Modell. Activity enthält typisierte `nodes` und `edges`, Class `classes` und `relations`, Sequence `participants` und `messages`. Exakte Feldschemata werden in Task 3 festgelegt und anschließend von allen Tasks importiert.

### Task 1: Echte Renderer-Eignung und fixierte Laufzeit

**Files:** `scripts/tutor-uml-runtime.lock.json`, `scripts/provision-tutor-uml.mjs`, `docs/examples/tutor-uml/`, `tests/scripts/tutor-uml-runtime.test.mjs`, `docs/proposals/report-tutor-classic-uml.md`.

**Interfaces:** Produziert versionierte lokale JAR/JRE-Pfade und drei eigene Renderreferenzen; noch keine produktive Tutorumschaltung.

- [x] Test schreiben: falscher Downloadhash wird verworfen, bereits korrekte Datei wird nicht neu geladen; temporäre Downloads erscheinen nicht als fertige Installation.
- [x] RED: `node --test tests/scripts/tutor-uml-runtime.test.mjs`; Expected: fehlende Provisionierung schlägt fehl.
- [x] PlantUML MIT 1.2026.10 pinnen (SHA256 `30a66b81a16127fd3ec560992f31964fe9ae3f1233c614ef4558a4558a21489e`). Lokale Temurin-JRE 21.0.13+9 aarch64/mac pinnen; weitere Deploymentplattformen in Task 7 ergänzen. Tools nur unter `cache/`, keine globale Installation.
- [x] Eigene Fixtures: Verzweigung plus Rückkante/Guards, zwei Klassen mit Membern/Generalisierung, synchrone Sequenz mit Rückgabe/Selbstaufruf. Tatsächlich mit SANDBOX, 256m und deaktivierten Metadaten rendern.
- [x] SVG-Geometrie/Labels/Pfeile prüfen, Bilder betrachten, in echten Browserbreiten 320/480/800 mit 14px darstellen. Zwei parallele Prozesse inklusive Layout-RSS messen und Abbruch prüfen.
- [x] GREEN: Provisionierungstests und dokumentierte Render-/Sicherheitsnachweise. Bei Nichterfüllung der Spezifikation Bericht statt Produktintegration; kein stiller Rendererwechsel.

### Task 2: Begrenzter Prozess und sichere SVG-Ausgabe

**Files:** `server/services/tutor/uml/{renderer,svg,limits}.ts`, neue entsprechende Tests unter `tests/server/services/tutor/uml/`.

**Interfaces:** `renderTutorUml(source: string, signal?: AbortSignal): Promise<RenderedUmlImage>`; `validateTutorUmlSvg(svg: string): RenderedUmlImage`; feste Fehlercodes und Laufzeitrevision. Kein Modellzugang in diesen Modulen.

- [x] RED-Tests: XML/DTD/Skript/Event/Link/foreignObject/Animation/Übergröße/Abmessungen/Fehlerbilder abweisen; gültige Geometrie unverändert erhalten. Prozesssignal/Timeout/Outputlimit/Queuekapazität/fehlende Runtime prüfen, keine Geheimnisse in Umgebung oder Fehlern.
- [x] Saxes installieren und strikt mit SVG-Element-/Attributliste, ausgeschalteten Fremdressourcen und begrenztem stdout verwenden. Font- und Stilattribute werden kontrolliert normalisiert.
- [x] Feste `spawn`-Argumente ohne Shell, posix-Prozessgruppe für Java/Layoutkinder, Kill+Wait bei Abbruch; kleine faire Queue mit entfernbaren abgebrochenen Wartenden. Runtime vor Verwendung verifizieren und Verfügbarkeit gecacht ohne Nutzdaten prüfen.
- [x] GREEN: echte drei Renderfälle plus kontrollierte Prozessfehler; Unitstub nur für schwer provozierbare Betriebssystemfehler, nicht als Rendernachweis.

### Task 3: Diagrammvertrag, konservative Belege und geschlossener Export

**Files:** `shared/tutor-uml{,-profile}.ts`, `server/services/tutor/uml/{source,validate,export,prompt}.ts`, neue Contract-/Source-/Exporttests und handgeprüfte Fixtures.

**Interfaces:** `validateTutorUmlProposal(input: unknown, context: UmlCodeContext): UmlValidation`; `exportTutorUml(proposal: ValidUmlProposal): string`; `UML_PROMPT_REVISION` und Schema für Modellvorschlag und app-eigene Metadaten. `UmlCodeContext` enthält endgültige Frage, Code, Header, EntryFile und Board.

- [x] RED-Tests für alle drei negativen Screenshotfälle und positive Aktivitäts-/Klassen-/Sequenzfälle. Unbekannte Felder, 16-KiB-/Elementgrenzen, falsche Referenzen/Dateien, Strings/Kommentare, fremde Member und vertauschte Aufrufreihenfolgen müssen ablehnen. `not-useful` ist eigenständiges gültiges Ergebnis.
- [x] Lezer C++ ausschließlich serverseitig installieren. Unterstützte unzweideutige Syntax aus Parsebaum und exakt gesendeten Dateien gewinnen; Parserfehler/Makros/fehlende Definitionen konservativ behandeln. Aktionen und Member verwenden belegte Codebezeichner; keine semantische Verallgemeinerung bloß aus einem Label.
- [x] Feste exporterzeugte IDs/Typen/Kanten/Guards; Bezeichner und Klartext nach realen Angriffstests kodieren. Keine frei erzeugten PlantUML-Zeilen, Includes oder Formatierungsbefehle des Modells.
- [x] Relevanz-/Lösungsverratsrubrik und deterministische bekannte Grenzen ergänzen. Keine Behauptung vollständiger semantischer Beweisbarkeit; keine zusätzliche Bewertung oder Kompilierung.
- [x] GREEN: Quelle → geprüftes Modell → Export → echter Renderer für alle positiven Fälle; Negativfälle dürfen keine Grafik durchwinken. Die echte Frage des IT08.6-Beispiels fixiert verwenden.

### Task 4: Artefaktbudget, Reservierung und Lebenszyklus

**Files:** `server/services/tutor/uml/artifacts.ts`, `learning-support-store.ts`, neue Artefakt-/Supportlebenszyklustests.

**Interfaces:** `TutorUmlArtifacts.reserve(owner, session?)`, `commit(reservation, metadata, image)`, `release(...)`, `reconcileSession(owner, session, handles)`, `wireDiagram(handle, owner)`; privater Handle mit kanonischer Metadaten-/Bildhaltung. Supportstore erhält optionale Lebenszyklushooks, deren Default das bisherige Verhalten unverändert lässt.

- [x] RED: exakt an/über globaler, Identitäts- und Sessiongrenze reservieren; fehlender Platz verhindert neue optionale Arbeit; Abbruch gibt Reservierung frei. Eine Grafik in mehreren Replays zählt einmal. Fremder Nutzer erhält nichts. Ablauf/Entfernen/32er-Replayverdrängung geben nur letzte Referenzen frei.
- [x] Bytebudgets und Referenzdifferenzen implementieren. Übergang requestlokal → neu eröffnete Supportsession ist atomar. Bereits gültige Replays werden nicht zur Platzgewinnung entfernt.
- [x] Supportstore bei open/run/evict/remove die Referenzen aus Frage und gecachten Antworten synchronisieren. Ergebnis nach abgelaufener Session gibt neue ungebundene Artefakte frei.
- [x] GREEN: TTL-/Replay-/Abbruch-/Mehrsessiontests mit kontrollierter Uhr; bisherige Supportstore-Tests unverändert grün.

### Task 5: Durchgängiger Tutor-/HTTP-/Reviewvertrag

**Files:** Provider, Tutorservice/factory und neuer `uml/service.ts`, Tutor-/Support-/Configrouten, gemeinsame Request-/Content-/Review-/Diagnoseschemas und Clientreviewstore/-export. Neue Service-/Route-/Reviewtests.

**Interfaces:** Profiloption bleibt zusätzlich zur bestehenden Modusoption; alte Aufrufarity bleibt ohne Profil gleich. `prepareTutorUml(provider, finalQuestionContext, options)` verwendet Tasks 2–4 und liefert Appstatus, normalisierte Metadaten und privaten Handle; `serializeTutorDiagram` ergänzt ausschließlich die Ausgangskopie.

- [x] RED: Auto ohne Zusatzmodellaufruf; Always maximal eine Nachforderung; vorhandenes passendes Diagramm behalten; explizites not-useful beendet; fehlender Renderer/Budget verhindert Zusatzaufruf. Modellalias, endgültige Planerfrage, Retain/Update/Codewechsel, Skip/Completion, Hilfe/Referenz, Abort und Replay prüfen.
- [x] Profilfähigkeiten in `/api/config`; Providerparser separiert `diagram`-Vorschlag vom Lerninhalt. Ungültiger Grafikvorschlag verwirft keinen gültigen Frage-/Bewertungsteil. Neue Promptrevision samt tatsächlichem Digest; extra Aufruf zählt als Tutor, nicht Judge.
- [x] Finale Vorbereitung vor Commit; Requestsnapshot/Fingerprint/Privatbindung korrekt. Die HTTP-Antworten enthalten ausschließlich das zugehörige Artefakt, der Cache nur Handle/Metadaten. Keine zweite Datenhaltung im Rohlog.
- [x] Review enthält Profil/Art/Vorschlag/Referenzen/Entscheidungen/Rendererrevision und Grenzen, niemals SVG/Privathandle/Providerrohdaten. Idempotente Bereinigung und bisherige Limits erhalten. Neue Quellenfelder zählen zur Exportgröße und werden nach Bereinigung nicht gekürzt.
- [x] GREEN: alle neuen Service-/HTTP-/Reviewtests und `npm run test:tutor-quality` einschließlich alter Verträge.

### Task 6: Profilbewusster Browser, Bilddarstellung und Zoom

**Files:** `use-tutor.ts`, `tutor-learning-step.tsx`, neuer `tutor-uml-preview.tsx`, Profil-/Bildbudget-Helfer, neue Clienttests und `e2e/tutor-classic-uml.spec.ts`.

**Interfaces:** Fähigkeiten erlauben `graphicsProfile` vor erstem Await zu snapshotten, ebenso bei Retry. SVG wird nur via geprüftem Blob/`img` gezeigt; kein innerHTML. Aktive/held Artefakte zusammen maximal 4 MiB, keine Bilder im Verlauf/Review.

- [x] RED: ältere Server bekommen kein neues Requestfeld. Neue Requests übernehmen Profil/Modus bei Start und Retry; Bild/Ausfall/not-useful bleiben bei gehaltenen Fragen verborgen. Blob wird nur zur aktuellen Frage gezeigt und nach Wechsel/Unmount freigegeben.
- [x] Bildvorschau mit natürlicher Größe und mindestens 14px, Scrollen, beschriftetem Zoomdialog, Escape und Fokus-Rückgabe. Ein Bild für beide Themes auf hellem Grund, keine Neurenderung bei Theme/Zoom/Weiter. Legacyantworten ausdrücklich als altes Format behandeln.
- [x] Echter Browserpfad Settings → echte API → kontrollierter Provider → echter PlantUML-Prozess. Für Aktivität/Klasse/Sequenz Geometrie und Bezug prüfen, negative Beispiele ablehnen, Fehler/not-useful nutzbar anzeigen. Breiten 320/480/800 plus XXL und Tastatur prüfen.
- [x] GREEN: neue Client-/Browsertests, alte Tutorläufe ohne abgeschwächte Assertions. Bestehende rein auf Mermaid ausgerichtete E2E-Fixtures `tutor-debug-graphics`, `tutor-review`, `tutor-mocked-lifecycle`, `tutor-question-graphics-mode` dürfen ihre Config explizit als Legacyserver deklarieren; die neuen UML-E2Es belegen den neuen Pfad. Das ist eine Protokollfixture-Migration, keine Entfernung ihrer Sicherheits-/Lebenszyklusassertionen.

### Task 7: Bereitstellung, Dokumentation und vollständige Abnahme

**Files:** Runtime-Provisionierung/Lock, Dockerfile, Installer/Deploymentkonfiguration, CI-Testpfad, Benutzerhilfe/SSOT/Formatbeschreibung/Testmatrix, Arbeitsbericht.

**Interfaces:** Produktiver Renderer verwendet dieselbe gepinnte Distribution/Fonts wie Task 1. Fehlende Abhängigkeiten ergeben verfügbare Textfunktionen plus festen Grafikfehler; keine spontane Installation beim Request.

- [x] RED: Provisionierungs-/Deploymentnachweise erkennen falsche Hashes, fehlende JRE/Fonts/Layoutengine und falsche Artefaktarchitektur; kein Credential/Netz/Quelldatenmetadata in Bildern.
- [x] Linux amd64/arm64 und lokale Entwicklungsplattform reproduzierbar bereitstellen; Download und Prüfung nur im Installations-/Buildschritt. Lizenzen/Versionen dokumentieren. Zielplattform mit zwei Renderern und Prozessbaum-RSS messen; nicht ausführbare Plattformprüfungen klar als offen statt bestanden ausweisen.
- [x] Vollständige Units/Coverage, Typen, Lint, beide Knip-Profile, Docs, Build-/Bundlebudget, sämtliche Tutor-Browserfälle ohne Retry; notwendige Renderer-/Deploymentintegration. Sonar-Gate über konkrete Analyse-ID prüfen.
- [x] Ein frischer unabhängiger Gesamtprüfer; wichtige Befunde durch rote/grüne Regressionen korrigieren. Bericht enthält echte Rendererbilder/Versionen, zwölf Qualitätsfälle, Beweisgrenzen, Migrationen und Kosten. Keine echte Modellqualität aus Fakes ableiten.
- [x] Abschluss: konkrete reviewbare Änderungen, keine weiteren Freigabeschleifen innerhalb des autorisierten Umfangs; kein Push/Merge dieses Features ohne Auftrag.

## Abschlussstand

A–D am 2026-11-13 umgesetzt und unabhängig nachgeprüft. Alle Abschlussgates
bestanden; [Arbeitsbericht](../../proposals/report-tutor-classic-uml.md) und
[Gesamt-/Nachprüfung](../../proposals/review-tutor-classic-uml-2026-11-13.md).
Live-Messung E bleibt bei 0 Aufrufen und ist nicht Teil dieser Abnahme.
Kein Commit/Push/Merge; vorhandener gemeinsamer Featurecheckout bleibt erhalten.
