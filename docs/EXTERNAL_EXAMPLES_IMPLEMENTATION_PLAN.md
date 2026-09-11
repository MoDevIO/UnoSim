# Implementierungsplan: Browser-scoped External Examples

Status: ready-for-implementation

Basis:

- [`../ssot/ssot_function_definition_ExternalExamples.md`](../ssot/ssot_function_definition_ExternalExamples.md)
- [`adr/0005-browser-scoped-external-examples.md`](adr/0005-browser-scoped-external-examples.md)

Dieser Plan konkretisiert ausschließlich die für die Implementierung noch
blockierenden Eingabe-, Config-, API-, Cache-, Concurrency- und Testdetails. Er
ändert keine Sicherheitsgrenze und enthält noch keine Codeänderung.

## 1. Geltungsbereich und Nicht-Ziele

Im Scope liegen:

- Browser-Override für öffentlich erreichbare GitHub-Repositories;
- Default-/Legacy-Config-Migration;
- typisierte Validate-, Catalog- und Detail-Requests;
- pro Source getrennte, prozesslokale Channel- und Revision-Caches;
- Limits, Singleflight, Concurrency und LRU;
- Settings- und Examples-Menu-Integration;
- automatisierte Vertrags-, Security-, Cache-, Route- und UI-Tests.

Explizite Folgethemen und nicht Bestandteil dieser Umsetzung sind:

- Authoring, Review, CI und Publikationsworkflow im Examples-Repository;
- Auswahl und Betrieb des beweglichen Publikationspfads für
  `channels/*.json`;
- persistenter oder prozessübergreifender Last-Known-Good-Cache.

Der Server erhält für den Channel-Zugriff eine injizierbare
`ChannelDocumentLocator`-Grenze. Deren produktiver Publikationspfad wird im
separaten Publikationsworkflow festgelegt; Tests verwenden ausschließlich
kontrollierte Fixture-Locators.

## 2. Verbindliche Eingabesyntax und Maximalgrößen

Query-Werte werden durch den HTTP-Parser genau einmal percent-dekodiert; JSON-
Bodywerte werden nicht percent-dekodiert. API-Schemas akzeptieren nur bereits
kanonische ASCII-Werte. Die Settings-UI und der serverseitige Config-Resolver
normalisieren ihre jeweiligen Eingabeformen vor der API- beziehungsweise
Cache-Key-Bildung. Whitespace, Steuerzeichen, Unicode, Backslash, zusätzliche
Slashes, Query, Fragment und Credentials sind ungültig.

### 2.1 Repository

Der API-Vertrag akzeptiert ausschließlich den kanonischen Slug
`owner/repository`. Nur die Settings-Eingabe darf zusätzlich eine normale URL
`https://github.com/owner/repository` akzeptieren und vor dem Request in den
Slug umwandeln.

| Teil | Verbindlicher Vertrag |
|---|---|
| Owner | 1 bis 39 Zeichen; Zeichenmuster `^[a-z0-9-]+$`; erstes und letztes Zeichen alphanumerisch; kein `--` |
| Repository | 1 bis 100 Zeichen; Zeichenmuster `^[a-z0-9._-]+$`; erstes und letztes Zeichen alphanumerisch |
| Gesamter Slug | höchstens 140 Zeichen einschließlich genau eines `/` |
| Zusätzliche Ausschlüsse | Repository `.` und `..`; leere Segmente; `.git` wird nur bei einer Settings-URL entfernt und ist im API-Slug ungültig |

Die UI darf Groß-/Kleinschreibung und bei einer URL genau einen abschließenden
Slash entgegennehmen, speichert und sendet aber die kleingeschriebene
kanonische Form. Das API-Schema weist nicht-kanonische Slugs ab. Der
serverseitige Config-Resolver normalisiert bestehende GitHub-Source-Werte nach
denselben Regeln, damit unterschiedliche Schreibweisen keinen Cache
vervielfachen.

### 2.2 Channel

- Länge: 1 bis 32 Zeichen.
- Zeichenmuster: `^[a-z0-9._-]+$`; erstes und letztes Zeichen müssen
  alphanumerisch sein.
- `.` und `..` sind ausgeschlossen.
- Der Wert wird kleingeschrieben.
- `/`, `\\`, `%`, `:`, `@`, Whitespace und Unicode sind ausgeschlossen.
- UI-Default und neuer Server-Default sind `stable`.

Der Channel ist ein logischer Name und niemals ein vom Browser frei gelieferter
Git-Branch oder Pfad.

### 2.3 Revision und Manifest-Hash

- `revision` ist ausschließlich ein vollständiger kleingeschriebener Git-
  Commit-SHA mit exakt 40 Hexadezimalzeichen:
  `^[0-9a-f]{40}$`.
