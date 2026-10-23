# Reliable Example Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Status: Umsetzung vom Nutzer beauftragt, inline auf isoliertem Branch ausgeführt; diese Checkliste dokumentiert die Abnahme.

**Goal:** Kleine Commit-Auflösung und unabhängig verfügbare eingebaute Beispiele bei unveränderten externen Auswahl-, Revisions- und Sicherheitsverträgen.

**Architecture:** PR 1 fordert eine begrenzte SHA-Repräsentation von GitHub an. PR 2 ergänzt einen lokalen Built-in-Katalog und lädt im Menü lokale und externe Gruppen parallel mit getrennten Ergebnissen. Der bisherige gemeinsame Katalog bleibt für bestehende Aufrufer erhalten.

**Tech Stack:** TypeScript, Node.js-Fetch, Express, React, Zod, Vitest, Playwright; keine neue Abhängigkeit.

**Spec:** [Vorschlag und Abnahmekriterien](../specs/2026-10-23-example-loading-design.md).

## Global Constraints

- Der Nutzer hat den Vorschlag und die vollständige Umsetzung einschließlich der beschriebenen Test-Anpassungen beauftragt.
- Ein gemeinsamer PR gegen `feature/browser-emulation` mit getrennten Implementierungscommits; für die Umsetzung eigener Working-Branch und isolierter Checkout. Offene ATtiny85-Arbeiten werden nicht übernommen.
- SHA-Antwortlimit: **256 Bytes**. Nach `trim()` exakt `^[0-9a-f]{40}$`. Manifest-Default bleibt **262.144 Bytes**.
- Neue Route ausschließlich `GET /api/examples/builtin/catalog`; Antwort wiederverwendet `ExamplesCatalogResponse`, Schema-Version **1**.
- Bestehende Routen, Fehlercodes, Auswahlhierarchie, Quota-/LKG-Regeln und Detailbindung an Repository/Revision bleiben unverändert.
- Keine neuen Dependencies, keine Änderungen am Example-Repo und kein persistenter Browser-Contentcache.
- Bestehende Tests sind gemäß `ssot/ssot_agent_policy.md` Spezifikationen. Die unten genannten Erwartungs- und Fixture-Anpassungen benötigen vor ihrer Ausführung die dort geforderte ausdrückliche Zustimmung; neue Tests benötigen keine Umdeutung bestehender Erwartungen.
- Vor einem Push laufen Unit-, Integrations- und E2E-Suite vollständig; Commit- und Pre-Push-Hooks bleiben aktiv.

## Review Focus

- Ein sehr großer Commit muss dieselbe kleine SHA-Antwort nutzen; JSON darf nicht als Ausweichweg das Größenlimit umgehen. Tests in Task 1.
- Ein hängender externer Request darf den ersten sichtbaren und ladbaren lokalen Eintrag nicht verzögern. Tests in Tasks 2 und 3.
- Ein späteres Ergebnis einer alten Browser-Auswahl darf weder neue Einträge noch Tutor-Kontext überschreiben. Tests in Task 3.
- Ein GitHub-Token und der SHA-Accept-Header dürfen nicht auf Raw-Content-Hosts gelangen; Rate Limits und Abbrüche bleiben wirksam. Tests in Task 1.
- Ein externer Ausfall darf weder als erfolgreicher externer Snapshot noch als Editorwechsel erscheinen. Tests in Tasks 2 und 3.

## Vorbereitungen für die spätere Umsetzung

- [x] Basisbranch und vorhandene Änderungen prüfen; einen isolierten Checkout auf dem Working-Branch verwenden.
- [x] Den Vorschlag und die begründeten Test-Anpassungen prüfen lassen. Keine bestehenden Tests vor dieser Zustimmung ändern.
- [x] Ausgangsstand mit TypeScript und den betroffenen vorhandenen Tests prüfen. Vorbestehende Fehler gesondert erfassen.

## Task 1: Kompakte Commit-Auflösung mit Regressionstests und Vertragsdokumentation

