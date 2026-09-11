# Funktionsdefinition: Dynamische External Examples

Status: planned

Zielrolle: feature-contract

Ziel-SSOT für Auswahl, Laden, Aktualisierung und Browser-Persistenz externer
Examples. Die Architekturentscheidung liegt in
`docs/adr/0005-browser-scoped-external-examples.md`.

## 1. Ziel und Geltungsbereich

UnoSim SOLL Examples aus einem öffentlichen GitHub-Repository laden können,
ohne dass jede Inhaltsänderung ein UnoSim-Deployment oder einen Serverneustart
erfordert. Die Server-/Deployment-Konfiguration stellt den Default bereit. Ein
Nutzer DARF diesen Default in den UnoSim-Settings ausschließlich für den
eigenen Browser überschreiben.

Dieses Dokument definiert den Zielvertrag. Die dynamische Auswahl, der
Stable-Channel und die Settings-Oberfläche sind noch nicht implementiert. Bis
zur Implementierung bleibt der in der Serverkonfiguration festgelegte Ref der
wirksame Ist-Vertrag.

## 2. Verbindliche Konfigurationshierarchie

Die effektive Auswahl MUSS in dieser Reihenfolge bestimmt werden:

1. Die validierte Server-/Deployment-Konfiguration liefert Default-Repository
   und Default-Channel beziehungsweise während der Migration einen festen
   Default-Ref.
2. Fehlt im Browser ein gültiger Override, MUSS der Server-Default verwendet
   werden.
3. Enthält der Browser einen gültigen und erfolgreich angewendeten Override,
   MUSS dieser für Examples-Anfragen dieses Browsers Vorrang haben.
4. `Reset to default` MUSS den Browser-Override entfernen und unmittelbar den
   aktuellen Server-Default verwenden.

Der Browser-Override DARF weder Serverkonfiguration noch Prozess-Environment,
Default-Snapshot oder Auswahl anderer Browser verändern. Ein Browser-Override
ist kein administrativer Schreibvorgang. Zwei Browser MÜSSEN gleichzeitig
unterschiedliche Repositories oder Channels verwenden können.

Es gibt keine doppelte Source of Truth:

- Config ist die Source of Truth für den Default.
- Browser-Speicher enthält ausschließlich eine optionale Nutzerauswahl.
- Ein Channel-Dokument bestimmt die aktuell veröffentlichte, unveränderliche
  Revision einer effektiven Repository-/Channel-Auswahl.

## 3. Settings-Vertrag

Die Settings MÜSSEN einen Bereich `External Examples` mit mindestens folgenden
Elementen anbieten:

- Eingabe `Repository`;
- optional Eingabe oder Auswahl `Channel`, Default `stable`;
- sichtbarer Zustand `Default` oder `Browser override`;
- Aktion `Apply`;
- Aktion `Reset to default`.

Die Repository-Eingabe SOLL `owner/repository` sowie normale HTTPS-GitHub-URLs
der Form `https://github.com/owner/repository` akzeptieren. Die UI MUSS die
Eingabe vor dem Speichern auf den kanonischen Wert `owner/repository`
normalisieren. Raw-Content-URLs, Git-Refs, Commit-SHAs, Credentials, Query-
Parameter, Fragmente und beliebige Hosts sind kein primäres UI-Modell und
MÜSSEN als Browser-Override abgelehnt werden.

`Apply` ist transaktional:

1. Der Browser sendet den Kandidaten als typisierte Repository-/Channel-Auswahl
   an die UnoSim-API.
2. Der Server validiert Auswahl, Channel-Dokument, Manifest und alle Dateien.
3. Erst nach einer vollständig erfolgreichen Antwort speichert und aktiviert
   der Browser den Override.
4. Bei syntaktischen, fachlichen oder temporären Fehlern bleibt die zuvor
   funktionierende Browser-Auswahl unverändert. Die UI MUSS den Fehler
   verständlich und ohne interne Serverdetails anzeigen.

`Reset to default` entfernt den persistenten Override. Bereits im Editor
geöffnete Dateien werden weder durch Apply, Reset noch durch einen späteren
Channel-Refresh automatisch ersetzt. Die neue Auswahl wirkt nur auf danach
geöffnete Kataloge und bewusst geladene Examples.

## 4. Browser-Persistenz und Datenschutz

Die normalisierte Repository-/Channel-Auswahl ist eine unkritische
Nutzerpräferenz. Sie DARF in `localStorage` unter dem Schlüssel
`unoExternalExamplesSelection` gespeichert werden, zum Beispiel:

```json
{
  "schemaVersion": 1,
  "repository": "owner/repository",
  "channel": "stable"
}
```

Fehlende, unbekannt versionierte oder ungültige Daten MÜSSEN ignoriert werden;
dann gilt der Server-Default. `Reset to default` MUSS den Schlüssel löschen und
darf keinen Defaultwert als vermeintlichen Override speichern.