- `manifestSha256` besitzt exakt 64 kleingeschriebene Hexadezimalzeichen:
  `^[0-9a-f]{64}$`.
- Die Revision ist kein Settings-Wert. Sie kommt aus dem validierten Channel-
  Dokument beziehungsweise aus der Katalogantwort und bindet den Detailabruf.

`UNOSIM_EXAMPLES_REF` behält während der Migration seine bisherige Ref-Syntax
`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`. Diese Legacy-Syntax darf nicht für
Browser-Overrides oder Channel-Revisionsparameter wiederverwendet werden.

## 3. Config-Migration und Kompatibilität

### 3.1 Zielwerte

Neu eingeführt wird `UNOSIM_EXAMPLES_CHANNEL`. Der Default ist `stable`, wenn
eine GitHub-kompatible `UNOSIM_EXAMPLES_SOURCE` gesetzt und
`UNOSIM_EXAMPLES_REF` leer ist. `UNOSIM_EXAMPLES_REFRESH_MS` bleibt das
Channel-Prüfintervall mit dem bestehenden Default von 300000 ms.

Die Startup-Matrix ist verbindlich:

| Source | Ref | Channel | Ergebnis |
|---|---|---|---|
| leer | leer | leer | nur Built-ins |
| leer | gesetzt | beliebig | Startup-Fehler |
| leer | leer | gesetzt | Startup-Fehler |
| gesetzt | gesetzt | leer | kompatibler Legacy-Fixed-Ref-Modus |
| gesetzt | leer | leer | Channel-Modus mit `stable` |
| gesetzt | leer | gesetzt | Channel-Modus mit validiertem Channel |
| gesetzt | gesetzt | gesetzt | Startup-Fehler; keine implizite Präzedenz |

Channel-Modus erfordert, dass `UNOSIM_EXAMPLES_SOURCE` eindeutig auf ein
unterstütztes öffentliches GitHub-Repository normalisiert werden kann. Andere
bisher erlaubte HTTPS-Quellen bleiben nur im Legacy-Fixed-Ref-Modus kompatibel.

### 3.2 Legacy-Verhalten

- `UNOSIM_EXAMPLES_REF` wird in dieser Umsetzung nicht entfernt und nicht
  automatisch als Channel interpretiert.
- Bestehende gültige Tags und Ref-Namen bleiben im Default-Legacy-Modus mit dem
  bisherigen Ladeverhalten funktionsfähig.
- `main` bleibt in Produktion verboten.
- Legacy-Modus pollt keinen Channel und verspricht keinen revisionsgebundenen
  Detailabruf. Er ist eine ausdrücklich befristete Kompatibilitätsschicht.
- Die neue UI akzeptiert einen Legacy-Default, zeigt ihn als `Default (fixed
  ref)` und verwendet für dessen Detailabrufe den bisherigen Pfad ohne
  `revision`.
- Browser-Overrides verwenden auch dann ausschließlich das neue Channel-Modell,
  wenn der Server-Default noch im Legacy-Modus läuft.
- Eine spätere Entfernung von `UNOSIM_EXAMPLES_REF` benötigt eine eigene
  Deprecation-/Release-Entscheidung und ist nicht Teil dieser Implementierung.

Die additive Response-Metadaten-Union enthält dafür vorübergehend den Modus
`legacy-ref`; nur in diesem Modus darf `revision` neben `builtin` null sein. Das
ist eine Migrationsausnahme, keine Erweiterung der erlaubten Channel-Revision.

### 3.3 Entwicklungs- und Deployment-Defaults

- `package.json`: Der Dev-Start wird nach Verfügbarkeit des Channel-Locators von
  `UNOSIM_EXAMPLES_REF=v1.0.0` auf `UNOSIM_EXAMPLES_CHANNEL=stable` umgestellt.
- `docker-compose.yml`: `UNOSIM_EXAMPLES_CHANNEL` und die neuen Limits werden
  als optionale Environment-Werte durchgereicht.
- Bestehende Deployments mit `UNOSIM_EXAMPLES_REF` starten unverändert im
  Legacy-Modus. Betreiber müssen nicht gleichzeitig migrieren.

## 4. Typen und Interfaces

### 4.1 Shared API-Typen

Neue Datei `shared/examples.ts`:

```ts
type RepositorySlug = string;
type ExamplesChannel = string;
type FullCommitSha = string;

type ExamplesRequestSelection =
  | { kind: "default" }
  | {
      kind: "browser-override";
      repository: RepositorySlug;
      channel: ExamplesChannel;
    };

type ExamplesSourceMetadata =
  | {
      selection: "default";
      mode: "builtin";
      repository: null;
      channel: null;
      revision: null;
      status: "builtin";
      stale: false;
    }
  | {
      selection: "default" | "browser-override";
      mode: "channel";
      repository: RepositorySlug;
      channel: ExamplesChannel;
      revision: FullCommitSha;
      status: "remote" | "cache";
      stale: boolean;
    }
  | {
      selection: "default";
      mode: "legacy-ref";
      repository: RepositorySlug | null;
      channel: null;
      revision: null;
      status: "remote" | "cache" | "builtin";
      stale: boolean;
    };

interface ValidateExamplesRequest {
  schemaVersion: 1;
  selection: {
    repository: RepositorySlug;
    channel: ExamplesChannel;
  };
}

interface ValidateExamplesResponse {
  schemaVersion: 1;
  valid: true;
  source: Extract<ExamplesSourceMetadata, { mode: "channel" }>;
}

interface ExamplesCatalogResponse {
  schemaVersion: 1;
  source: ExamplesSourceMetadata;
  examples: ExampleCatalogItem[];
}

interface ExampleDetailResponse {
  schemaVersion: 1;
  id: string;
  title: string;
  category: string;
  description?: string;
  main: string;
  source: "builtin" | "external";
  revision: FullCommitSha | null;
  files: ExampleFile[];
}
```

Die konkreten Zod-Schemas und TypeScript-Typen kommen aus derselben Definition,
damit Route und Client keine parallelen Handtypen pflegen. `shared/input-limits.ts`
erhält die genannten Zeichenlimits; `server/services/examples/examples-schema.ts`
behält Manifest-/Dateischemas und ergänzt Channel-Dokument und API-Parsing.

### 4.2 Server-Interfaces

```ts
interface ResolvedExamplesSelection {
  selection: "default" | "browser-override";
  mode: "builtin" | "legacy-ref" | "channel";
  repository: RepositorySlug | null;
  channel: ExamplesChannel | null;
  legacySource?: URL;
  legacyRef?: string;
}

interface ChannelDocument {
  schemaVersion: 1;
  revision: FullCommitSha;
  manifestSha256: string;
}

interface ChannelDocumentLocator {
  locate(repository: RepositorySlug, channel: ExamplesChannel): URL;
}

interface ExamplesRepository {
  validate(selection: BrowserOverrideSelection, context: RequestContext): Promise<ExamplesSourceMetadata>;
  getCatalog(selection: ExamplesRequestSelection, context: RequestContext): Promise<ExamplesCatalogResponse>;
  getExample(selection: ExamplesRequestSelection, revision: FullCommitSha | undefined, id: string, context: RequestContext): Promise<ExampleDetailResponse | null>;
}
```

`RequestContext` enthält nur die bereits vertrauenswürdig ermittelte Identität,
Request-ID und Abort-Signal, keine gespeicherte Browserauswahl.

### 4.3 Client-Interfaces

Neue Module:

- `client/src/lib/external-examples-selection.ts`: Storage-Schema,
  GitHub-URL-Normalisierung, `useSyncExternalStore`-kompatibler Store, Apply und
  Reset;
- `client/src/lib/examples-api.ts`: alleinige Konstruktion der typisierten
  Validate-, Catalog- und Detail-Requests;
- optional `client/src/hooks/use-external-examples.ts`: verbindet Auswahl,
  Katalogstatus und Reload für Settings und Examples Menu.

Der Store persistiert ausschließlich `{schemaVersion, repository, channel}`.
Kataloge, Revisionen, Fehler und Example-Dateien bleiben im RAM.

## 5. Request-/Response-Verträge

Alle Requests verwenden den bestehenden REST-Major-Vertrag und werden additiv
eingeführt. Unbekannte Body- oder Query-Felder, doppelte Query-Werte und
partielle Override-Auswahlen werden abgelehnt. Override-Antworten erhalten
`Cache-Control: private, no-store`; der kontrollierte Cache liegt im Backend,
nicht in Browser- oder Proxy-Caches.

### 5.1 Validate und Apply

```http
POST /api/examples/validate
Content-Type: application/json

{
  "schemaVersion": 1,
  "selection": {
    "repository": "owner/repository",
    "channel": "stable"
  }
}
```

Erfolg `200`:

```json
{
  "schemaVersion": 1,
  "valid": true,
  "source": {
    "selection": "browser-override",
    "mode": "channel",
    "repository": "owner/repository",
    "channel": "stable",
    "revision": "0123456789abcdef0123456789abcdef01234567",
    "status": "remote",
    "stale": false
  }
}
```

