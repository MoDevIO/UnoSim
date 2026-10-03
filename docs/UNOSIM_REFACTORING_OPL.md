# UnoSim – Refactoring-OPL (Open Points List)

> **Nicht normativ.** Arbeitsstand der Refactoring-Serie, die aus
> [UNOSIM_TECHNICAL_ARCHITECTURE_HEALTH_REVIEW.md](UNOSIM_TECHNICAL_ARCHITECTURE_HEALTH_REVIEW.md)
> (Analyse-Stand `54cc2950`) abgeleitet ist. Die Liste wird nach jedem
> abgeschlossenen PR aktualisiert. Normative Verträge bleiben ADRs und SSOTs.

Statuswerte: `OPEN` · `IN_PROGRESS` · `BLOCKED_DECISION` · `FALSIFIED` · `DONE` · `DEFERRED`

Reihenfolge laut Auftrag: R1 → R2 → R6 → R7 → R3 → R4 → R5 → R9 → R8 → R10.
Abweichungen werden unter „Reihenfolge-Änderungen“ begründet.

## Refactorings

| ID | Befund | Kategorie | Evidenz | Risiko | Nutzen | Aufwand | Abhängigkeiten | Ziel-PR | Status | Verifikation | Merge-SHA/Ergebnis |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R1 | Compile-Pfad absichern: sichere Include-Grenze vor arduino-cli (Env-Allowlist entfällt, siehe S1-ENV) | Security | S1 [Code, mit Sentinel verifiziert] | hoch | schließt den Kanal, über den eine beliebige lesbare Datei vollständig in Diagnosen erscheint | klein | – | fix/compile-include-guard | DONE | RED→GREEN: `include-guard.test.ts` (25), `arduino-compiler-include-guard.test.ts` (2), Toolchain-Sentinel-Test `compile-include-boundary.test.ts` (echte arduino-cli; vorher Sentinel in der Antwort, nachher nicht); Unit 2697 grün | PR-Merge siehe Verlauf |
| R2 | `lastCompiledCode`-Fallback und Sketch-CRUD pro Identität absichern (nicht entfernen) | Isolation | S2, S3 [Code] | mittel–hoch | Nutzerisolation ohne Bruch des REST-/WS-Vertrags | klein | – | fix/isolate-legacy-global-state | DONE | RED→GREEN: `simulation-last-compiled-code.test.ts` (fremder Code wird nie ausgeführt, eigener Fallback bleibt), `last-compiled-code-store.test.ts`, `sketches.routes.test.ts` (Seed read-only, fremde Sketches 404); zwei Bestandstests an Identität angepasst (Begründung im PR) | PR-Merge siehe Verlauf |
| R6 | Einheitlicher Compile-Hash inkl. Header; kein Binary in REST-Payload/LRU | Korrektheit/Performance | A4, A5 [Code] | mittel | keine veralteten Cache-Treffer, kleinere Antworten | klein | – | fix/compile-cache-key-and-payload | OPEN | Header-only-Änderung → frischer Compile; Response ohne `binary` | – |
| R7 | Globaler API-Limiter im Gateway-Modus nach `subject` statt IP | Skalierung | P1 [Code] | mittel (topologieabhängig) | keine klassenweiten 429 hinter NAT | klein | – | fix/api-rate-limit-identity | OPEN | Route-Tests beider Trust-Modi | – |
| R3a | Lauf-Generation + Abbruch im Runner-Lifecycle | Isolation/Lifecycle | S4 [plausibel] | hoch | keine fremde Ausgabe, keine verwaisten Container | mittel | – | fix/runner-run-generation | OPEN | deterministischer Race-Test A wartet → A stoppt → B übernimmt | – |
| R3b | Reset-Ownership in `runner.resetForReuse()` | Kapselung | A6 [Code] | mittel | Reset an einer Stelle | mittel | R3a | refactor/runner-reset-ownership | OPEN | Pool-/Isolationstests | – |
| R4a | Orphan-Sweep für Sandbox-Container | Lifecycle | A7 [Code] | mittel | Ressourcen nach Crash frei | klein–mittel | R3a | fix/sandbox-orphan-sweep | OPEN | Sweep-Test (Fake-Executor), Docker-Gate | – |
| R4b | WS-Heartbeat, Serialisierung pro Verbindung, Nachrichtenlimit | Lifecycle | A7 [Code] | mittel | halb offene Verbindungen und Floods begrenzt | mittel | – | fix/ws-connection-lifecycle | OPEN | Lifecycle-Tests mit Fake-Timern | – |
| R5a | Gatekeeper: Queue-Fortsetzung nach TTL, tote Cache-Lock-API | Concurrency | A2 [Code] | mittel | keine hängende Compile-Queue | klein | – | fix/gatekeeper-ttl-handoff | OPEN | echter TTL-Test | – |
| R5b | Worker-Pool: Recovery, begrenzte Queue/Timeouts, begrenzter Fallback, Statusmetriken | Concurrency | A1, A3 [Code] | mittel | Backpressure auch im Fehlerfall | mittel | R5a | fix/compile-pool-backpressure | OPEN | Pool-Crash-/Queue-Tests, Status-Tests | – |
| R9 | Tutor-Übergangsschichten (Legacy-Repository-Zweig, Snapshot-Provider, `getTutorContent`) entfernen | Tutor-Wartbarkeit | T1 [Code] | gering | weniger Pfade im Adapter | klein–mittel | – | refactor/tutor-adapter-legacy-sources | OPEN | Tests zuerst migriert; Tutor-Quality-Suite unverändert grün | – |
| R8a | `match()` in reine Auflösung + explizite State-Änderung; ein `findQuestion`; Fehler diagnostizieren | Tutor-Wartbarkeit | T2 [Code] | gering–mittel | sichere Planner-Änderungen | mittel | R9 | refactor/tutor-adapter-pure-match | OPEN | Tutor-Quality-Suite als Charakterisierungs-Gate | – |
| R8b | Session-Concurrency mit Versions-/Lock-Vertrag | Tutor-Konsistenz | T4 [Code] | mittel | keine verlorenen Updates | mittel | R8a | fix/tutor-session-concurrency | OPEN | Concurrency-Test | – |
| R10 | Doku an implementierten Stand angleichen | Doku | Abschnitt 6 | gering | konsistente Doku | klein | R1–R8 | docs/consistency-after-refactoring | OPEN | `check:docs` | – |