**Lieferabschnitt:** 1 auf `fix/examples-loading`.

**Files:**
- Modify: `server/services/examples/http-provider.ts`
- Modify: `server/services/examples/github-revision-resolver.ts`
- Add: `tests/server/examples/github-compact-resolution.test.ts`
- Add: `tests/server/examples/http-provider-representation.test.ts`
- Modify, nach Zustimmung: `tests/server/examples/github-revision-resolver.test.ts`
- Modify: `ssot/ssot_function_definition_ExternalExamples.md`, `docs/SECURITY.md`, `docs/INSTALL_LOCAL.md`, `docs/INSTALL_SERVER.md`

**Interfaces:**
- Extend: `TextFetchOptions { readonly representation?: "github-commit-sha" }` in `http-provider.ts`.
- Extend: `TextFetcher.fetchText(url: URL, maxBytes: number, signal?: AbortSignal, options?: TextFetchOptions): Promise<string>`; bisherige Drei-Argument-Aufrufer bleiben gültig.
- Preserve: `GitHubRevisionResolver.resolve(repository, ref, context): Promise<FullCommitSha>`.
- Add: `ExamplesResponseTooLargeError extends Error` in `http-provider.ts`; beide Größenprüfungen verwenden denselben Typ und behalten einen sicheren, festen Meldungstext.

- [x] **Vertrag ergänzen:** SSOT Abschnitt Ref-Auflösung auf SHA-Repräsentation, eigenständiges 256-Byte-Limit und unveränderte Ref-Arten präzisieren. Die Browser-API bleibt in diesem PR unverändert.
- [x] **Fehlschlagende Tests ergänzen:** `requests the SHA representation for branch, tag and full SHA`; erwarteter Accept-Header ist `application/vnd.github.sha`, Budget 256 Bytes, Rückgabe der validierte SHA. `rejects malformed, JSON and overlong SHA responses`; gültig sind 40 kleine Hex-Zeichen, optional mit abschließendem Whitespace innerhalb des Limits. `honors an aborted context and GitHub rate limits`.
- [x] **Fetcher-Regression ergänzen:** Header nur auf kontrollierten Commit-URLs von `api.github.com`; Ablehnung der Repräsentation auf Raw-/anderen URLs; kein Token auf Raw-URLs; kein JSON-Fallback. Deklariertes und gestreamtes Oversize lösen die neue Fehlerklasse aus, auch wenn kein `Content-Length` vorliegt. Eine kompakte SHA-Antwort wird unabhängig von der Größe der alternativen JSON-Repräsentation verarbeitet.
- [x] **Rot prüfen:** `npx vitest run --project=unit-node tests/server/examples/github-compact-resolution.test.ts tests/server/examples/http-provider-representation.test.ts` muss an der fehlenden Repräsentation scheitern.
- [x] **Fetcher und Resolver implementieren:** Optionen über die vorhandene Fetch-Kette weiterreichen; URL/Host vor Versand prüfen; feste Accept-Auswahl mit optionaler bestehender Authentifizierung kombinieren. Der Resolver verwendet das 256-Byte-Limit und `fullCommitShaSchema.safeParse(text.trim())` statt JSON-Parsing.
- [x] **Sichere Diagnose ergänzen:** Resolver nutzt vorhandenen Logger und `safeErrorLogMetadata`; protokollierte Felder: Phase `resolve-ref`, Request-ID, sicherer Fehlertyp/-code. Keine Rohantwort, URL mit Zugangsdaten oder vollständige externe Fehlernachricht. Öffentliche `SOURCE_UNAVAILABLE`-/`RATE_LIMITED`-Zuordnung bleibt bestehen.
- [x] **Notwendige bestehende Test-Anpassung:** Im bisherigen Resolver-Test wird die erfolgreiche JSON-Antwort `{ sha }` durch SHA-Text ersetzt und der erwartete Fetch-Aufruf um die Repräsentation ergänzt. Begründung: Der ausgehende Transportvertrag ändert sich absichtlich, die erwartete aufgelöste Revision und Fehlercodes bleiben gleich. Der Test für einen ungültigen SHA prüft weiterhin denselben Fehler.
- [x] **Grün prüfen:** `npx vitest run --project=unit-node tests/server/examples` und `npm run check`. Die bisherigen Header-/Redirect-Tests für gewöhnliche Textabrufe bleiben unverändert gültig.
- [x] **Betriebsdokumentation abschließen:** SECURITY beschreibt dieselben Grenzen mit der neuen Repräsentation. INSTALL_LOCAL und INSTALL_SERVER erklären die Korrektur und die Rückkehr vom temporären Manifestlimit zu 262.144 Bytes. Das Entfernen eines konkret gesetzten Overrides erfolgt nur, wenn er ausschließlich wegen dieses Fehlers gesetzt wurde.
- [x] **Reale Abnahme vorbereiten:** Mit unveränderten Defaults den betroffenen Ref auflösen; HTTP 200, validierter 40-Zeichen-SHA und kleiner Body. Den gemeinsamen Katalog mit den realen Beispielen laden; keine feste Live-Inhaltszahl in Unit-Tests verwenden.
- [x] **Review und Commit:** Nur PR-1-Dateien vormerken. Vorschlag: `fix(examples): resolve GitHub refs using compact SHA responses`.

