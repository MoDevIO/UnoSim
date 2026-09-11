# Implementierungsplan: Browser-scoped External Examples mit Git-Ref-Auflösung

Status: ready-for-server-rework

Basis:

- [`../ssot/ssot_function_definition_ExternalExamples.md`](../ssot/ssot_function_definition_ExternalExamples.md)
- [`adr/0005-browser-scoped-external-examples.md`](adr/0005-browser-scoped-external-examples.md)

Dieser Plan ersetzt den nie veröffentlichten Channel-Entwurf vollständig.
`channel`, `channels/stable.json`, `ChannelDocumentLocator` und ein separater
Publishing-Channel sind weder Zielvertrag noch Kompatibilitätsanforderung.

## 1. Ziel und Nicht-Ziele

Im Scope liegen:

- Default- und Browserauswahl aus öffentlichem GitHub-Repository plus Ref;
- serverseitige Auflösung jedes fälligen Refs auf einen vollständigen SHA;
- immutable, vollständig validierte Snapshots aus dieser Revision;
- request-scoped API, Browser-Persistenz, LKG, LRU und Concurrency-Limits;
- Migration der vorhandenen Source-/Ref-Konfiguration;
- Entfernen der uncommittierten Channel-spezifischen Servergrundlage.

Nicht im Scope liegen private Repositories, Vertraulichkeit, GitHub-
Authentifizierung, Credentials, Tokens, Deploy Keys, GitHub Apps,
Browser-Secrets und ein persistenter oder prozessübergreifender LKG. Ein eigener
Channel-Publikationsworkflow ist nicht mehr vorgesehen.

Das Sicherheitsziel lautet Integrität und kontrollierte Veröffentlichung
öffentlich lesbarer Inhalte. Credential- oder Private-Repository-Fallbacks
werden weder implementiert noch vorbereitet.

## 2. Eingaben und Normalisierung

### 2.1 Repository

Settings und Config akzeptieren:

- `owner/repository`;
- `https://github.com/owner/repository`;
- dieselbe URL mit optionalem `.git` und optionalem abschließenden Slash.

Nur zur Migration bestehender Serverkonfiguration darf
`UNOSIM_EXAMPLES_SOURCE` außerdem die exakte bisherige Form
`https://raw.githubusercontent.com/owner/repository` akzeptieren. Diese Form ist
deprecated und bleibt als Browserinput verboten. Beliebige HTTPS-Quellen sind
im neuen Modell nicht zulässig, weil Ref-Auflösung und Commit-Bindung einen
öffentlichen GitHub-Repository-Slug voraussetzen.

Alle Formen werden vor Request- und Key-Bildung auf einen kleingeschriebenen
Slug normalisiert. Der API-Vertrag akzeptiert ausschließlich die kanonische
Form. Repository-Grenzen bleiben:

- Owner 1–39 Zeichen, `[a-z0-9-]`, alphanumerische Ränder, kein `--`;
- Name 1–100 Zeichen, `[a-z0-9._-]`, alphanumerische Ränder, weder `.` noch
  `..`;
- Slug maximal 140 Zeichen einschließlich genau eines `/`.

Initialer ausgelieferter Default: `ttbombadil/unosim-examples`. In
menschenlesbarer Config darf dafür auch
`https://github.com/ttbombadil/UnoSim-Examples.git` stehen.

### 2.2 Ref und Revision

`ref` ist case-sensitive, 1–128 Zeichen lang und folgt
`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`. `main` ist ausdrücklich gültig. Die
begrenzte Grammatik vermeidet Ref-/Pfad-Mehrdeutigkeit; Branches mit Slash sind
in Version 1 nicht Teil des Vertrags.

`revision` ist ausschließlich ein kleingeschriebener vollständiger Commit-SHA
mit `^[0-9a-f]{40}$`. Der Browser konfiguriert keine Revision; er übernimmt sie
aus dem Katalog für den Detailrequest.