Validate lädt und validiert den vollständigen Kandidaten-Snapshot und wärmt
denselben source-keyed Cache, verändert aber keinen Server- oder Browserzustand.
Ein noch nicht abgelaufener, erfolgreich geprüfter Cacheeintrag darf dafür
verwendet werden. Nach TTL-Ablauf muss Validate den Channel frisch erfolgreich
prüfen; ein stale LKG führt bei Apply zu einem Fehler und darf den neuen
Browser-Override nicht aktivieren. Es gibt keinen serverseitigen
`/apply`-Endpunkt.

Die UI-Aktion Apply ist exakt diese Transaktion:

1. Draft lokal normalisieren.
2. `POST /api/examples/validate` senden.
3. Nur nach `200` die vom Server kanonisch zurückgegebenen Werte unter
   `unoExternalExamplesSelection` speichern.
4. Den Selection-Store benachrichtigen und den Catalog-Request auslösen.
5. Bei jedem Fehler Storage, bisherigen Katalog und Editor unverändert lassen.

Reset löscht den Storage-Key, aktualisiert den Selection-Store und ruft danach
`GET /api/examples` ohne Override-Parameter auf. Es gibt keinen Reset-Request an
den Server.

### 5.2 Catalog

Default:

```http
GET /api/examples
```

Browser-Override:

```http
GET /api/examples?repository=owner%2Frepository&channel=stable
```

Erfolg `200` folgt `ExamplesCatalogResponse`. Bei Channel-Modus enthält
`source.revision` immer den vollständigen Commit-SHA. Der Catalog darf Built-ins
und External Examples wie bisher gemeinsam enthalten; `source` beschreibt die
effektive externe Auswahl des Requests.

Beim Öffnen des Menüs wird der Katalog erneut angefragt. Zusätzlich löst eine
Apply-/Reset-Änderung sofort einen neuen Request aus. Ein periodischer Browser-
Poll ist nicht erforderlich; der Server revalidiert den Channel bei der ersten
Katalog- oder Validate-Anfrage nach Ablauf des TTL.

### 5.3 Example-Detail

Built-in oder Legacy-Default:

```http
GET /api/examples/:id
```

Channel-Default:

```http
GET /api/examples/:id?revision=<full-commit-sha>
```

Browser-Override:

```http
GET /api/examples/:id?repository=owner%2Frepository&channel=stable&revision=<full-commit-sha>
```

Der Client verwendet Auswahl und Revision des aktuell sichtbaren Katalogs. Der
Server liefert nur exakt diesen Revision-Snapshot; er darf beim Detailabruf
nicht still auf die inzwischen neuere Channel-Revision wechseln. Ist der
Snapshot nicht mehr im Cache, darf er über denselben vollständigen SHA erneut
geladen und validiert werden. Ein anderes LKG ist kein Ersatz.

Der bestehende Detailwert `source: "builtin" | "external"` bleibt aus
Kompatibilitätsgründen unverändert. Additiv kommen `schemaVersion` und
`revision` hinzu; die umfangreichen Auswahlmetadaten bleiben im Katalog und
kollidieren dadurch nicht mit dem bestehenden `source`-Feld des Examples.

### 5.4 Fehlervertrag

```ts
interface ExamplesErrorResponse {
  schemaVersion: 1;
  error: {
    code:
      | "INVALID_SELECTION"
      | "INVALID_REVISION"
      | "INVALID_CHANNEL"
      | "INVALID_SNAPSHOT"
      | "SOURCE_UNAVAILABLE"
      | "EXAMPLE_NOT_FOUND"
      | "RATE_LIMITED"
      | "LOAD_CAPACITY_EXCEEDED";
    message: string;
    retryAfterSeconds?: number;
  };
}
```

| HTTP | Verwendung |
|---:|---|
| 400 | ungültige, partielle, doppelte oder unbekannte Auswahlparameter |
| 401/403 | Override in Gateway-Mode ohne akzeptierten `user` |
| 404 | Example-ID fehlt im exakt angefragten Snapshot |
| 422 | Channel-Dokument, Hash, Manifest oder Snapshot fachlich ungültig |
| 429 | per-Identity oder globales Load-Start-Rate-Limit erreicht |
| 503 | Upstream ohne passendes LKG oder Load-Queue ausgeschöpft |

Upstream-URLs, DNS-Antworten, Stacktraces, Allowlists und interne Cache-Keys
erscheinen nicht in der Response.

## 6. Cache-Key- und Datenmodell

Vor der Key-Bildung sind Repository und Channel bereits kanonisch. Da ihre
Grammatiken keinen Doppelpunkt erlauben, sind folgende versionierte Encoder
eindeutig:

```ts
type ChannelCacheKey = `examples:channel:v1:${RepositorySlug}:${ExamplesChannel}`;
type RevisionCacheKey = `examples:revision:v1:${RepositorySlug}:${FullCommitSha}`;
```

Hilfsfunktionen `toChannelCacheKey()` und `toRevisionCacheKey()` sind die
einzigen Stellen, die Strings erzeugen. Services reichen ansonsten strukturierte
Auswahltypen weiter.

### 6.1 Channel-Cache

Key: `repository + channel`.

Eintrag:

```ts
interface ChannelCacheEntry {
  repository: RepositorySlug;
  channel: ExamplesChannel;
  activeRevision: FullCommitSha;
  manifestSha256: string;
  checkedAt: number;
  expiresAt: number;
  stale: boolean;
  nextRetryAt: number;
  lastAccessedAt: number;
}
```

Dieser Eintrag ist zugleich die prozesslokale LKG-Zuordnung. Ein fehlgeschlagener
Refresh verändert `activeRevision` und `manifestSha256` nicht, setzt aber
`stale=true` und `nextRetryAt` auf
`now + min(UNOSIM_EXAMPLES_REFRESH_RETRY_MS, refreshMs)`. Catalog-Requests vor
diesem Zeitpunkt liefern das LKG ohne erneuten Upstream-Versuch. Validate darf
stale LKG nicht als erfolgreichen Apply-Kandidaten verwenden.

### 6.2 Revision-Cache

Key: `repository + revision`. Der Eintrag enthält den vollständig validierten
Snapshot und seine gemessene Content-Bytegröße. Revision-Snapshots sind
unveränderlich und besitzen kein Zeit-TTL; sie werden nur durch LRU-/Byte-Limits
verdrängt.

Ein Snapshot, auf den ein vorhandener Channel-LKG-Eintrag zeigt, ist gepinnt.
Beim Erreichen der Grenzen werden zuerst ungepinnte Revisionen entfernt. Reicht
das nicht, wird der älteste nicht laufende Channel-Eintrag entfernt; danach kann
dessen Revision ebenfalls verdrängt werden. In-flight Einträge werden niemals
evicted.

Beim 33. unterschiedlichen Channel-Key wird der am längsten nicht verwendete,
nicht laufende Channel-Key verdrängt. Sind alle vorhandenen Keys in-flight,
wird die neue Source mit `503 LOAD_CAPACITY_EXCEEDED` abgewiesen. Eine Eviction
ändert keine Browserpräferenz; ein späterer Request muss die Source erneut
auflösen.

### 6.3 Legacy-Cache

Der bestehende Default-Fixed-Ref-Cache bleibt getrennt. Sein interner Key ist
`examples:legacy:v1:<sha256(source)>:<ref>`. Er wird nie als Channel-LKG oder
Fallback für einen Browser-Override verwendet.

## 7. Concurrency- und Multi-Browser-Modell

- Jeder Request trägt seine effektive Auswahl; `ExamplesRepository` besitzt
  keinen globalen `currentSource`- oder `currentSnapshot`-Zeiger.
- Zwei unterschiedliche Overrides erzeugen unterschiedliche Channel-Keys und
  dürfen parallel geladen werden, begrenzt durch die globale Load-Semaphore.
- Gleiche Channel-Keys teilen Channel-Singleflight. Gleiche Revision-Keys teilen
  Snapshot-Singleflight, auch wenn sie aus unterschiedlichen Channels stammen.
- Default und Browser-Override dürfen denselben Cacheeintrag teilen, wenn die
  kanonische Source identisch ist. Nur das Response-Feld `selection` bleibt
  request-spezifisch.
- Fehler, Stale-Status oder LKG von Source A verändern Source B nicht.
- Eine Apply-Aktion verändert nur localStorage und Store des auslösenden
  Browserprofils. Der Server speichert keine Zuordnung Subject -> Source.
- Wechselt ein Browser während eines laufenden Loads die Auswahl, wird der alte
  Request per AbortSignal abgebrochen oder seine Antwort anhand einer lokalen
  Request-Generation verworfen. Er darf den neueren Katalog nicht überschreiben.
- Bereits in den Editor geladene Dateien bleiben außerhalb des Katalogzustands
  und werden nie automatisch ersetzt.

## 8. Konkrete Default-Limits

Die bestehenden Manifest-, Datei-, Gesamtgrößen- und Timeout-Limits bleiben
unverändert. Neue Limits sind startup-validierte Configwerte mit den folgenden
Defaults:

| Limit / Config-Name | Default | erlaubter Bereich | Begründung |
|---|---:|---:|---|
| `UNOSIM_EXAMPLES_VALIDATE_RATE_LIMIT_MAX_REQUESTS` | 5 je 60 s und Identität | 1–30 | Apply ist eine seltene manuelle Aktion; fünf Versuche erlauben Korrekturen, verhindern aber Source-Scanning. |
| `UNOSIM_EXAMPLES_OVERRIDE_RATE_LIMIT_MAX_REQUESTS` | 60 je 60 s und Identität | 10–600 | Reicht für Menü-Refresh und viele Detailabrufe, bleibt deutlich unter unbeschränktem Polling. |
| `UNOSIM_EXAMPLES_GLOBAL_LOAD_STARTS_PER_MINUTE` | 20 | 1–120 | Begrenzt Cache-Churn über viele Identitäten; Singleflight-Follower zählen nicht erneut. |
| `UNOSIM_EXAMPLES_MAX_CONCURRENT_LOADS` | 4 | 1–16 | Begrenzt CPU, DNS und Upstream-Arbeit, lässt aber mehrere Lehrenden-Sources parallel laden. |
| `UNOSIM_EXAMPLES_MAX_LOAD_QUEUE` | 32 | 0–128 | Kurze Bursts warten begrenzt; darüber folgt `503 LOAD_CAPACITY_EXCEEDED`. |
| `UNOSIM_EXAMPLES_MAX_FILE_FETCH_CONCURRENCY` | 8 je Snapshot | 1–16 | Verhindert `Promise.all` über bis zu 100 Dateien, ohne kleine Repositories unnötig zu serialisieren. |
| `UNOSIM_EXAMPLES_MAX_OUTBOUND_FETCHES` | 16 pro Prozess | 1–64 | Harte Obergrenze über Channel-, Manifest- und Datei-Fetches aller Loads. |
| `UNOSIM_EXAMPLES_MAX_SOURCES` | 32 Channel-Keys | 1–256 | Mehr als ausreichend für parallele Kurse eines Single-Node-Deployments; begrenzt Source-Cardinality. |
| `UNOSIM_EXAMPLES_SNAPSHOT_CACHE_MAX_ENTRIES` | 64 Revisionen | 1–512 | Erlaubt aktive plus vorherige Revisionen der 32 Channel-Keys. |
| `UNOSIM_EXAMPLES_SNAPSHOT_CACHE_MAX_BYTES` | 67108864 (64 MiB Contentbytes) | 1048576–536870912 | Bei bestehendem 1-MiB-Snapshotlimit ist der Worst Case explizit begrenzt; LRU greift zusätzlich nach Entries. |
| `UNOSIM_EXAMPLES_REFRESH_RETRY_MS` | 30000 | 1000–`refreshMs` | Verhindert einen Upstream-Retry pro Catalog-Request, ohne einen fünfminütigen Ausfall zu erzwingen. |

Für beide per-Identity-Limits gilt ein Fenster von 60000 ms. Validate blockiert
bei Überschreitung 60000 ms, normale Override-Reads 30000 ms. Der vorhandene
allgemeine API-Limiter bleibt zusätzlich aktiv. Default-/Built-in-Cache-Hits
erzeugen keine neuen Source-Keys und benötigen kein Override-Limit.

Ein Load ist die Auflösung eines fälligen Channel-Keys einschließlich des
gegebenenfalls anschließenden Snapshot-Aufbaus. Ein direkter Reload einer
bekannten vollständigen Revision für einen Detailabruf nutzt dieselbe globale
Semaphore. Queue-Wartezeit zählt gegen den Request-Lifecycle; bei Client-Abbruch
wird der Queueplatz freigegeben.

Startup validiert zusätzlich:

- `MAX_CONCURRENT_LOADS <= MAX_OUTBOUND_FETCHES`;
- `MAX_FILE_FETCH_CONCURRENCY <= MAX_OUTBOUND_FETCHES`;
- `SNAPSHOT_CACHE_MAX_BYTES >= UNOSIM_EXAMPLES_MAX_TOTAL_BYTES`.

## 9. Betroffene Dateien

### Shared und Server

