# Externe UnoSim-Beispiele

## Ausgangslage und Ziel

Die bestehende UI lädt den Katalog über `GET /api/examples`, lädt Inhalte aber anschließend direkt über `/examples/<filename>`. `server/routes.ts` durchsucht derzeit `public/examples`; `server/index.ts` liefert diesen Ordner statisch aus; `ExamplesMenu` und `useSimulatorFileSystem` kennen bereits `.ino`- und `.h`-Dateien.

Ziel ist ein serverseitiges `ExamplesRepository`, das wenige Built-ins als Offline-/Fallback-Satz mit einer konfigurierbaren HTTP-Quelle kombiniert. Der Browser verwendet ausschließlich:

- `GET /api/examples` für den Katalog
- `GET /api/examples/:id` für ein vollständiges Beispiel

Der Browser setzt keine externen URLs oder Dateipfade zusammen. GitHub ist nur eine mögliche HTTP-Quelle.

## Zielarchitektur

```text
ExamplesRepository
├── BuiltInProvider
└── HttpProvider
     ├── Manifest validation
     ├── Path/size/security validation
     └── In-memory TTL cache
```

`ExamplesRepository` liefert einen normalisierten gemeinsamen Vertrag. `BuiltInProvider` liest nur die bewusst behaltenen lokalen Beispiele. `HttpProvider` lädt Manifest und Dateien serverseitig und aktiviert ausschließlich vollständig validierte Snapshots.

In V1 gibt es ausdrücklich **keinen Disk-Cache**. Persistenz, Cache-Cleanup, Schreibrechte und ein dauerhaftes Storage-Format werden vertagt. Der Cache lebt nur im Prozess und wird bei Neustart verworfen.

Die bisherige statische `/examples`-Auslieferung und der Vite-Proxy werden nach der UI-Umstellung entfernt oder blockiert, damit kein Clientpfad den Repository-Service umgehen kann.

## Manifestformat

Das externe Repository enthält ein `manifest.json`; die Dateiinhalte stehen separat im Repository. Ein Manifest-Eintrag ist direkt als Multi-File-Beispiel ausgelegt:

```json
{
  "schemaVersion": 1,
  "repository": "MoDevIO/UnoSim-Examples",
  "ref": "2026-SS",
  "examples": [
    {
      "id": "motor-control",
      "title": "Motor Control",
      "category": "Motors",
      "files": [
        {
          "name": "motor-control.ino",
          "path": "motors/motor-control/motor-control.ino"
        },
        {
          "name": "motor.h",
          "path": "motors/motor-control/motor.h"
        }
      ],
      "main": "motor-control.ino"
    }
  ]
}
```

Regeln:

- `schemaVersion` ist verpflichtend und zunächst `1`.
- `id` ist eindeutig und darf nicht als ungeprüfter Dateipfad verwendet werden.
- `files` enthält `.ino`- und `.h`-Dateien; `main` referenziert genau eine `.ino`-Datei aus dieser Liste.
- `name` ist der Editorname und `path` ein relativer Pfad zur HTTP-Quelle.
- Absolute URLs, URL-Schemata, `..`, Backslashes, NUL-Zeichen und doppelte Pfade sind verboten.
- Manifest und Einträge werden serverseitig mit einem strikten Schema validiert.
- Der Server lädt und validiert alle referenzierten Dateien, bevor der Snapshot sichtbar wird.

`GET /api/examples` liefert Metadaten ohne Quell-URLs und ohne Dateiinhalte. `GET /api/examples/:id` liefert die validierten Dateien als `{ name, content }`; die Reihenfolge stellt die `.ino`-Hauptdatei an den Anfang. Die bestehende Multi-File-Unterstützung für `.ino` und `.h` wird über `handleFilesLoaded(..., true)` genutzt.

## Serverkonfiguration

Neue Werte werden zentral in `server/config.ts` gelesen und bleiben serverseitig:

```text
UNOSIM_EXAMPLES_SOURCE=        # z. B. HTTPS-Basis-URL; leer/deaktiviert => nur Built-ins
UNOSIM_EXAMPLES_REF=           # fester Tag oder Commit-SHA
UNOSIM_EXAMPLES_REFRESH_MS=300000
UNOSIM_EXAMPLES_TIMEOUT_MS=5000
UNOSIM_EXAMPLES_MAX_MANIFEST_BYTES=262144
UNOSIM_EXAMPLES_MAX_FILE_BYTES=131072
UNOSIM_EXAMPLES_MAX_TOTAL_BYTES=1048576
UNOSIM_EXAMPLES_MAX_FILES=100
UNOSIM_EXAMPLES_ALLOWED_HOSTS= # verpflichtend in Produktion; alternativ gleichwertig restriktiver Source-Validator
```

`UNOSIM_EXAMPLES_SOURCE` und `UNOSIM_EXAMPLES_REF` werden nicht über `/api/config` veröffentlicht. Der Server konstruiert daraus intern die Manifest- und Dateianfragen. In Produktion ist ein Commit-SHA bevorzugt; unveränderliche Tags sind zulässig. Floating Refs wie `main` sind ausschließlich in Development zulässig. In Produktion muss entweder eine explizite Host-Allowlist oder ein gleichwertig restriktiver Source-Validator aktiv sein.

## Ladefluss und Cache/Fallback

1. `ExamplesRepository` lädt den Built-in-Katalog synchron bzw. sicher verfügbar.
2. Bei aktiviertem `HttpProvider` werden Quelle und Ref serverseitig validiert.
3. Der Provider lädt das Manifest mit Timeout und Größenlimit.
4. Das Manifest wird vollständig validiert.
5. Alle `.ino`-/`.h`-Dateien werden serverseitig relativ zur konfigurierten Quelle geladen.
6. Größen- und Sicherheitsprüfungen werden durchgeführt; bei Fehlern wird der gesamte Remote-Snapshot verworfen.
7. Ein gültiger Snapshot wird für `UNOSIM_EXAMPLES_REFRESH_MS` im In-Memory-TTL-Cache gehalten.
8. Während der TTL werden keine externen Requests ausgeführt.
9. Bei Remote-Ausfall wird zunächst der letzte gültige In-Memory-Snapshot verwendet.
10. Existiert keiner, liefert das Repository weiterhin die Built-ins.

Die API kann den Status `remote`, `cache` oder `builtin` sowie `stale` als nicht-sensitive Metadaten melden. Ein Neustart löscht den Remote-Cache bewusst.

## Security

- Im Produktionsbetrieb ausschließlich HTTPS; HTTP nur explizit für lokale Tests.
- Keine absoluten Datei-URLs im Manifest und keine vom Browser übernommene URL.
- Pfade strikt relativ validieren; `..`, Backslashes, NUL, leere Segmente und unerlaubte Endungen ablehnen.
- Manifestgröße, Dateigröße, Gesamtdatenmenge und Dateianzahl begrenzen; Responses auch ohne `Content-Length` streamend begrenzen.
- Jede Anfrage mit `AbortSignal` und Timeout versehen.
- Redirects standardmäßig verbieten. Falls später benötigt: begrenzte Anzahl, HTTPS, gleiche Allowlist und erneute Zielprüfung pro Hop.
- SSRF-Schutz durch konfigurierte Host-Allowlist, Verbot von Credentials/unerwarteten Ports/IP-Literals und Ablehnung von Loopback-, privaten, Link-Local- und reservierten Zielnetzen einschließlich DNS-/Redirect-Prüfung.
- Keine GitHub-API-, Git-Clone- oder Token-spezifische Logik.
- API-IDs nur gegen den validierten In-Memory-Snapshot auflösen; niemals direkt als lokale Pfade verwenden.
- Der alte statische `/examples`-Pfad darf die Validierung nicht umgehen.

## GitHub-Repository-Struktur

Späteres Repository: `MoDevIO/UnoSim-Examples`

```text
UnoSim-Examples/
├── manifest.json
├── README.md
├── LICENSE
├── examples/
│   ├── 00-tests/
│   │   └── serial-print-test.ino
│   ├── 01-basic/
│   │   ├── blink.ino
│   │   └── serial-output.ino
│   ├── 02-io/
│   │   └── digital-read-write.ino
│   └── 03-multi-file/
│       ├── motor-control.ino
│       └── motor.h
└── .github/workflows/validate-manifest.yml
```