## 3. Config-Semantik und Migration

Die vorhandenen Variablen werden ohne zusätzliche Repository-Variable
weiterverwendet:

| Variable | neue Bedeutung |
|---|---|
| `UNOSIM_EXAMPLES_SOURCE` | Default-Repository-Eingabe; Slug oder normale GitHub-URL, vorübergehend auch exakte Raw-GitHub-Repository-Basis |
| `UNOSIM_EXAMPLES_REF` | beweglicher oder unveränderlicher Default-Ref; initial `main` |
| `UNOSIM_EXAMPLES_REFRESH_MS` | TTL bis zur nächsten lazy Ref-Auflösung |
| `UNOSIM_EXAMPLES_ALLOWED_HOSTS` | operatorseitige Allowlist für `api.github.com` und `raw.githubusercontent.com` |

`UNOSIM_EXAMPLES_CHANNEL` entfällt vollständig. Ist die Variable gesetzt, muss
der Start mit einem verständlichen Fehler abbrechen, damit eine nie
veröffentlichte Channel-Konfiguration nicht still ignoriert wird.

Die Zielmatrix lautet:

| Source | Ref | Ergebnis |
|---|---|---|
| leer | leer | nur Built-ins |
| leer | gesetzt | Startup-Fehler |
| gesetzt | leer | Repository-/Ref-Modus mit `main` |
| gesetzt | gesetzt | Repository-/Ref-Modus mit validiertem Ref |

Die ausgelieferten Entwicklungs- und Deployment-Vorgaben setzen zunächst
`ttbombadil/unosim-examples` und `main`. Ein ausdrücklich leerer Source-Wert
bleibt der Opt-out für Built-ins-only. Der bisherige Produktionsfehler für
`UNOSIM_EXAMPLES_REF=main` wird entfernt; die Sicherheit entsteht durch
Auflösung und anschließenden SHA-gebundenen Contentzugriff.

Bestehende Werte wie
`https://raw.githubusercontent.com/ttbombadil/UnoSim-Examples` plus `v1.0.0`
werden kanonisch normalisiert und ohne Neustart-basierte Fixed-Ref-Sonderklasse
in dasselbe Repository-/Ref-Modell überführt. Es gibt keinen getrennten
`legacy-ref`-Responsemodus mehr.

Im initialen Default-Repository ist `main` der veröffentlichte Stand. Das
Examples-Repository schützt diesen Stand durch Branch Protection, Reviewregeln
und CI-Prüfungen. Der konkrete Workflow liegt im Examples-Repository; UnoSim
benötigt dafür keine Schreibrechte und keine Credentials.

## 4. Typen und Interfaces

Die Shared-Typen werden auf folgende Kerntypen reduziert:

```ts
type RepositorySlug = string;
type ExamplesRef = string;
type FullCommitSha = string;

type ExamplesRequestSelection =
  | { kind: "default" }
  | {
      kind: "browser-override";
      repository: RepositorySlug;
      ref: ExamplesRef;
    };

type ExamplesSourceMetadata =
  | {
      selection: "default";
      mode: "builtin";
      repository: null;
      ref: null;
      revision: null;
      status: "builtin";
      stale: false;
    }
  | {
      selection: "default" | "browser-override";
      mode: "repository-ref";
      repository: RepositorySlug;
      ref: ExamplesRef;
      revision: FullCommitSha;
      status: "remote" | "cache";
      stale: boolean;
    };
```

Der Server erhält keine Channel-Grenze mehr. Stattdessen:

```ts
interface GitHubRevisionResolver {
  resolve(
    repository: RepositorySlug,
    ref: ExamplesRef,
    context: RequestContext,
  ): Promise<FullCommitSha>;
}

interface RevisionSnapshotLoader {
  load(
    repository: RepositorySlug,
    revision: FullCommitSha,
    context: RequestContext,
  ): Promise<ValidatedRevisionSnapshot>;
}
```

