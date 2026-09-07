# UnoSim — Finaler Projektstatus

Status: completed-with-deferred  
Datum: 2026-09-07  
Abschlusscommit: `6e286602`

## Ergebnis

Der ursprüngliche Maßnahmenplan aus `PROJECT_ANALYSIS_REPORT_2026-09-04.md` ist formal abgeschlossen:

- 29 Maßnahmen sind `verified-done`.
- 0 Maßnahmen sind offen.
- 1 Maßnahme ist bewusst `deferred`: Phase 2.7, Konfigurationszentralisierung.
- Es wurden keine Produktionscode-Änderungen für den formalen Abschluss vorgenommen.

`completed-with-deferred` bedeutet hier abgeschlossen mit dokumentierter technischer Restschuld, nicht „97 % offen“.

## Abgeschlossene Bereiche

- Architektur- und SSOT-Dokumentation konsolidiert.
- Frontend-Composition-Root und sieben Page-ViewModels verifiziert.
- WebSocket-Router, Session-/Output-Module und Execution-Phasen extrahiert und charakterisiert.
- Compiler-Teilmodule für Cache, CLI, Header, Temp-FS und Output-Parsing vorhanden.
- Sandbox-Vertrag, Coverage-Hotspots, Release-Gate, Observability und API-/WebSocket-Versionierung verifiziert.
- Deprecation-/Legacy-Flächen inventarisiert; keine unbelegte Breaking-Change-Entfernung.

## Gemessene Betriebsgrenzen

- Kompilierung: belastbar bis 200 Clients im dokumentierten Testprofil.
- Simulation/WebSocket: belastbar bis 100 Clients im dokumentierten 5-Runner-Profil.
- 200 Simulationsclients überschreiten unter diesem Profil die Runner-/Acquire-Grenze und sind ausdrücklich keine Freigabeaussage.
- Betriebsmodell: Single Stateful Node gemäß ADR 0003; keine HA-Zusage.

## Release, Security und Observability

- `./run-tests.sh` läuft mit Typecheck, Unit-/Integrationstests, Docker, E2E, Build, Audit und SonarQube-Quality-Gate fail-fast.
- Letzter vollständiger Lauf: erfolgreich; 17 E2E- und 26 Docker-Tests bestanden.
- SonarQube: Quality Gate `OK`, 0 Issues.
- Security Audit: 0 High-/Critical-Vulnerabilities.
- Coverage: 86,58 % Lines im letzten vollständigen Coverage-Lauf.
- `/api/status` liefert Compile-, Queue-, Runner-, WebSocket- und Alert-Signale mit getesteten Schwellenwertpfaden.

## Deferred-/Major-Release-Themen

Die folgenden Flächen bleiben gemäß Phase 3.3 kompatibel:

| Fläche | Status | Erneute Bewertung |
| --- | --- | --- |
| Direkte Config-/Env-Ausnahmen aus 2.7 | `deferred` | Bei neuem Runtime-Vertrag oder Environment-Sunset-Policy |
| `/api/status`-Aliasse `pool`/`compile` | `deferred` | Erst mit Major-Version und Consumer-/Migrationstest |
| `lastCompiledCode`-Fallback | `deferred` | Nach vollständiger Session-Code-Migration inkl. E2E/Multi-Client-Nachweis |
| Legacy-`IOPinRecord`-Felder | `deferred` | Nach Producer-/Consumer-/Typmigration |
| `FORCE_DOCKER` | `deferred` | Nach Environment-Sunset-Policy |
| Historische `STOPPED`-/`QUEUED`-Statuswerte | `keep` | Nur nach API-Version-/Negotiationsnachweis |

## Einzige technische Restschuld: 2.7

Bewusst verbleibende direkte Zugriffe sind:

- `NODE_ENV` und Worker-Thread-Marker in Prozess-/Worker-Laufzeitlogik,
- Test- und Coverage-Schalter,
- Vite-HMR-Schalter,
- der Compiler-Route-Cache-Schalter,
- der dokumentierte Legacy-Alias `FORCE_DOCKER`.

Diese Pfade sind nicht release-blockierend, weil produktive Fachkonfiguration über `server/config.ts` läuft, die Ausnahmen inventarisiert sind und bestehende Tests ihre Kompatibilität absichern. Eine spätere Bündelung ist nur sinnvoll, wenn sie einen klaren Runtime-/Environment-Vertrag, eine Migrationsstrategie und entsprechende Regressionstests erhält.

## Teststabilitätsbeobachtung

Der Burst-Test `large burst (12 clients, pool=3)` zeigte in einem vollständigen `./run-tests.sh`-Lauf einmalig einen Timeout bei 11/12 abgeschlossenen Clients. Der gezielte Wiederholungslauf und der anschließende vollständige Pipeline-Lauf waren grün. Dies bleibt als Stabilitätsbeobachtung dokumentiert und erzeugt keinen neuen Architektur- oder Refactoring-Block.

## Empfehlung

Der Branch ist nach erfolgreichem Abschluss der dokumentierten Gates für einen Merge nach `main` geeignet. Vor dem Merge sollten nur die bekannten untracked Load-/Cache-Artefakte bewusst erhalten oder separat behandelt werden; sie gehören nicht zu diesem Abschluss.
