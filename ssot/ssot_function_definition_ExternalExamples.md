# Funktionsdefinition: Dynamische External Examples

Status: implemented

Zielrolle: feature-contract

Ziel-SSOT für Auswahl, Laden, Aktualisierung und Browser-Persistenz externer
Examples. Die Architekturentscheidung liegt in
`docs/adr/0005-browser-scoped-external-examples.md`.

## 1. Ziel und Geltungsbereich

UnoSim SOLL Examples aus einem öffentlichen GitHub-Repository laden können,
ohne dass jede Inhaltsänderung ein UnoSim-Deployment oder einen Serverneustart
erfordert. Server-/Deployment-Konfiguration liefern Default-Repository und
Default-Ref. Ein Nutzer DARF diese Auswahl ausschließlich für den eigenen
Browser überschreiben.

Der initial ausgelieferte External-Examples-Default ist:

- Repository: `ttbombadil/unosim-examples`;
- Ref: `main`.

Ein Ref darf beweglich sein. Vor jedem Snapshot-Load MUSS der Server ihn auf
einen vollständigen 40-stelligen Commit-SHA auflösen. Manifest und Dateien
werden danach ausschließlich aus diesem unveränderlichen Commit geladen.

External-Examples-Repositories sind in dieser ersten Ausbaustufe öffentlich
und SOLLEN öffentlich betrieben werden. Vertraulichkeit und Zugriff auf private
GitHub-Repositories sind nicht Bestandteil des Features. UnoSim benötigt und
speichert dafür keine GitHub-Credentials, Tokens oder Browser-Secrets. Das
Sicherheitsziel ist Integrität und kontrollierte Veröffentlichung, nicht
Vertraulichkeit der Example-Inhalte.

Das zuvor geplante Channel-Modell ist verworfen. Es gibt weder `channel` noch
`channels/stable.json` oder einen gesonderten Publishing-Channel.
`UNOSIM_EXAMPLES_CHANNEL` ist keine Runtime-Konfiguration; seine Verwendung
bleibt als Startup-Tombstone ein harter Konfigurationsfehler, damit ein
veralteter Channel-Betrieb nicht stillschweigend angenommen wird.

## 2. Verbindliche Auswahlhierarchie

Die effektive Auswahl MUSS in dieser Reihenfolge bestimmt werden:

1. Die validierte Server-/Deployment-Konfiguration liefert Default-Repository
   und Default-Ref.
2. Fehlt im Browser ein gültiger Override, gilt dieser Server-Default.
3. Ein gültiger, erfolgreich validierter Browser-Override aus Repository und
   Ref hat ausschließlich für Requests dieses Browsers Vorrang.
4. `Reset to default` entfernt den Browser-Override und verwendet unmittelbar
   wieder den Server-Default.

Der Browser-Override DARF weder Environment noch Default-Snapshot oder Auswahl
anderer Browser verändern. Der Server speichert keine Zuordnung von Nutzern zu
Repositories oder Refs.

Es gibt keine doppelte Source of Truth:

- Config bestimmt den Default;
- Browser-Speicher enthält ausschließlich eine optionale Präferenz;
- die serverseitig aufgelöste Commit-Revision bestimmt den unveränderlichen
  Snapshot einer konkreten Repository-/Ref-Auswahl.

## 3. Eingabe- und Settings-Vertrag

Repository-Eingaben in Settings und Config DÜRFEN folgende Formen besitzen:

- kanonischer Slug `owner/repository`;
- `https://github.com/owner/repository`;
- dieselbe GitHub-URL mit optionalem `.git` und einem optionalen abschließenden
  Slash.

Sie MÜSSEN vor Request- und Cache-Key-Bildung auf den kleingeschriebenen Slug
`owner/repository` normalisiert werden. Die API akzeptiert ausschließlich
diesen kanonischen Slug. Raw-Content-URLs, beliebige Hosts, Credentials, Query,
Fragment und zusätzliche Pfadsegmente sind als Browserinput unzulässig.

Für Repository-Slugs gilt:

- Owner: 1 bis 39 Zeichen, `^[a-z0-9-]+$`, erstes und letztes Zeichen
  alphanumerisch, kein `--`;
- Repository: 1 bis 100 Zeichen, `^[a-z0-9._-]+$`, erstes und letztes Zeichen
  alphanumerisch, weder `.` noch `..`;