Die Persistenz ist an UnoSims Browser-Origin und das verwendete Browserprofil
gebunden, nicht an ein serverseitiges Nutzerkonto. Andere Browser oder
Browserprofile und parallele Requests anderer Nutzer werden nicht beeinflusst.
Personen, die bewusst dasselbe Browserprofil verwenden, teilen dessen
nicht-sensitive lokale Präferenz.

Diese Persistenzerlaubnis gilt ausschließlich für die nicht-sensitive
Repository-/Channel-Präferenz. Sie gilt ausdrücklich nicht für:

- Credentials, Tokens oder sonstige Autorisierungsdaten;
- persönliche Tutor-API-Keys;
- Tutor-Dialoghistorien, Antworten oder Feedbacks;
- sonstige sensible oder personenbezogene Inhalte.

Die strengeren Speicherregeln der Tutor-SSOT bleiben unverändert. Ein
Repository-Override darf niemals Zugangsdaten enthalten oder den Zugriff auf
private GitHub-Repositories voraussetzen.

## 5. Request-scoped API-Vertrag

Der Browser ruft ausschließlich UnoSim auf. Er DARF GitHub,
`raw.githubusercontent.com` oder eine andere Content-Quelle nicht direkt
kontaktieren.

Für die Zielimplementierung werden die bestehenden Routen request-scoped
erweitert:

```http
GET /api/examples
GET /api/examples?repository=owner%2Frepository&channel=stable
GET /api/examples/:id?revision=<full-commit-sha>
GET /api/examples/:id?repository=owner%2Frepository&channel=stable&revision=<full-commit-sha>
```

- Fehlen `repository` und `channel`, verwendet der Request den Server-Default.
- Ein Override MUSS `repository` und `channel` als gemeinsam validierte,
  typisierte Felder übertragen; partielle oder unbekannte Parameter werden
  abgelehnt.
- Die Parameter sind Bezeichner, keine frei zusammengesetzten Source-URLs.
- Ein Detail-Request für ein externes Example MUSS die vom Katalog gelieferte
  `revision` mitsenden; dies gilt auch für die Default-Auswahl. So bleibt das
  geladene Example an genau den Katalog-Snapshot gebunden, auch wenn der Channel
  inzwischen weitergeschaltet wurde. Für ein Built-in ist keine externe
  Revision erforderlich.
- Die API speichert durch diese Requests keine nutzerspezifische Auswahl.
- Der Default-Katalog behält seinen bestehenden Zugriffsvertrag. In Gateway-
  Mode darf ein Override nur für einen akzeptierten `user` aufgelöst werden;
  anonyme Requests dürfen keine neuen externen Source-Keys erzeugen. Local mode
  bindet die Auflösung an seine serverseitig signierte lokale Session.

Eine erfolgreiche Katalogantwort MUSS mindestens folgende Metadaten enthalten:

```json
{
  "schemaVersion": 1,
  "source": {
    "selection": "default",
    "repository": "owner/repository",
    "channel": "stable",
    "revision": "0123456789abcdef0123456789abcdef01234567",
    "status": "remote",
    "stale": false
  },
  "examples": []
}
```

`selection` ist `default` oder `browser-override`. `status` bleibt kompatibel
zu `remote`, `cache` und `builtin`. Bei reinem Built-in-Betrieb sind
`repository`, `channel` und `revision` null; `selection` bleibt `default`.
`stale=true` bedeutet, dass die Channel-Aktualisierung fehlgeschlagen ist und
der letzte gültige Snapshot derselben Repository-/Channel-Auswahl ausgeliefert
wird. Antworten dürfen keine Raw-Source-URL, Serverpfade, Allowlists,
Credentials oder detaillierten Upstream-Fehler offenlegen.

Ungültige Override-Felder führen zu `400`, ein fachlich ungültiger Channel oder
Snapshot zu `422` und eine vorübergehend nicht auflösbare Auswahl ohne
Last-Known-Good zu `503`. Die Antwort enthält einen stabilen, nicht-sensitiven
Fehlercode für die UI. Wenn für dieselbe Auswahl ein Last-Known-Good vorhanden
ist, darf stattdessen `200` mit `status=cache` und `stale=true` erfolgen.

## 6. Stable-Channel-Vertrag

Ein Repository enthält logisch `channels/<channel>.json`. Für `stable` gilt
beispielsweise:

```json
{
  "schemaVersion": 1,
  "revision": "0123456789abcdef0123456789abcdef01234567",
  "manifestSha256": "<sha256>"
}
```

- `revision` MUSS ein vollständiger 40-stelliger Commit-SHA sein.
- `manifestSha256` MUSS ein SHA-256-Wert mit 64 Hexadezimalzeichen sein und den
  Manifestinhalt dieser Revision binden.
- Der logische Channelname ist kein frei wählbarer Git-Branch. Insbesondere
  darf Produktionsinhalt nicht aus `main` geladen werden.
- Nur das kleine Channel-Dokument DARF über einen bewusst dafür vorgesehenen,
  beweglichen Publikationspfad aufgelöst werden. Manifest und Example-Dateien
  MÜSSEN ausschließlich aus der vollständigen Commit-Revision geladen werden.