Der produktive Resolver ruft ausschließlich den serverkonstruierten Endpunkt
`https://api.github.com/repos/<owner>/<repository>/commits/<ref>` auf. Er
akzeptiert nur eine strikt validierte Response mit vollständigem SHA. Der
Snapshot-Loader verwendet ausschließlich Raw-GitHub-URLs mit diesem SHA.
Beide Zugriffe sind anonyme, credential-freie HTTPS-Lesezugriffe auf öffentliche
Repositories. Es gibt keine Token-Injection oder Auth-Header-Konfiguration.

## 5. API-Verträge

Unbekannte, doppelte und partielle Felder werden abgelehnt. Query-Werte werden
durch den HTTP-Parser genau einmal dekodiert. Override-Antworten erhalten
`Cache-Control: private, no-store`.

### 5.1 Validate

```http
POST /api/examples/validate
Content-Type: application/json

{
  "schemaVersion": 1,
  "selection": {
    "repository": "ttbombadil/unosim-examples",
    "ref": "main"
  }
}
```

Erfolg:

```json
{
  "schemaVersion": 1,
  "valid": true,
  "source": {
    "selection": "browser-override",
    "mode": "repository-ref",
    "repository": "ttbombadil/unosim-examples",
    "ref": "main",
    "revision": "0123456789abcdef0123456789abcdef01234567",
    "status": "remote",
    "stale": false
  }
}
```

Validate löst einen fälligen Ref frisch auf und validiert den vollständigen
Snapshot. Ein frischer erfolgreicher Cache darf verwendet werden. Nach TTL ist
ein stale LKG kein Validate-Erfolg. Es gibt keinen serverseitigen Apply-
Endpunkt.

### 5.2 Catalog

```http
GET /api/examples
GET /api/examples?repository=ttbombadil%2Funosim-examples&ref=main
```

Die Antwort enthält `schemaVersion`, `source` und `examples`. `source` enthält
bei externen Examples immer Auswahlart, `mode=repository-ref`, Repository, Ref,
vollständige Revision, `status` und `stale`. Built-ins verwenden null für
Repository, Ref und Revision.

### 5.3 Detail

```http
GET /api/examples/:id
GET /api/examples/:id?repository=ttbombadil%2Funosim-examples&revision=<full-commit-sha>
```

Built-ins benötigen keine Query. Externe Details müssen Repository und Revision
gemeinsam übertragen. Der Server lädt exakt diesen Snapshot und löst dabei
keinen Ref erneut auf. Ist die Revision nicht mehr im Cache, darf sie über den
vollständigen SHA erneut geladen und validiert werden. Ein aktuellerer Ref-
Stand oder ein anderer LKG ist kein Ersatz.

Der kompatible Detailwert `source: "builtin" | "external"` bleibt bestehen;
`schemaVersion` und `revision` werden additiv geliefert.

### 5.4 Fehler

Stabile Codes:

- `INVALID_SELECTION` und `INVALID_REF`: 400;
- `INVALID_REVISION`: 400;
- `INVALID_SNAPSHOT`: 422;
- `SOURCE_UNAVAILABLE`: 503;
- `EXAMPLE_NOT_FOUND`: 404;
- `RATE_LIMITED`: 429;
- `LOAD_CAPACITY_EXCEEDED`: 503.

Antworten enthalten keine Upstream-URLs, DNS-Adressen, Allowlists, Cache-Keys
oder Stacktraces.

## 6. Manifestvertrag

Das vorhandene Manifest-Schema bleibt strukturell kompatibel:

```ts
interface ExamplesManifestV1 {
  schemaVersion: 1;
  repository?: string;
  ref?: string;
  examples: ManifestExample[];
}
```

`repository` und `ref` sind optionale informative Legacy-Metadaten. Weder
Resolver noch Snapshot-Loader dürfen daraus Source, Ref oder Revision ableiten.
Historisch abweichende Werte, insbesondere aktuell
`repository: "MoDevIO/UnoSim-Examples"`, blockieren den über eine validierte
Repository-/Ref-Auswahl und Commit-SHA geladenen Snapshot nicht.