## Einzelbefunde

| ID | Befund | Kategorie | Evidenz | Risiko | Nutzen | Aufwand | Abhängigkeiten | Ziel-PR | Status | Verifikation | Merge-SHA/Ergebnis |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 | Absolutes/traversierendes `#include` lässt arduino-cli eine beliebige lesbare Datei lesen und in stderr ausgeben | Security | [Code] verifiziert: synthetische Sentinel-Datei erschien vollständig in der REST-Compile-Antwort | hoch | – | – | – | R1 | DONE | `compile-include-boundary.test.ts` | durch R1 geschlossen |
| S1-ENV | Env-Leak über geerbte Prozessumgebung und `/proc/*/environ` | Security | g++ 12 (Sandbox-Image) und avr-g++ 7.3 (Backend-Image) lesen `/proc/self/environ` und `/proc/1/environ` per `#include` und `.incbin` als leer (Sentinel-Env-Variable nicht sichtbar) | – | – | – | – | – | FALSIFIED | Docker-Experiment mit synthetischer Variable | keine Env-Allowlist umgesetzt |
| S1-INCBIN | `.incbin` im Inline-Assembler bettet reguläre Dateien ins HEX ein; das HEX geht derzeit im REST-JSON an den Client | Security | [Code] verifiziert (Marker-Datei im Objekt) | mittel | – | – | – | R6 | OPEN | Response ohne `binary` | Kanal schließt mit R6 |
| S1-ASM | GAS `.include` im Inline-Assembler gibt die ersten ~10 Zeichen je Zeile einer beliebigen Datei als Fehlermeldung aus; per String-Konkatenation nicht robust textuell filterbar | Security | [Code] verifiziert (Marker-Präfix in der Assemblermeldung) | mittel (Teilinhalt; Default-Deployment hält Secrets nur in Env) | – | groß | – | – | BLOCKED_DECISION | – | Robuster Fix = REST-Compile ohne Zugriff auf Backend-Dateien (Sandbox/Namespace); Architekturentscheidung |
| S2 | Globaler `lastCompiledCode` | Isolation | [Code] bestätigt | mittel–hoch | – | – | – | R2 | DONE | WS-Test zweier Subjects | Fallback jetzt pro Subject (LRU, 1000 Subjects) |
| S3 | Sketch-CRUD ohne Besitzer | Isolation | [Code] bestätigt | mittel | – | – | – | R2 | DONE | Route-Test zweier Identitäten | Schreiben nur auf eigene Sketches, Seed schreibgeschützt |
| S4 | Runner-Reuse-Race | Isolation/Lifecycle | [plausibel] | hoch | – | – | – | R3a | OPEN | Race-Test | – |
| A1 | Überlappende Concurrency-Mechanismen, vermischte Statusmetriken | Concurrency | [Code] | mittel | – | – | – | R5b | OPEN | – | – |
| A2 | Gatekeeper-TTL ohne Queue-Fortsetzung, tote Cache-Locks | Concurrency | [Code] | mittel | – | – | – | R5a | OPEN | – | – |
| A3 | Fallback umgeht Lastgrenze, keine Worker-Recovery, unbegrenzte Queue | Concurrency | [Code] | mittel | – | – | – | R5b | OPEN | – | – |
| A4 | Compile-Hash ohne Header im direkten Compiler | Korrektheit | [Code] | mittel | – | – | – | R6 | OPEN | – | – |
| A5 | HEX-Binary in REST-JSON und LRU | Performance | [Code] | gering | – | – | – | R6 | OPEN | – | – |
| A6 | Pool setzt private Runner-Felder zurück | Kapselung | [Code] | mittel | – | – | – | R3b | OPEN | – | – |
| A7 | Kein Orphan-Sweep, kein Heartbeat, keine Serialisierung, kein Message-Limit | Lifecycle | [Code] | mittel | – | – | – | R4a/R4b | OPEN | – | – |
| P1 | Globaler API-Limiter pro IP (Campus-NAT) | Skalierung | [Code] | mittel | – | – | – | R7 | OPEN | – | – |
| T1 | Tutor-Adapter mit drei Snapshot-Quellen | Tutor | [Code] | gering | – | – | – | R9 | OPEN | – | – |
| T2 | `match()` mit Seiteneffekten, doppeltes `findQuestion`, verschluckte Fehler | Tutor | [Code] | gering–mittel | – | – | – | R8a | OPEN | – | – |
| T3 | Client-Ratings fließen in Mastery-Evidenz ein | Produkt/Trust | [Code] | gering | – | – | – | – | BLOCKED_DECISION | – | Produktentscheidung |
| T4 | Lost Update bei parallelen Anfragen einer Session | Tutor | [Code] | mittel | – | – | – | R8b | OPEN | – | – |
| T5 | Neue Tutor-Fragen scheitern bei GitHub-Ausfall (`requireFresh`) | Produkt/Verfügbarkeit | [Code] | mittel | – | – | – | – | BLOCKED_DECISION | – | Produktentscheidung |