- Der Server prüft den Channel nach dem konfigurierten Refresh-TTL erneut.
- Eine neue Revision wird vollständig geladen, gehasht und validiert. Erst
  danach wird der aktive Snapshot atomar umgeschaltet.
- Ein Fehler oder Teil-Download darf den aktiven Snapshot nicht verändern.
- Ein Serverneustart ist für eine erfolgreiche Channel-Aktualisierung nicht
  erforderlich.

## 7. Cache-, Last-Known-Good- und Multi-User-Semantik

Der Cache DARF keinen einzigen globalen Source-Snapshot voraussetzen. Er MUSS
mindestens folgende Identitäten unterscheiden:

- Channelzustand und Last-Known-Good: `repository + channel`;
- unveränderlicher Inhaltssnapshot: `repository + revision`.

Last-Known-Good gilt ausschließlich für dieselbe Repository-/Channel-Auswahl.
Ein Snapshot eines anderen Repositorys oder Channels darf niemals als Fallback
ausgeliefert werden. Beim Apply eines neuen Repositorys behält der Browser bis
zur erfolgreichen Kandidatenvalidierung seine bisherige Auswahl; ein
fehlgeschlagener Kandidat wird nicht zu deren serverseitigem LKG.

Mehrere Nutzer mit derselben effektiven Auswahl DÜRFEN denselben validierten,
unveränderlichen Cacheeintrag teilen. Unterschiedliche Auswahlen MÜSSEN
getrennte Cache-Keys besitzen. Caches müssen größenbegrenzt sein und dürfen
nicht als persistente Nutzerdaten oder serverseitige Präferenzablage verwendet
werden. Für die erste Implementierung ist LKG pro Backend-Prozess ausreichend;
ein prozessübergreifender oder neustartfester Cache ist eine gesonderte
Betriebsentscheidung.

## 8. Sicherheitsgrenze

Browser-Eingaben sind untrusted input. Ein Override DARF keine serverseitige
Schutzgrenze verändern. Der Server MUSS weiterhin erzwingen:

- ausschließlich HTTPS für Upstream-Zugriffe;
- eine operatorseitige Allowlist für GitHub und Raw-GitHub;
- keine IP-Literale und keine privaten oder reservierten Zieladressen;
- DNS-/SSRF-Prüfung bei jedem Upstream-Zugriff;
- keine Redirects;
- kanonische Repository-/Channel-Namen und sichere Pfadnormalisierung;
- Timeouts, Größen-, Datei-, Parallelitäts- und Cache-Grenzen;
- strikte Channel-, Manifest- und Dateischemata;
- vollständige Snapshot-Validierung vor Aktivierung.

Der Browser kann weder Hosts noch Raw-Basis-URLs, Allowlists, Timeouts oder
Limits konfigurieren. Private Repositories und browser- oder serverseitig
hinterlegte GitHub-Credentials sind nicht Bestandteil dieses Vertrags.
Override-Auflösung MUSS angemessen rate-limited und gegen unbegrenztes Erzeugen
neuer Cache-Keys geschützt werden.

## 9. Akzeptanzanforderungen für die spätere Implementierung

- Ohne Browserwert wird der Server-Default geladen.
- Ein gültiger Apply speichert die kanonische Auswahl und lädt deren Katalog.
- Ein ungültiger Apply lässt Auswahl und Editorinhalt unverändert.
- Reset löscht den Browserwert und verwendet sofort den Server-Default.
- Zwei Browser können parallel unterschiedliche Repositories verwenden.
- Identische Auswahlen teilen Cacheeinträge; verschiedene Auswahlen nicht.
- Ein Channel-Wechsel aktiviert nur einen vollständig validierten Commit.
- Upstream-Ausfall liefert ausschließlich LKG derselben Auswahl als stale.
- Keine automatische Aktualisierung überschreibt ein geöffnetes Example.
- Der Browser führt keinen direkten Request an GitHub oder Raw-GitHub aus.
- Persistenter Browser-Speicher enthält nur Repository, Channel und
  Schemaversion, niemals Credentials oder Tutor-Daten.

## 10. Abgrenzung und offene Detailentscheidungen

Nicht Bestandteil dieses Dokumentationsschritts sind TypeScript-/React-Code,
API-Implementierung, Settings-UI und Config-Migration.

Vor der Implementierung sind noch festzulegen:

- der konkrete, bewusst bewegliche GitHub-Publikationspfad ausschließlich für
  `channels/*.json` (zum Beispiel ein geschützter `unosim-channels`-Ref);
- exakte Syntax- und Längenlimits für Owner, Repository und Channel;
- Rate-Limit-, Parallelitäts-, LRU- und maximale Source-Cardinality-Werte;
- ob ein neustartfester, integrity-geschützter LKG-Cache betrieblich benötigt
  wird;
- Migration und Benennung eines neuen Default-Channel-Configwerts neben dem
  bisherigen festen `UNOSIM_EXAMPLES_REF`.