**Ergebnis:** Der aktuelle Fehler ist mit dem bisherigen API-Vertrag behoben. Eingebaute Beispiele sind bis PR 2 weiterhin von der Verfügbarkeit des gemeinsamen Katalogs abhängig.

## Task 2: Unabhängigen Built-in-Katalog bereitstellen und API dokumentieren

**Lieferabschnitt:** 2 auf demselben Branch, nach dem abgeschlossenen Transport-Commit.

**Files:**
- Modify: `server/services/examples/examples-repository.ts`
- Modify: `server/routes/examples.routes.ts`
- Add: `tests/server/examples/builtin-catalog.test.ts`
- Modify, nach Zustimmung: `tests/server/routes/examples.routes.test.ts`
- Modify: `ssot/ssot_function_definition_ExternalExamples.md`, `docs/adr/0005-browser-scoped-external-examples.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`

**Interfaces:**
- Add: `ExamplesRepository.getBuiltInCatalog(): Promise<ExamplesCatalogResponse>`.
- Extend: Repository-Port von `registerExamplesRoutes` um `getBuiltInCatalog`.
- Add route: `GET /api/examples/builtin/catalog`, bestehende Built-in-Metadaten, keine Query-Parameter. Keine Änderung an `ExamplesCatalogResponse` oder `ExamplesSourceMetadata`.

- [x] **Vertrag zuerst ergänzen:** Neuer lokaler Katalog ist unabhängig von der externen Source. Externe Fehler bleiben auf `/api/examples` kontrollierte Fehler; gleiche-Source-LKG und transaktionale Validate-Regeln bleiben normativ erhalten. Kein neuer externer Fallback.
- [x] **Fehlschlagenden Repository-Test ergänzen:** Lokale Fixture mit zwei Beispielen, Source-Provider wirft oder bleibt ungelöst. `getBuiltInCatalog()` liefert trotzdem beide Beispiele und Built-in-Metadaten; `resolve` und `getRevision` werden nie aufgerufen. Keine Quota-/Load-Aktion.
- [x] **Fehlschlagende HTTP-Tests ergänzen:** Endpoint liefert HTTP 200 mit Built-in-Vertrag auch bei externer Störung. Anonymer Gateway-Default-Read bleibt erlaubt; Query-Parameter werden als `INVALID_SELECTION` abgelehnt. `/api/examples/:id` funktioniert unverändert.
- [x] **Notwendige Fixture-Anpassung:** Die vorhandene Route-Test-Harness erhält genau den neuen Repository-Port `getBuiltInCatalog`. Bisherige Routen-, Auth-, Quota- und Fehlerassertionen werden nicht abgeschwächt. Begründung: Der registrierte Repository-Port wurde um eine eigenständige lokale Operation erweitert.
- [x] **Rot prüfen:** `npx vitest run --project=unit-node tests/server/examples/builtin-catalog.test.ts` und `npx vitest run --project=unit-node-http tests/server/routes/examples.routes.test.ts` müssen an fehlendem Port/Endpoint scheitern.
- [x] **Implementieren:** Gemeinsamen BuiltInProvider und den bisherigen Katalog-Mapper verwenden. Bestehender Built-in-only-Zweig kann die neue Methode wiederverwenden. Route vor dem dynamischen Detailhandler registrieren; keine externe Konfiguration oder Browser-Präferenz ändern.
- [x] **Grün prüfen:** Die beiden gezielten Testbefehle und die bestehende Source-Provider-/Cache-Testgruppe bestehen. Bestehende Fehler auf dem gemeinsamen Katalog bleiben identisch.
- [x] **Dokumentation mitliefern:** SSOT erhält Request/Response-Beispiel und Fehlerverhalten. ADR 0005 erhält datierten Nachtrag; ARCHITECTURE zeigt die zwei parallelen Katalogwege. SECURITY dokumentiert Berechtigung und ausschließlich lokale Datenquelle.
- [x] **Commit:** `feat(examples): expose a source-independent built-in catalog`.