| Datei | Änderung |
|---|---|
| `shared/examples.ts` | neue kanonische API-Typen, Fehlercodes, Auswahl- und Source-Union |
| `shared/input-limits.ts` | Repository-, Channel-, Revision- und Hash-Limits |
| `server/config.ts` | Channel-Migration sowie startup-validierte Rate-, Concurrency- und LRU-Limits |
| `server/services/examples/examples-schema.ts` | Zod-Schemas für Auswahl, Channel-Dokument und Responses; Manifestvertrag bleibt erhalten |
| `server/services/examples/source-selection.ts` | neu: GitHub-URL-/Slug-Normalisierung und Default-/Override-Auflösung |
| `server/services/examples/channel-provider.ts` | neu: Locator-Grenze, TTL-Prüfung, Hash-/Revision-Bindung |
| `server/services/examples/examples-cache.ts` | neu: Channel-/Revision-LRU, Bytebudget, Pinning und Singleflight |
| `server/services/examples/examples-load-controller.ts` | neu: globale Semaphore, Queue und Outbound-Fetch-Grenzen |
| `server/services/examples/http-provider.ts` | Refactor in bounded Fetch einer konkreten Channel-/Revision-Source; bestehende SSRF-Regeln bleiben maßgeblich |
| `server/services/examples/examples-repository.ts` | request-scoped Auswahl statt eines globalen Snapshots; Validate/Catalog/Detail |
| `server/routes/examples.routes.ts` | Query-/Body-Parsing, bedingte Auth, Rate-Limits und Fehlerabbildung |
| `server/routes.ts` | Examples-Abhängigkeiten und vorhandene Authorization-Identität injizieren |
| `server/services/rate-limiter.ts` | dedizierte Validate-/Override-Limiter oder wiederverwendbare exportierte Limiter-Basis |
| `package.json` | Dev-Default nach verfügbarer Channel-Infrastruktur auf `stable` umstellen |
| `docker-compose.yml` | Channel- und neue Limitwerte optional durchreichen |

`server/routes/config.routes.ts` bleibt unverändert: Raw-Source, Allowlist und
interne Limits werden nicht über `/api/config` veröffentlicht. Der sichtbare
Defaultzustand kommt aus `GET /api/examples`.

### Client

| Datei | Änderung |
|---|---|
| `client/src/lib/external-examples-selection.ts` | neuer kanonischer Browser-Store und localStorage-Vertrag |
| `client/src/lib/examples-api.ts` | neuer typisierter Request-Builder und Response-Parser |
| `client/src/hooks/use-external-examples.ts` | Auswahl, Validate, Apply/Reset, Generation/Abort und Katalogstatus |
| `client/src/components/features/settings-dialog.tsx` | Repository, Channel, Default/Override-Zustand, Apply, Reset und verständliche Fehler |
| `client/src/components/features/examples-menu.tsx` | source-aware Catalog-/Detailrequests, Reload beim Öffnen und bei Auswahländerung |

### Dokumentation nach Implementierung

- `ssot/ssot_function_definition_ExternalExamples.md`: Status von `planned` auf
  `current`, Legacy-Ausnahme und implementierte Limits abgleichen;
- `docs/ARCHITECTURE.md`, `docs/INSTALL_LOCAL.md`, `docs/INSTALL_SERVER.md` und
  `docs/SECURITY.md`: Ziel-/Ist-Markierungen auf den belegten Stand setzen;
- `README.md`: festen Ref als Legacy-Pfad und Settings als aktuellen Pfad
  dokumentieren;
- dieser Plan wird nach Abschluss mit Ergebnis/Evidence nach `docs/archive/`
  verschoben.

## 10. Testplan

Bestehende Tests bleiben als Characterization unverändert. Neue Verträge werden
vorzugsweise in neuen Dateien ergänzt; Änderungen bestehender Tests benötigen
gemäß Agent-Policy eine gesonderte explizite Genehmigung.

### 10.1 Neue Unit- und Vertragstests

| Neue Testdatei | Nachweis |
|---|---|
| `tests/shared/examples-contract.test.ts` | exakte Min-/Max-Grenzen, Groß-/Kleinschreibung, URL-Normalisierung, verbotene Zeichen, partielle/doppelte Felder, 40-/64-Hex-Verträge |
| `tests/server/examples/examples-config.test.ts` | vollständige Startup-Matrix für Source/Ref/Channel und alle Limitbereiche |
| `tests/server/examples/source-selection.test.ts` | Default, Override, Legacy, kanonische Source und keine Raw-URL aus Browserinput |
| `tests/server/examples/channel-provider.test.ts` | Channel-TTL, SHA/Manifest-Hash, kompletter Snapshot vor Aktivierung, stale/LKG nur derselben Source |
| `tests/server/examples/examples-cache.test.ts` | exakte Keys, Case-Kanonisierung, LRU, Bytebudget, Pinning, Eviction und keine Cross-Source-Fallbacks |
| `tests/server/examples/examples-load-controller.test.ts` | vier parallele Loads, Queue 32, Abort-Freigabe, Outbound-Limit und Singleflight |
| `tests/server/examples/examples-repository.test.ts` | Default/Override-Isolation, gleiche Source geteilt, verschiedene Sources unabhängig, revisionsgebundene Details |
| `tests/server/routes/examples.routes.test.ts` | Validate/Catalog/Detail, Authmatrix, Fehlercodes, Rate Limits und no-store Header |
| `tests/client/external-examples-selection.test.ts` | localStorage-Schema, Apply erst nach Validate, Reset, ungültiger Storage, Browser-Events |
| `tests/client/settings-dialog.external-examples.test.tsx` | Eingaben, Zustandslabel, Apply/Reset, verständliche Fehler, kein Persistieren bei Fehler |
| `tests/client/examples-menu.external-source.test.tsx` | Query-Konstruktion, Revision im Detail, Reload, Race/Abort und kein automatischer Editorersatz |