Neue Manifeste sollen `repository: "ttbombadil/unosim-examples"` verwenden und
können `ref` entfernen. Diese Inhaltsbereinigung ist keine Voraussetzung für
die Serverarchitektur und keine Schema-Breaking-Change. Das bestehende `ref`-
Feld darf nicht mit dem aufgelösten Commit-SHA verglichen werden; ein Ref wie
`main` oder ein historischer Tag ist keine Revisionsautorität.

## 7. Cache- und Refresh-Modell

Nach Kanonisierung gelten ausschließlich diese Keys:

```ts
type SourceCacheKey =
  `examples:source:v1:${RepositorySlug}:${ExamplesRef}`;
type RevisionCacheKey =
  `examples:revision:v1:${RepositorySlug}:${FullCommitSha}`;
```

Repository und Ref erlauben keinen Doppelpunkt, daher ist die Kodierung
eindeutig. `toSourceCacheKey()` und `toRevisionCacheKey()` sind die einzigen
String-Erzeuger.

Der Source-Eintrag enthält Repository, Ref, aktive Revision, `checkedAt`,
`expiresAt`, `stale`, `nextRetryAt` und `lastAccessedAt`. Er ist zugleich die
prozesslokale LKG-Zuordnung. Ein fehlgeschlagener Refresh verändert die aktive
Revision nicht und setzt den nächsten Retry auf
`now + min(UNOSIM_EXAMPLES_REFRESH_RETRY_MS, refreshMs)`.

Revisionseinträge enthalten den vollständig validierten Snapshot,
Content-Bytegröße und LRU-Zeit. Sie besitzen kein TTL und werden durch Entry-
und Byte-Limits begrenzt. Aktive Source-Revisionen sind gepinnt. Bei Druck
werden zuerst ungepinnte Revisionen und danach die ältesten nicht laufenden
Source-Einträge entfernt. In-flight Einträge werden nie evicted.

Refresh-Ablauf:

1. frischen Source-Eintrag direkt verwenden;
2. nach TTL Ref über `GitHubRevisionResolver` auflösen;
3. gleicher SHA: `checkedAt` und `expiresAt` erneuern;
4. neuer SHA: Revision-Singleflight verwenden oder vollständigen Snapshot laden;
5. erst danach Source-Eintrag atomar auf die neue Revision umschalten;
6. Fehler: ausschließlich Source-eigenen LKG stale liefern; Validate schlägt
   fehl.

## 8. Concurrency und Limits

Das bisher geplante bounded Modell bleibt sinnvoll und wird umbenannt, nicht
neu dimensioniert:

| Variable | Default | Bereich |
|---|---:|---:|
| `UNOSIM_EXAMPLES_VALIDATE_RATE_LIMIT_MAX_REQUESTS` | 5 je 60 s/Identität | 1–30 |
| `UNOSIM_EXAMPLES_OVERRIDE_RATE_LIMIT_MAX_REQUESTS` | 60 je 60 s/Identität | 10–600 |
| `UNOSIM_EXAMPLES_GLOBAL_LOAD_STARTS_PER_MINUTE` | 20 | 1–120 |
| `UNOSIM_EXAMPLES_MAX_CONCURRENT_LOADS` | 4 | 1–16 |
| `UNOSIM_EXAMPLES_MAX_LOAD_QUEUE` | 32 | 0–128 |
| `UNOSIM_EXAMPLES_MAX_FILE_FETCH_CONCURRENCY` | 8 je Snapshot | 1–16 |
| `UNOSIM_EXAMPLES_MAX_OUTBOUND_FETCHES` | 16 pro Prozess | 1–64 |
| `UNOSIM_EXAMPLES_MAX_SOURCES` | 32 Repository-/Ref-Keys | 1–256 |
| `UNOSIM_EXAMPLES_SNAPSHOT_CACHE_MAX_ENTRIES` | 64 | 1–512 |
| `UNOSIM_EXAMPLES_SNAPSHOT_CACHE_MAX_BYTES` | 67108864 | 1048576–536870912 |
| `UNOSIM_EXAMPLES_REFRESH_RETRY_MS` | 30000 | 1000–`refreshMs` |

