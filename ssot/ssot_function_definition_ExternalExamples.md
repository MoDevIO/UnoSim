# Funktionsdefinition: Dynamische External Examples

Status: planned

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