Die CI prüft Schema, referenzierte Dateien, erlaubte Endungen, fehlende/zusätzliche Dateien und optional Hashes. Semesterstände werden als unveränderliche Tags oder bevorzugt über Commit-SHAs referenziert.

## Umsetzungsreihenfolge

1. Manifest- und API-Typen/Validierung festlegen.
2. `ExamplesRepository`, `BuiltInProvider` und `HttpProvider` als kleine serverseitige Services anlegen.
3. In-Memory-TTL-Cache, Timeout- und Fehlerzustände implementieren; keinen Disk-Cache einführen.
4. `GET /api/examples` und `GET /api/examples/:id` in eigene Examples-Routen verschieben.
5. `ExamplesMenu` auf den neuen Vertrag umstellen; externe Pfade/URLs aus der UI entfernen.
6. Multi-File-Laden über die vorhandene `.ino`-/`.h`-Tablogik integrieren.
7. Statische `/examples`-Auslieferung und Vite-Proxy entfernen oder blockieren.
8. Konfiguration und Deployment-Dokumentation ergänzen, ohne Source/Ref an `/api/config` zu geben.
9. Security-, Loader-, Cache-, Routen- und UI-Tests ergänzen.
10. Erst danach das externe Repository anlegen, Beispiele migrieren und die E2E-Abnahme durchführen. Built-ins bleiben zusätzlich zum Remote-Katalog sichtbar.

## E2E-Abnahme

1. Separates Repository `MoDevIO/UnoSim-Examples` anlegen.
2. `manifest.json` erstellen.
3. Drei bis fünf kleine Beispiele einpflegen, mindestens eines mit mehreren Dateien (`.ino` + `.h`).
4. UnoSim auf Source und festen Ref dieses Repositories konfigurieren.
5. Manifest über UnoSim laden.
6. Ein Beispiel im UI auswählen.
7. Alle Dateien korrekt als Editor-Tabs öffnen.
8. Den Sketch erfolgreich kompilieren und starten; Serial-/Simulationsergebnis prüfen.
9. Die externe Quelle temporär unerreichbar machen.
10. Den In-Memory-TTL-Fallback und anschließend den Built-in-Fallback verifizieren. Da V1 keinen Disk-Cache besitzt, ist nach einem Serverneustart ausschließlich der Built-in-Fallback garantiert.

## Teststrategie und Abnahmekriterien

Zu testen sind Manifestfehler, doppelte IDs/Pfade, Path Traversal, absolute URLs, Größenlimits, Timeouts, Redirects, SSRF-Ziele, ungültige Dateien, TTL-Verhalten, Remote-Ausfall, Built-in-Fallback und Multi-File-UI-Laden.

Die Abnahme ist erfüllt, wenn:

- der Browser nur `/api/examples` und `/api/examples/:id` verwendet,
- keine externe URL im Browser oder `/api/config` auftaucht,
- ein ungültiger Snapshot nie teilweise aktiviert wird,
- `.ino` und `.h` korrekt in Tabs landen,
- Kompilieren/Starten unverändert funktioniert,
- Remote-Ausfall ohne Disk-Cache über In-Memory-Snapshot bzw. Built-ins abgefangen wird,
- keine bestehenden, unabhängigen UnoSim-Tests regressieren.

## Offene Entscheidungen

- Werden Produktionsrefs ausschließlich als Commit-SHA oder auch als unveränderliche Semester-Tags akzeptiert? Empfehlung: SHA bevorzugen, Tags dokumentiert zulassen.
- Built-ins bleiben dauerhaft zusätzlich zum Remote-Snapshot sichtbar.
- Examples-Endpunkte sind öffentlich lesbar und rate-limited; eine Authentifizierung im Gateway bleibt eine spätere optionale Erweiterung.
- Produktions-Refs sind bevorzugt Commit-SHAs, unveränderliche Tags sind zulässig; `main` ist nur in Development erlaubt.
- `UNOSIM_EXAMPLES_ALLOWED_HOSTS` ist in Produktion verpflichtend, sofern kein gleichwertig restriktiver Source-Validator verwendet wird.
- Soll der Katalog beim Serverstart vorgeladen werden oder erst beim ersten Zugriff? Empfehlung: optionales asynchrones Warm-up, aber kein blockierender Serverstart.