- Gesamtwert: maximal 140 Zeichen einschließlich genau eines `/`.

Der Ref ist case-sensitive, 1 bis 128 Zeichen lang und folgt
`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`. Dadurch sind einfache Branches, Tags und
vollständige SHAs erlaubt; Slashes, Backslash, `%`, `:`, `@`, Whitespace,
Unicode, Query und Fragment sind ausgeschlossen. Insbesondere ist `main`
ausdrücklich zulässig. Der Ref ist kein Pfad und keine Raw-URL.

Die Settings MÜSSEN Repository, Ref, den Zustand `Default` oder
`Browser override` sowie `Apply` und `Reset to default` anbieten. Apply bleibt
transaktional: Erst nach erfolgreicher serverseitiger Validate-Antwort wird die
Auswahl gespeichert und aktiviert. Fehler verändern weder bisherige Auswahl
noch Editorinhalt.

Die Repository-/Ref-Auswahl ist vollständig öffentlich. Die Settings bieten
keine Credential-, Token-, Login- oder Private-Repository-Funktion.

## 4. Browser-Persistenz und Datenschutz

Die nicht-sensitive Auswahl DARF unter `unoExternalExamplesSelection` in
`localStorage` gespeichert werden:

```json
{
  "repository": "ttbombadil/unosim-examples",
  "ref": "main",
  "schemaVersion": 1
}
```

Fehlende, unbekannt versionierte oder ungültige Daten werden ignoriert. Reset
löscht den Schlüssel. Kataloge, Revisionen, Fehler und Dateien werden nicht
persistiert. Credentials, Tutor-Daten und andere sensible Daten sind von dieser
Erlaubnis ausdrücklich ausgeschlossen.

## 5. Request-scoped API-Vertrag

Der Browser kontaktiert ausschließlich UnoSim:

```http
POST /api/examples/validate
GET /api/examples
GET /api/examples?repository=owner%2Frepository&ref=main
GET /api/examples/:id?repository=owner%2Frepository&revision=<full-commit-sha>
```

- Fehlende Auswahlparameter beim Katalog bedeuten Server-Default.
- Ein Override MUSS `repository` und `ref` gemeinsam übertragen.
- Partielle, doppelte und unbekannte Parameter werden abgelehnt.
- Ein externes Detail MUSS an Repository und die vom Katalog gelieferte
  vollständige Revision gebunden sein. Built-ins benötigen diese Parameter
  nicht.
- Diese Requests verändern keinen serverseitigen Nutzerzustand.
- Der anonyme Gateway-Default bleibt erlaubt. Overrides und Validate benötigen
  einen akzeptierten `user`; Local Mode verwendet die signierte lokale Session.
- Override-Antworten erhalten `Cache-Control: private, no-store`.

Validate verwendet folgenden Vertrag:

```json
{
  "schemaVersion": 1,
  "selection": {
    "repository": "ttbombadil/unosim-examples",
    "ref": "main"
  }
}
```

Validate löst den Ref auf, lädt und validiert den vollständigen Snapshot und
wärmt denselben source-keyed Cache. Es speichert keine Auswahl. Ein frischer
Cache darf verwendet werden; nach TTL muss die Ref-Auflösung erfolgreich sein.
Ein stale LKG ist kein erfolgreicher Apply-Kandidat.

Eine Katalogantwort enthält mindestens:

```json
{
  "schemaVersion": 1,
  "source": {
    "selection": "default",
    "repository": "ttbombadil/unosim-examples",
    "ref": "main",
    "revision": "0123456789abcdef0123456789abcdef01234567",
    "status": "remote",
    "stale": false
  },
  "examples": []
}
```

`selection` ist `default` oder `browser-override`. Bei reinem Built-in-Betrieb
sind Repository, Ref und Revision null, der Status ist `builtin`. `stale=true`
bedeutet, dass ausschließlich der LKG derselben Repository-/Ref-Auswahl
geliefert wird.

## 6. Ref-Auflösung und atomare Aktivierung

Für öffentliche GitHub-Repositories löst der Server den validierten Ref über
den serverkontrollierten GitHub-Endpunkt
`GET https://api.github.com/repos/<owner>/<repository>/commits/<ref>` auf. Die
Antwort MUSS einen vollständigen kleingeschriebenen SHA gemäß
`^[0-9a-f]{40}$` liefern. Browserinput bestimmt weder Host noch URL-Struktur.