**Ergebnis:** Der Server bietet die unabhängige lokale Operation an; der vorhandene Client kann bis Task 3 unverändert weiterarbeiten.

## Task 3: Menü getrennt laden, Ausfälle sichtbar machen und Bedienung prüfen

**Files:**
- Modify: `client/src/lib/external-examples.ts`
- Modify: `client/src/components/features/examples-menu.tsx`
- Add: `tests/client/builtin-examples.test.ts`
- Add: `tests/client/examples-menu.availability.test.tsx`
- Modify, nach Zustimmung: `tests/client/examples-menu.behavior.test.tsx`
- Add: `e2e/examples-availability.spec.ts`
- Modify: `docs/USER_GUIDE.md`, `docs/INSTALL_LOCAL.md`, `docs/INSTALL_SERVER.md`, `docs/TESTING_STANDARDS.md`, `docs/proposals/browser-emulation-status.md`

**Interfaces:**
- Add: `loadBuiltInExamplesCatalog(signal?: AbortSignal): Promise<ExternalExamplesCatalog>` in `external-examples.ts`. Der vorhandene Validator wird wiederverwendet und zusätzlich auf ausschließlich Built-in-Quelle/-Einträge geprüft. Kein Schreiben in externen globalen State oder dessen Generation/Controller.
- Preserve: `refreshExternalExamplesCatalog`, externe Override-Persistenz und Detail-URLs.
- Menu state: je Gruppe Einträge, Ladezustand und Fehler; externe Einträge ausschließlich aus externem Erfolgskatalog. Eine erfolgreiche Gruppe bleibt unabhängig bedienbar.