Gleiche Source-Keys teilen Ref-Singleflight; gleiche Revision-Keys teilen
Snapshot-Singleflight. Verschiedene Browserauswahlen bleiben getrennt. Der
globale Load umfasst Ref-Auflösung und gegebenenfalls Snapshot-Aufbau. Direkte
Revision-Reloads verwenden dieselbe Semaphore. Alle GitHub-API-, Manifest- und
Datei-Fetches teilen die globale Outbound-Grenze.

Die bestehenden Manifest-, Datei-, Gesamtgrößen- und Timeoutlimits bleiben
unverändert. Startup validiert weiterhin die Abhängigkeiten zwischen Load-,
Outbound-, Datei- und Byte-Limits.

## 9. Sicherheitsmodell

- Browserinput erzeugt nur validierte Repository- und Ref-Bezeichner.
- GitHub-API- und Raw-URLs werden ausschließlich serverseitig konstruiert.
- `api.github.com` und `raw.githubusercontent.com` müssen operatorseitig
  erlaubt sein; Browser können diese Liste nicht erweitern.
- HTTPS, DNS-/SSRF-Prüfung, IP-Literal-Verbot, Redirect-Verbot, sichere Pfade,
  Timeouts, Decode- und Größenlimits gelten für jeden Fetch.
- GitHub-Resolver-Antworten werden größenbegrenzt und strikt auf einen
  vollständigen SHA validiert.
- Manifest und Dateien werden nie über den beweglichen Ref geladen.
- Gateway-Overrides und Validate benötigen einen akzeptierten `user`; Default-
  Reads bleiben wie bisher zugänglich.
- Diese UnoSim-Nutzerauthentifizierung schützt die Erzeugung externer Arbeit;
  sie ist keine GitHub-Authentifizierung. Upstream-Requests enthalten keine
  GitHub-Credentials oder Browser-Secrets.

## 10. Veröffentlichungs- und Integritätsgrenze

`main` ist beim initialen Default-Repository der veröffentlichte Stand. Zwei
Schichten wirken zusammen:

1. Das Examples-Repository verhindert unbeabsichtigte Änderungen an `main`
   durch Branch Protection, Reviews und CI-Validierung von Manifest und Dateien.
2. UnoSim löst `main` lazy auf einen Commit-SHA auf, lädt ausschließlich diesen
   Commit, validiert den vollständigen Snapshot, aktiviert ihn atomar und hält
   bei Fehlern den Source-eigenen LKG aktiv.

UnoSim bewertet nicht die Vertraulichkeit der Inhalte und verwaltet keine
Zugriffsrechte im Examples-Repository. Öffentliche GitHub-Rate-Limits oder
temporäre Ausfälle führen zu Retry/LKG, nicht zu einem Credential-Mechanismus.

## 11. Wiederverwendung und Entfernung der uncommittierten Grundlage

Weiterverwendbar beziehungsweise abstrahierbar:

- Shared Repository-/Revision-Validierung und Repository-Normalisierung;
- request-scoped Selection- und Response-Grundstruktur;
- `RevisionProvider` für SHA-gebundenen Manifest-/Datei-Load;
- sichere HTTP-/DNS-/Redirect-/Size-/Timeout-Grenze;
- globale Load-/Queue-/Outbound-Controller und Datei-Concurrency;
- Revision-LRU, Bytebudget, Pinning und Revision-Singleflight;
- per-Identity Rate-Limiter, Fehlerabbildung und `no-store`;
- atomare Aktivierung, Failure-Retry und prozesslokale LKG-Mechanik.

