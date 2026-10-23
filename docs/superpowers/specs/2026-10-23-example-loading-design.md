# Vorschlag: Zuverlässiges Laden von Beispielen

Status: Angenommen und auf `fix/examples-loading` implementiert; normative Details stehen in der External-Examples-SSOT.
Stand: 2026-10-23. Lieferung: ein PR gegen `feature/browser-emulation`, mit getrennten Commits für Transport, API und Menü.

## Problem und nachgewiesene Ursache

Der laufende Entwicklungsserver liefert für `GET /api/examples` HTTP 503 mit `SOURCE_UNAVAILABLE`. Die zehn Dateien unter `public/examples` sind lesbar; ein direkter Detailabruf für `builtin-01-blink-ino` liefert HTTP 200.

Die Commit-Antwort für `ttbombadil/unosim-examples`, Ref `main`, Revision `bdd4c0a5566bf9d12042d888de4e535555857d14`, war 273.115 Bytes groß. `GitHubRevisionResolver` verwendet dafür das Manifestlimit von 262.144 Bytes. Das eigentliche Manifest hat nur 16.935 Bytes. Mit einem testweise auf 524.288 Bytes erhöhten Limit ließen sich zehn eingebaute und 51 externe Beispiele einschließlich gültiger Tutor-Daten laden.

Zwei Probleme wirken zusammen: Die Commit-Auflösung lädt unnötig Commit-Metadaten und Dateidiffs; das Menü erhält seine eingebauten Beispiele erst, wenn der gemeinsame Katalog einschließlich externer Quelle vollständig geladen ist.

## Alternativen und Empfehlung

| Ansatz | Nutzen | Grenze / Aufwand |
| --- | --- | --- |
| Antwortlimit erhöhen | Kurzfristige Abhilfe | Ein späterer großer Commit kann erneut scheitern; lokale Beispiele bleiben an GitHub gekoppelt. |
| Kompakte SHA-Auflösung und Teilfehler im bisherigen Katalog | Behebt die Ursache und erlaubt einen gemeinsamen Request | Verändert die Fehler- und Metadatenverträge von `/api/examples`; lokale Beispiele warten weiterhin auf dessen Abschluss. |
| Kompakte SHA-Auflösung und separater eingebauter Katalog | Behebt die Ursache; lokale Beispiele laden unabhängig; bisheriger externer Vertrag bleibt erhalten | Ein zusätzlicher lokaler API-Request und getrennte Ladezustände im Menü. |

Gewählt ist der dritte Ansatz. Die unabhängigen Teile sind in getrennten Commits umgesetzt.

## Teil 1: Kleine und begrenzte Commit-Auflösung

- `GitHubRevisionResolver` verwendet denselben kontrollierten Endpoint `/repos/{owner}/{repo}/commits/{ref}` mit `Accept: application/vnd.github.sha`.
- Der sichere Fetcher erhält eine optionale, ausschließlich serverseitig gesetzte Repräsentation `github-commit-sha`. Er nimmt keine frei übergebenen Header entgegen.
- Für diese Repräsentation ist ausschließlich `api.github.com` mit einem Commit-Endpoint zulässig. Raw-Content-Requests behalten ihre bisherigen Header.
- Ein eigenes festes Antwortlimit von **256 Bytes** gilt für die SHA-Antwort. Nach `trim()` muss `fullCommitShaSchema` exakt einen kleingeschriebenen SHA mit 40 Hex-Zeichen akzeptieren. Ein JSON-Fallback auf die große Commit-Antwort ist nicht vorgesehen.
- `UNOSIM_EXAMPLES_MAX_MANIFEST_BYTES` bleibt standardmäßig **262.144 Bytes** und gilt für das Manifest. Die vorgeschlagene Korrektur benötigt keine Erhöhung dieser Einstellung.
- Timeouts, Abbruchsignale, Streaming-Limits, DNS-/Host-Prüfung, Redirect-Verbot, GitHub-Quota und optionale Authentifizierung bleiben aktiv. Der Token wird weiterhin ausschließlich an `api.github.com` übertragen.
- Ein Größenfehler erhält eine intern unterscheidbare Fehlerklasse. Die Ref-Auflösung protokolliert bei Fehlern Phase, Request-ID und sichere Fehler-Metadaten, keine Tokens, Antworttexte oder vollständigen Fehlernachrichten. Öffentliche Fehlercodes bleiben unverändert.