Danach gelten ausschließlich folgende Content-Ziele:

```text
https://raw.githubusercontent.com/<owner>/<repository>/<revision>/manifest.json
https://raw.githubusercontent.com/<owner>/<repository>/<revision>/<file-path>
```

Nach Ablauf des Refresh-TTL wird der Ref beim nächsten Zugriff erneut
aufgelöst:

- unveränderter SHA: vorhandenen Snapshot weiterverwenden und TTL erneuern;
- neuer SHA: Manifest und alle Dateien vollständig laden und validieren;
- erst nach vollständigem Erfolg den Source-Eintrag atomar umschalten;
- bei Fehler ausschließlich den LKG derselben Repository-/Ref-Auswahl stale
  weiterverwenden;
- kein LKG: kontrollierter Fehler, kein fremder Fallback.

Ein Serverneustart ist für eine erfolgreiche Aktualisierung nicht erforderlich.

Beim initialen Default-Repository ist `main` der veröffentlichte Stand.
Unbeabsichtigte Veröffentlichungen werden im Examples-Repository durch einen
geschützten `main` und verpflichtende CI-Prüfungen verhindert. Diese
Repository-Governance ersetzt keine UnoSim-Laufzeitprüfung: UnoSim löst `main`
weiterhin zuerst auf einen Commit-SHA auf, validiert den vollständigen Snapshot,
aktiviert ihn erst danach atomar und behält bei Fehlern den LKG.

## 7. Manifestvertrag

Die effektive Source und Revision stammen ausschließlich aus der validierten
Request-/Config-Auswahl und der serverseitigen Ref-Auflösung. Das Manifest darf
diese Autorität nicht überschreiben.

Die vorhandenen optionalen Manifestfelder `repository` und `ref` bleiben in
Schema-Version 1 aus Kompatibilitätsgründen zulässig. Sie gelten ausschließlich
als informative Legacy-Metadaten:

- sie werden weder zur URL-Bildung noch zur Ref-/Revisionsauswahl verwendet;
- sie müssen nicht vorhanden sein;
- ein fehlender oder historisch abweichender Wert macht einen ansonsten
  gültigen, über den aufgelösten Commit geladenen Snapshot nicht ungültig;
- neue Manifeste SOLLEN `repository` kanonisch angeben und DÜRFEN `ref`
  weglassen.

Damit bleibt das vorhandene Manifest-Schema kompatibel. Es wird kein neues
Pflichtfeld und keine unnötige Breaking-Change eingeführt.

## 8. Cache- und Multi-Browser-Semantik

Der Cache unterscheidet genau:

- Source-Zustand und LKG: `repository + ref`;
- unveränderlicher Snapshot: `repository + revision`.

Mehrere Requests derselben kanonischen Source teilen Cache und Singleflight.
Unterschiedliche Repository-/Ref-Auswahlen besitzen getrennte Keys und Fehler-
zustände. Default und Override dürfen denselben Cacheeintrag teilen, behalten
aber ihr request-spezifisches `selection`-Feld. Caches sind größenbegrenzte,
prozesslokale Betriebsdaten und keine Nutzerpräferenzablage.

## 9. Sicherheitsgrenze

Der Server MUSS weiterhin erzwingen:

- ausschließlich HTTPS;
- operatorseitig erlaubte Hosts, mindestens getrennt für `api.github.com` und
  `raw.githubusercontent.com`;
- keine IP-Literale oder privaten/reservierten Ziele;
- DNS-/SSRF-Prüfung bei jedem Upstream-Zugriff;
- keine Redirects;
- kanonische Repository-/Ref-Werte und sichere Dateipfade;
- Timeouts, Größen-, Datei-, Parallelitäts-, Rate- und Cache-Grenzen;
- strikte GitHub-Response-, Manifest- und Dateischemata;
- vollständige Snapshot-Validierung vor Aktivierung.

Browser können Hosts, Raw-Basis-URLs, Allowlists, Timeouts oder Limits nicht
konfigurieren. Alle Upstream-Zugriffe sind credential-freie Lesezugriffe auf
öffentliche GitHub-Repositories. Private Repositories, GitHub-Authentifizierung,
Tokens, Deploy Keys, GitHub Apps und Browser-Secrets sind ausdrücklich nicht
Bestandteil dieses Vertrags.

## 10. Abgrenzung