Zu entfernen oder umzubauen:

- `ExamplesChannel`, Channel-Schemas und Channel-Responsefelder;
- `UNOSIM_EXAMPLES_CHANNEL` einschließlich Startup-Matrix und Compose-Wert;
- `ChannelDocument`, `manifestSha256` als Channel-Vertrag und
  `ChannelDocumentLocator`;
- `channel-provider.ts`; Ersatz durch Ref-Resolver/Source-Provider;
- Channel-Key und Channel-Cache; Ersatz durch Source-Key und Source-Cache;
- `legacy-ref`-Modus und separater Legacy-Key; vorhandene Source-/Ref-Werte
  laufen durch dasselbe neue Modell;
- sämtliche Channel-Fixtures und Channel-spezifischen Tests.

## 12. Betroffene Dateien

Server/Shared:

- `shared/examples.ts`, `shared/input-limits.ts`;
- `server/config.ts`;
- `server/services/examples/source-selection.ts`;
- neu `server/services/examples/github-revision-resolver.ts`;
- neu oder umbenannt `server/services/examples/source-provider.ts`;
- `server/services/examples/examples-cache.ts`;
- `server/services/examples/examples-load-controller.ts`;
- `server/services/examples/http-provider.ts`;
- `server/services/examples/examples-repository.ts`;
- `server/services/examples/examples-schema.ts`;
- `server/routes/examples.routes.ts`, `server/routes.ts`;
- `server/services/rate-limiter.ts`;
- `package.json`, `docker-compose.yml`.

Client folgt in einem getrennten Schritt: Selection-Store, API-Client,
Settings und Examples-Menü werden auf Repository plus Ref umgestellt.

## 13. Testplan

Neue beziehungsweise umzustellende Tests belegen:

- Slug-, GitHub-URL-, optionales `.git`- und Ref-Schema;
- Config-Matrix, Default `ttbombadil/unosim-examples`/`main`, Raw-Config-
  Migration und Fehler bei `UNOSIM_EXAMPLES_CHANNEL`;
- Ref-Auflösung zu exakt 40 kleingeschriebenen Hexzeichen;
- Content-URLs enthalten ausschließlich die Revision, niemals den Ref;
- identische Repository-/Ref-Auswahlen teilen Cache und Singleflight;
- unterschiedliche Refs oder Repositories beeinflussen sich nicht;
- gleicher SHA nach TTL lädt keinen Snapshot neu;
- neuer SHA wird erst nach vollständiger Validierung aktiviert;
- fehlerhafter neuer SHA behält nur den Source-eigenen LKG;
- LRU, Byte-, Source-, Queue-, Load-, File- und Outbound-Limits;
- Validate, Catalog und revisionsgebundenes Detail inklusive Auth und Rate;
- vorhandene Manifestfelder werden akzeptiert, aber nicht zur Auflösung oder
  Gleichheitsprüfung verwendet;
- keine Channel-Typen, -Keys, -Config oder -Routenparameter verbleiben.
- kein GitHub-Token, Credential-Header, Private-Repository-Codepfad oder Secret-
  Feld wird eingeführt; Resolver und Loader funktionieren anonym.

## 14. Implementierungsreihenfolge

1. Shared-Vertrag von Channel auf Ref umstellen.
2. Config-Matrix vereinfachen und `main` erlauben.
3. GitHub-Ref-Resolver hinter kontrollierter I/O-Grenze implementieren.
4. Channel-Cache/Provider in Source-Cache/Provider umbauen.
5. Revision-Loader, Limits und Security-Prüfungen wiederverwenden.
6. Repository und Routes auf Repository/Ref beziehungsweise
   Repository/Revision umstellen.
7. Channel-Code und Channel-Tests vollständig entfernen.
8. fokussierte Tests, `npm run check`, vollständige Unit-Suite,
   `npm run check:docs` und `git diff --check` ausführen.
9. Erst in einem späteren Schritt Client-Settings und Menü integrieren.