- [x] **Helper-Test ergänzen und rot prüfen:** `loadBuiltInExamplesCatalog` ruft nur die neue URL auf, reicht das AbortSignal weiter, lehnt falschen Source-/Payload-Vertrag ab und verändert weder Override noch globalen externen Katalog. `npx vitest run --project=unit-client tests/client/builtin-examples.test.ts`.
- [x] **Menütests vor Implementierung ergänzen:** Lokale Antwort wird aufgelöst, externe Antwort bleibt pending; lokale Einträge sind bereits bedienbar. Externes HTTP 503/429 lässt sie bestehen und zeigt Status plus Retry. Fehlende lokale Antwort lässt erfolgreiche externe Einträge bedienbar. Nur zwei erfolgreich leere Gruppen ergeben `No examples available`.
- [x] **Wiederherstellung und Rennen prüfen:** Retry ersetzt nur seine Gruppe; kein Editor-/Präferenzwechsel. Ein Quellwechsel während eines ausstehenden externen Requests unterdrückt dessen verspätetes Ergebnis. Schließen/Abbruch zeigt keinen falschen Fehler. Kombinierter Erfolg enthält lokale und externe IDs jeweils einmal.
- [x] **Rot prüfen:** `npx vitest run --project=unit-client tests/client/examples-menu.availability.test.tsx`.
- [x] **Implementieren:** Beide Abrufe beim Öffnen parallel starten; Ergebnisse nicht mit einem gemeinsam fehlschlagenden `Promise.all` koppeln. Ergebnisse quellbezogen verarbeiten und externe Metadaten weiterhin aus dem externen Katalog beziehen. Eigenen Built-in-Abbruchcontroller verwenden; externe Generation/Abort-Regeln beibehalten.
- [x] **UI-Texte und Retry implementieren:** Dauerhafte, zugängliche Statusmeldung pro ausgefallener Gruppe und `Retry`. Externe Meldung gemäß Design; lokale Meldung benennt ausschließlich die lokale Gruppe. Keine automatische Retry-Schleife und kein zusätzlicher Toast bei jedem Öffnen für denselben Zustand.
- [x] **Bestehende Menütests begründet anpassen:** Fetch-Fixtures auf URL-basierte Antworten für zwei Katalogabrufe umstellen. Die bisherige Erwartung eines Katalogrequests wird durch zwei gezielte URL-Erwartungen ersetzt. Tastatur-, Board-Rückfrage-, Detail- und `onLoadExample`-Assertions bleiben erhalten. Diese Änderungen prüfen den beabsichtigten neuen Ladeablauf.
- [x] **Grün prüfen:** `npx vitest run --project=unit-client tests/client/builtin-examples.test.ts tests/client/examples-menu.availability.test.tsx tests/client/examples-menu.behavior.test.tsx tests/client/external-examples.test.tsx`.
- [x] **Deterministische E2E-Szenarien ergänzen:** Nur den gemeinsamen Katalog im Browser kontrolliert verzögern oder mit HTTP 503 beantworten. Neuen lokalen Endpoint und `builtin-01-blink-ino` wirklich vom Testbackend laden. `Built-in` öffnen, Blink wählen, erwarteten Code im Monaco-Editor prüfen. Zweites Szenario: externer Retry mit synthetischem gültigen Katalog; externe Einträge erscheinen ohne Duplikate, Editor bleibt bis zur Auswahl gleich. Kein echter GitHub-Ausfall und keine neuen visuellen Baselines erforderlich.
- [x] **E2E prüfen:** Devserver vorher beenden; `npm run build` und `npm run test:e2e -- e2e/examples-availability.spec.ts`. Erwartet: alle Szenarien bestanden, keine externen Live-Requests als Testvoraussetzung.
- [x] **Nutzerdokumentation abschließen:** USER_GUIDE erklärt getrennte Ladezustände und Retry; eingebauter Detailabruf braucht weiterhin den UnoSim-Server. INSTALL_LOCAL/INSTALL_SERVER beschreiben SHA-Fix, neuen Diagnoseendpoint und verbleibende Quell-/Netzwerkfehler. IDE-Workspace-Ordner sind keine Runtime-Quellumschaltung. TESTING_STANDARDS dokumentiert deterministische Ausfallsimulation. Browser-Emulationsstatus vermerkt den abgeschlossenen Nachtrag erst nach Abnahme.
- [x] **Commit:** `fix(examples): keep built-in examples usable during external failures`.

**Ergebnis:** Die beiden unabhängigen Datenwege sind im Menü nutzbar; vorhandene Settings-/Tutor-Verträge und Editoraktionen bleiben erhalten.

## Abschließende Prüfung und Übergabe