GitHub dokumentiert diese Repräsentation unter [Get a commit](https://docs.github.com/en/rest/commits/commits#get-a-commit). Die Live-Diagnose lieferte damit einen 40 Bytes langen SHA, identisch mit dem SHA der JSON-Antwort.

## Teil 2: Eingebaute Beispiele unabhängig anbieten

### API und Repository

Neuer read-only Endpoint: `GET /api/examples/builtin/catalog`.

Er verwendet `ExamplesRepository.getBuiltInCatalog(): Promise<ExamplesCatalogResponse>` und denselben `BuiltInProvider` wie die bisherigen Routen. Die Antwort entspricht dem bestehenden Built-in-Katalog: `schemaVersion: 1`, `source.mode: builtin`, `source.status: builtin`, `revision: null`, `stale: false`, ausschließlich Einträge mit `source: builtin`.

Der Endpoint akzeptiert keine Auswahlparameter. Seine Berechtigungen entsprechen dem bisherigen Default-Katalog: auch im Gateway-Profil sind anonyme Default-Lesezugriffe erlaubt. Er löst keinen Ref auf und verbraucht kein GitHub- oder Source-Load-Kontingent. Die zwei zusätzlichen Pfadsegmente vermeiden eine Kollision mit dem bisherigen Detailpfad `/api/examples/:id`.

`GET /api/examples` behält sein bisheriges Verhalten einschließlich gemeinsamem Erfolgskatalog und kontrollierter externer Fehler. Validate/Apply bleiben transaktional. Ein vorhandener letzter gültiger Snapshot darf weiterhin ausschließlich für dasselbe Repository und denselben Ref verwendet werden. Weder neue Statuswerte noch eine neue Schema-Version sind erforderlich.

### Client und Menü

- Beim Öffnen startet das Menü beide Katalogabrufe parallel und verarbeitet ihre Ergebnisse einzeln.
- `loadBuiltInExamplesCatalog(signal?)` speichert keine externe Auswahl und schreibt nicht in den globalen externen Katalogzustand. Es nutzt einen eigenen Abbruchcontroller.
- Lokale Einträge kommen aus dem neuen Endpoint. Aus dem bisherigen gemeinsamen Katalog übernimmt das Menü ausschließlich `source: external`. So entstehen keine doppelten lokalen Einträge.
- Beide Gruppen haben getrennte Lade- und Fehlerzustände. Eine Gruppe bleibt bedienbar, während die andere lädt oder fehlschlägt.
- Bei einem externen Fehler zeigt das Menü eine dauerhafte Statusmeldung und eine Schaltfläche `Retry`. Die bestehende englische UI-Sprache bleibt erhalten. Vorgeschlagener Text: `External examples are currently unavailable. Built-in examples are still available.`
- Bei einem Fehler der lokalen Gruppe bleibt eine erfolgreich geladene externe Gruppe nutzbar; ihre Statusmeldung nennt ausschließlich den Ausfall der eingebauten Beispiele. Erst wenn beide Gruppen erfolgreich leer sind, ist `No examples available` korrekt.
- Retry lädt ausschließlich die fehlgeschlagene Gruppe neu. Es gibt keine automatischen Wiederholungsschleifen. Geschlossene Menüs und überholte Antworten dürfen keinen neueren Auswahlzustand überschreiben.
- Die bisherige Quellzuordnung externer Details zu Repository und Revision bleibt erhalten. Laden eines eingebauten Beispiels setzt den aktiven externen Beispielkontext wie bisher zurück. Ein Fehler, Retry oder Katalogabruf verändert weder Editorinhalt noch Browser-Präferenz.
- Die Logik für Board-Rückfragen, Tastaturbedienung und genau einen geöffneten Quell-/Kategorieabschnitt bleibt bestehen. Das neue Built-in-Ergebnis darf insbesondere nicht als erfolgreicher externer Katalog an den Tutor weitergereicht werden.

Die Unabhängigkeit betrifft die externe Quelle. Bei einem Ausfall des UnoSim-Backends gilt weiterhin das bestehende Offline-Verhalten; ein neuer Browser-Offlinecache ist nicht Teil des Vorschlags.

## Tests und Abnahme

1. Branch, Tag und vollständiger SHA werden auf genau einen validierten SHA aufgelöst; unbekannte Refs, malformed/überlange Antworten, Abbruch, Redirect, private DNS-Ziele und Rate Limits bleiben kontrollierte Fehler.
2. Ein großer Commit beeinflusst den Abruf nicht, weil der Request die SHA-Repräsentation anfordert; die Tests prüfen den tatsächlichen Accept-Header und beide Größenprüfungen.
3. Der neue Endpoint liefert eingebautes Material bei absichtlich fehlschlagendem oder nie beantwortetem Source-Provider; kein externer Provideraufruf und kein Quota-Verbrauch.
4. Im Browser sind lokale Beispiele sichtbar und ladbar, bevor ein zurückgehaltener externer Request endet; externe Fehler zeigen Status und Retry.
5. Wiederherstellung, Quellwechsel während laufender Requests, Abbruch sowie Ausfall jeweils nur einer Gruppe erhalten Editor und Auswahl. Erfolgreiche externe Beispiele erscheinen genau einmal und behalten ihre Revision.
6. Reale Abnahme nach Serverneustart bei Default-Konfiguration: aktueller Stand zehn lokale und 51 externe Beispiele; direkte Details und ein externer Tutor-Kontext sind gültig. Diese Zahlen sind eine zeitgebundene Abnahmeevidenz, keine dauerhaft festgeschriebenen Inhaltszahlen in Unit-Tests.

Neue Regressionstests ergänzen die bestehenden Spezifikationen. Unvermeidbare Anpassungen bestehender Test-Erwartungen werden im Umsetzungsplan einzeln begründet; sie dürfen nicht pauschal durch neue Snapshots ersetzt werden.

## Dokumentation und Einordnung

Die Umsetzung aktualisiert zuerst `ssot/ssot_function_definition_ExternalExamples.md`, anschließend ADR 0005, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/USER_GUIDE.md`, `docs/INSTALL_LOCAL.md` und `docs/INSTALL_SERVER.md`. `docs/TESTING_STANDARDS.md` erhält die deterministischen Ausfallszenarien. Betreiber erfahren, dass eine Limit-Erhöhung nur eine Zwischenlösung war und nach der Korrektur nicht erforderlich ist. Das Hinzufügen des Example-Repos zum IDE-Workspace ändert die GitHub-Quelle des laufenden Servers nicht.

Das Example-Repository, seine Beispiele und sein Manifest benötigen für diese Korrektur keine Änderung. Seine Content-Validierung war erfolgreich. Für den Browser-Emulationszweig wird der Abschluss knapp im vorhandenen Statusdokument vermerkt.

Die Entwurfsdateien werden bei Annahme und Umsetzung überprüft; normative Dokumentation beschreibt erst dann das neue Verhalten. Erledigte Pläne werden gemäß `docs/README.md` nach Abschluss entfernt und bleiben in der Git-Historie auffindbar.

## Ergänzungen aus Umsetzung und Review

Ein durch einen anderen Katalogverbraucher abgebrochener externer Abruf endet
im offenen Menü mit Retry statt einem dauerhaften Ladezustand. Beim
Quellenwechsel ignoriert außerdem ein bereits gestarteter Detailabruf die alte
Antwort, bevor er Editor oder Tutor-Kontext verändert. Auch ungültige SHA-Texte
werden mit einer festen, inhaltsfreien `invalid-sha`-Diagnose protokolliert.
Diese Fälle wurden jeweils mit zuerst fehlgeschlagenen Regressionstests geprüft.