## Produktentscheidungen (nicht implementieren)

| ID | Befund | Kategorie | Evidenz | Risiko | Nutzen | Aufwand | Abhängigkeiten | Ziel-PR | Status | Verifikation | Merge-SHA/Ergebnis |
|---|---|---|---|---|---|---|---|---|---|---|---|
| D1 | LEARN nach schwacher/mittlerer Antwort, wenn das Concept erschöpft, das Topic aber noch probeable ist | Produkt | nicht spezifiziert | – | – | – | – | – | BLOCKED_DECISION | – | – |
| D2 | = T3: dürfen Client-Ratings Mastery beeinflussen? | Produkt/Trust | [Code] | – | – | – | – | – | BLOCKED_DECISION | – | – |
| D3 | = T5: Verhalten neuer Tutor-Fragen bei GitHub-Ausfall / Last-known-good | Produkt | [Code] | – | – | – | – | – | BLOCKED_DECISION | – | – |
| D4 | Session-TTL (absolut 1 h) als Produktpolitik | Produkt | [Code] | – | – | – | – | – | BLOCKED_DECISION | – | – |
| D5 | Simulationsslot-Laufzeit, Inaktivitäts-Timeout, automatische Beendigung | Kapazität/Produkt | [gemessen] | – | – | – | – | – | BLOCKED_DECISION | – | – |

## Reihenfolge-Änderungen

- R2 sichert statt zu entfernen: Der Code deklariert den Code-losen Start als
  Kompatibilität bis zum nächsten Protokoll-Major, und ARCHITECTURE verlangt für
  inkompatible REST-Änderungen eine neue Major-Version. Die Isolation pro
  Identität erreicht das Ziel ohne Vertragsbruch.
- R1 umfasst nur die Include-Grenze. Der `.incbin`-Kanal (S1-INCBIN) wird mit R6
  geschlossen, weil dort das Binary aus der REST-Antwort entfernt wird.

## Verlauf

| PR | Inhalt | Merge-SHA | CI |
|---|---|---|---|
| #159 | Audit-Bericht und diese OPL | `0863ba1f` | PR-CI 5/5 grün; Post-Merge-CI siehe nächster Eintrag |
| #160 | R1: Include-Grenze für den REST-Compiler | `1c2995d9` | PR-CI 5/5 grün; Post-Merge-CI von #159 grün |
| R2 | Per-Identity-Isolation von Code-Fallback und Sketch-CRUD | – | – |