- [x] Spec und Code gegen alle sechs Abnahmekriterien prüfen, besonders LKG nur derselben Source und neue URL ohne Revisions-/Override-Kontext.
- [x] `npm run check`, `npm run lint`, `npm run check:docs`, `npm run build`.
- [x] Vollständige Läufe: `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`. Vorgeschriebene Commit-/Pre-Push-Hooks einschließlich konfiguriertem Sonar-Gate bestehen. Breitere Docker-Prüfungen nur bei betroffenen Deployment-Verträgen oder entsprechenden CI-Gates.
- [x] Reale Browser-Abnahme im Development-Modus, mit Standard-Manifestlimit: lokale und externe Beispiele ladbar; dann kontrollierter externer Ausfall, lokale Beispiele weiterhin sichtbar und ladbar. Temporäre Diagnosekonfiguration danach entfernen. Keine Änderungen an einem fremden laufenden Devserver ohne entsprechenden Auftrag.
- [x] Dokumentationslinks und Aussagen mit der tatsächlichen Implementierung abgleichen. Kein vorzeitiges Umschreiben normativer Quellen während der Planungsphase.
- [x] PR-Beschreibungen nennen Ursache, neue Verfügbarkeit, Tests und etwaige begründete Test-Anpassungen. Kein Force-Push und kein Überspringen von Hooks.
- [ ] Nach Integration erledigte Entwurfs-/Plan-Dateien entsprechend `docs/README.md` entfernen; fachliche und betriebliche Dokumentation bleibt bestehen.

## Plan-Selbstprüfung

- Ursache und Transportgrenzen: Task 1.
- Unabhängiger API-Pfad und bestehende Source-Semantik: Task 2.
- Sichtbare Verfügbarkeit, Bedienung, Rennen und Tutor-Kontext: Task 3.
- Dokumentation ist jeder auslieferbaren Änderung zugeordnet, keine nachgelagerte Restaufgabe.
- Bestehende Tests und konkret notwendige Erwartungsanpassungen sind getrennt benannt; keine pauschale Erlaubnis zum Ändern von Spezifikationen.
- Inline-Ausführung mit unabhängiger abschließender Gesamtprüfung; Review-Korrekturen sind durch zusätzliche Regressionstests abgesichert.

## Ausführungsentscheidungen und Review

- Die zwei Lieferstufen wurden zu einem PR mit getrennten Commits zusammengefasst, um die vollständig beauftragte Umsetzung ohne Zwischen-Merge zu liefern. Bei gewünschter separater Abnahme können die Commits weiterhin getrennt betrachtet werden.
- Browserprüfungen laufen isoliert auf Port 3100. Nur temporäre, ignorierte Kopien der zwei alten Specs mit festem Port und die Testkonfiguration werden dafür übersetzt; die versionierten Tests bleiben unverändert. Die CI kann regulär Port 3000 verwenden.
- Zwei zusätzliche erfolgreiche Transport-Fixtures in `github-api-budget.test.ts` verwenden ebenfalls SHA-Text statt Commit-JSON. Alle bestehenden Quota-Assertions bleiben erhalten.
- Der im Review benannte bereits bestehende Detail-/Quellenwechsel-Race wurde wegen möglichem Überschreiben von Editor/Tutor mit behoben. Eine alte Auswahl wird verworfen, sobald die Quelle gewechselt wurde.
- Der Diagnosehinweis aus dem Review wurde als ausdrücklich geplante Funktion vollständig umgesetzt: Auch fehlerhafter SHA-Text erhält einen sicheren Logeintrag.
- Unabhängiges Code-Review und ein anschließender Red-Green-Fixdurchlauf sind erfolgt; es wurden keine Befunde zurückgestellt.

## Verifizierter Abschluss

- Node.js 24.20.0; TypeScript, ESLint, Dokumentationsprüfung und Build bestanden.
- 3.594 App-Unit-Tests und 635 Emulator-Unit-Tests bestanden; ein vorhandener Test übersprungen.
- 126 Toolchain-Integrationstests bestanden; ein vorhandener schwerer Test übersprungen.
- 53 Browser-Tests bestanden; isolierter Lauf auf Port 3100.
- Initialer JavaScript-Ladepfad: 690.529 Bytes bei unverändertem Limit 710.000 Bytes.
- Reale Quelle mit Standardlimit: zehn eingebaute und 51 externe Beispiele, Tutor-Daten gültig.
- Beide abschließenden Review-Korrekturen durch Red-Green-Regressionstests und erneute vollständige Läufe geprüft.