### 10.2 Security-Regressionen

- HTTP/Raw-URL, alternative Hosts, IP-Literale, Userinfo, Query und Fragment
  werden vor Upstream-I/O abgelehnt.
- DNS auf private/reservierte Adressen, Redirects und Originwechsel bleiben
  blockiert.
- Channel-/Manifest-/Dateipfade können das Repository-Root nicht verlassen.
- Größen-, Datei-, Gesamt-, Timeout- und Decode-Limits gelten pro Source und
  auch bei parallelen Loads.
- Anonymer Gateway-Default bleibt erlaubt; anonymer Gateway-Override und
  Validate werden vor Cache-/Upstream-Arbeit abgelehnt.
- Fehlerresponses enthalten keine URL, Allowlist, DNS-Adresse, Stacktrace oder
  Credential.

### 10.3 Multi-Browser- und Concurrency-Szenarien

1. Browser A nutzt Default, Browser B Repository X, Browser C Repository Y;
   alle erhalten ihre eigene `selection` und Revision.
2. A und B wählen kanonisch dieselbe Source; genau ein Channel-/Snapshot-Load
   läuft, Antworten behalten dennoch ihre request-spezifische Auswahlart.
3. X wird stale; Y bleibt fresh und unverändert.
4. Channel X schaltet während eines Detailabrufs um; der Detailrequest liefert
   weiterhin die im Katalog genannte alte Revision.
5. Ein langsamer alter UI-Request beendet sich nach Apply; Generation/Abort
   verhindert, dass er den neuen Katalog überschreibt.
6. Bei vier aktiven und 32 wartenden Loads überschreitet Load 37 die Queue,
   erhält den dokumentierten Fehler und
   verändert keinen LKG-Eintrag.

### 10.4 Verifikationsläufe

Nach den jeweiligen Teilsteps mindestens:

```bash
npm run check
npm run test:related -- <betroffene Dateien>
npm run test:unit
npm run check:docs
git diff --check
```

Vor Push bleibt gemäß Repository-Governance die vollständige lokale Pipeline
einschließlich Integration und E2E erforderlich. Hooks werden nicht umgangen.

## 11. Implementierungsreihenfolge

1. **Shared Vertrag und Grenzen:** `shared/examples.ts`, Input-Limits und reine
   Schema-/Normalisierungstests. Noch kein I/O.
2. **Config-Migration:** Startup-Matrix, `UNOSIM_EXAMPLES_CHANNEL` und neue
   Limits; Legacy-Ref unverändert ausführbar halten.
3. **Source-Auflösung:** Default-/Override-Union und injizierbarer
   `ChannelDocumentLocator`; Security-Validatoren wiederverwenden.
4. **Load-Control und Caches:** Semaphore, Queue, Outbound-Limit, versionierte
   Keys, Singleflight, Channel-LKG und Revision-LRU isoliert implementieren.
5. **Provider/Repository:** Channel prüfen, konkrete Revision vollständig laden,
   Manifest-Hash prüfen und atomar aktivieren; Legacy-Adapter beibehalten.
6. **Routes:** Validate, additive Catalog-/Detailparameter, bedingte Auth,
   Rate-Limits und stabiler Fehlervertrag.
7. **Client-Grundlage:** Storage-/Selection-Store und zentralen API-Client
   implementieren; keine Komponente baut URLs selbst.
8. **Settings:** Draft, Validate, transaktionales Apply, Reset und Statusanzeige.
9. **Examples Menu:** Auswahlbezogene Kataloge, Revision-Bindung, Reload beim
   Öffnen und Race-Schutz; Editorinhalt entkoppelt lassen.
10. **Systemtests und Doku-Abgleich:** Multi-Browser-/Failure-Szenarien,
    vollständige Testpipeline und Ziel-/Ist-Markierungen aktualisieren.

Jeder Teilstep muss mit grünem `npm run check` und seinen neuen fokussierten
Tests enden. Produktiver Channel-Betrieb wird erst freigegeben, wenn das separat
behandelte Publikations-/Locator-Thema entschieden ist; persistenter LKG bleibt
optional und blockiert diese prozesslokale Implementierung nicht.