Ein persistenter oder prozessübergreifender LKG-Cache bleibt ein getrenntes
Folgethema. Ein gesonderter Channel-Publishing-Workflow ist nicht mehr nötig;
Repository-Maintainer veröffentlichen durch Aktualisierung des konfigurierten
Refs, initial `main`. Branch Protection, Reviewregeln und CI im Examples-
Repository bilden die Veröffentlichungsgrenze; UnoSim bleibt für immutable
Auflösung, vollständige Validierung, atomare Aktivierung und LKG zuständig.


## 11. Unified Course Content scope

This Examples contract is also the source-selection contract for optional Tutor
content. There is exactly one effective repository/ref selection. A valid
browser override therefore affects Examples and Tutor together for that
browser; it remains a personal preference and never changes the operator
default or another browser's selection.

The user-facing Settings concept MAY be renamed from External Examples to
Course Content. The underlying browser key and API names remain compatible
unless a concrete migration is required. A Tutor-specific repository, ref
picker, or browser preference is forbidden.

### 11.1 Embedded Tutor annotation boundary

Example-specific Tutor data is authored only in an optional terminal
`/* @unosim-tutor ... @end-unosim-tutor */` block in the Example's declared
main `.ino` file. The block is extracted and validated by the server while
the immutable Course Content snapshot is loaded. It is not part of the
student-facing Example source and is never passed through the browser editor,
compiler, or simulator. The Tutor receives the validated annotation data as a
separate snapshot field.

There may be zero or one block per Example. Blocks in headers or secondary
files, duplicate blocks, blocks in the middle of executable source, and
unterminated blocks are invalid. A valid block must be followed only by
whitespace. For a structurally recognized but invalid block, the server strips
the block before exposing the source, marks the Tutor capability invalid, and
keeps otherwise valid Examples usable. An unterminated block hides the
recognized suffix through end-of-file; no teacher metadata is exposed or
executed. The complete UTF-8 annotation block is limited to 16 KiB before
YAML parsing. The exact annotation schema and bounded learning-objective rules
are defined in the Course Content and LearningQuestions SSOTs.

## 12. Capability-scoped validation

A repository snapshot has two capabilities:

- Examples core;
- optional Tutor content.

The root manifest is validated in separate phases. Core schema and Examples
references determine Examples validity. The optional Tutor descriptor,
Tutor manifest, referenced topic/strategy files, hashes, and embedded Example
Tutor annotations determine Tutor capability validity.

A Tutor-only validation failure MUST NOT invalidate otherwise valid Examples.
The server SHALL activate valid Examples and mark Tutor capability invalid,
then use the complete built-in Tutor fallback. It MUST NOT activate an
arbitrary subset of Tutor files.

Core failures still invalidate the Examples snapshot according to this
contract. A Course source may therefore be Examples-valid/Tutor-invalid, but
never silently cross-fallback to content from another repository or revision.

Root schema v1 remains the existing Examples-only manifest and remains
unchanged. Root schema v2 may reference an optional Tutor manifest. The
unified format, Tutor schemas, annotation rules, and fallback matrix are
normatively defined in
ssot_function_definition_CourseContent.md.

## 13. Server authority for revision context

Repository, ref, revision, and example metadata sent from the browser are
untrusted request metadata. A browser-provided revision MUST NOT by itself
select the content snapshot.

The server MUST validate or derive the Course revision by resolving the
effective repository/ref or by verifying an exact revision against a
server-known validated Course snapshot. Detail requests and Tutor requests
must use a canonical repository plus a server-authorized full SHA. The exact
Stage B mechanism may be a server-issued context handle or equivalent
server-side verification.

This preserves the existing immutable cache keys:

- source state and LKG: repository + ref;
- immutable snapshot: repository + revision.

## 14. Browser override and Tutor behavior

The browser-scoped override remains request-scoped, non-sensitive, and
personal. It controls both Examples and Tutor for that browser. Apply remains
transactional and Reset returns to the server default.

When an external Example is loaded from revision A, its Tutor context is
revision A. A later ref update to B may affect a new Course context but never
mutates the active Tutor dialog. A source/context change resets the dialog.
Tutor content from A must never be substituted for a missing Tutor snapshot
from B.

The Tutor remains fully functional when no repository is configured, when a
repository has only Examples, or when its Tutor capability is invalid. In
each case the built-in strategy and free Tutor path remain available.
