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
| R6 | Einheitlicher Compile-Hash inkl. Header (Worker-Identität); kein Binary in REST-Payload/LRU | Korrektheit/Performance/Security | A4, A5, S1-INCBIN [Code] | mittel | keine veralteten Cache-Treffer; Worker und direkter Pfad teilen Cache-Einträge; Antwort 59.653 → 562 Byte (Blink-Sketch, Worker-Pfad) | klein | – | fix/compile-cache-key-and-payload | DONE | RED→GREEN: `arduino-compiler-cache-key.test.ts` (Header-Änderung kompiliert neu; gleiche Identität wie der Worker), `compiler-binary-payload.test.ts` (frisch, gecacht, LRU ohne `binary`) | PR-Merge siehe Verlauf |
| R7 | Globaler API-Limiter im Gateway-Modus nach authentifiziertem `subject` statt IP | Skalierung | P1 [Code] | mittel (topologieabhängig) | keine kursweiten 429 hinter Campus-NAT | klein | – | fix/api-rate-limit-identity | DONE | RED→GREEN: `api-rate-limit-key.test.ts` (zwei Subjects hinter einer IP mit getrenntem Budget; ungültiges Gateway-Secret und Local-Modus bleiben pro IP) | PR-Merge siehe Verlauf |
| R3a | Lauf-Generation + Abbruch im Runner-Lifecycle; `ProcessController` leitet nur Events des aktuellen Kindprozesses weiter | Isolation/Lifecycle | S4, S4-CHILD [Code, deterministisch reproduziert] | hoch | keine fremde Ausgabe, kein Start mit fremdem/aufgeräumtem Verzeichnis, kein Eingriff in den Container des Nachfolgers | mittel | – | fix/runner-run-generation | DONE | RED→GREEN: `runner-reuse-race.test.ts` (echter Pool/Runner/ExecutionManager/Semaphore; vorher startete A mit eigenem, bereits gelöschtem Verzeichnis für B), `docker-compile-semaphore-abort.test.ts`, `process-controller-stale-child.test.ts`; Unit 2714, Docker-Integration 26/26 | PR-Merge siehe Verlauf |
| R3b | Reset-Ownership in `SandboxRunner.resetForReuse()`; Pool greift nicht mehr in private Runner-Felder | Kapselung | A6 [Code] | mittel | Reset an einer Stelle; neue Felder können nicht mehr am Pool vorbei vergessen werden | mittel | R3a | refactor/runner-reset-ownership | DONE | `sandbox-runner-reset.test.ts` (echter Runner: Felder, Listener, Registry-Reset, Stop-Fehler); Pool-Tests prüfen nur noch die Delegation (Feldaussagen verschoben, keine entfernt) | PR-Merge siehe Verlauf |
| R4a | Owner-Label `unosim.owner=<host>:<pid>` an jedem Sandbox-Container; Sweep der Container einer früheren Inkarnation beim Start (Docker-Modus) | Lifecycle | A7 [Code] | mittel | nach Crash-Restart (gleicher Host, PID 1) laufen keine verwaisten Sketch-Container mehr weiter; fremde UnoSim-Instanzen bleiben unberührt | klein–mittel | R3a | fix/sandbox-orphan-sweep | DONE | RED→GREEN: `orphan-sweep.test.ts` (Label, Sweep, Fehlertoleranz); `sandbox-orphan-sweep.test.ts` in der Docker-Suite (echter Container des eigenen Owners entfernt, fremder bleibt) | PR-Merge siehe Verlauf |
| R4b | WS-Ping/Pong-Heartbeat (30 s), Token-Bucket pro Verbindung (500/s, Burst 1000), stdin-Obergrenze 1 MiB | Lifecycle | A7 [Code] | mittel | halb offene Verbindungen geben Runner und Reservation nach ≤ 2 Intervallen frei; Floods erzeugen keine unbegrenzten stdin-Schreibvorgänge | mittel | – | fix/ws-connection-lifecycle | DONE | RED→GREEN: `simulation-connection-lifecycle.test.ts` (stummer Client getrennt + Simulation freigegeben; antwortender bleibt; Flood gedrosselt, Verbindung bleibt), `process-controller-stdin-bound.test.ts` | PR-Merge siehe Verlauf |
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
| S1-INCBIN | `.incbin` im Inline-Assembler bettet reguläre Dateien ins HEX ein; das HEX ging im REST-JSON an den Client | Security | [Code] verifiziert (Marker-Datei im Objekt) | mittel | – | – | – | R6 | DONE | Response ohne `binary` | HEX verlässt den Server nicht mehr |
| S1-ASM | GAS `.include` im Inline-Assembler gibt die ersten ~10 Zeichen je Zeile einer beliebigen Datei als Fehlermeldung aus; per String-Konkatenation nicht robust textuell filterbar | Security | [Code] verifiziert (Marker-Präfix in der Assemblermeldung) | mittel (Teilinhalt; Default-Deployment hält Secrets nur in Env) | – | groß | – | – | BLOCKED_DECISION | – | Robuster Fix = REST-Compile ohne Zugriff auf Backend-Dateien (Sandbox/Namespace); Architekturentscheidung |
| S2 | Globaler `lastCompiledCode` | Isolation | [Code] bestätigt | mittel–hoch | – | – | – | R2 | DONE | WS-Test zweier Subjects | Fallback jetzt pro Subject (LRU, 1000 Subjects) |
| S3 | Sketch-CRUD ohne Besitzer | Isolation | [Code] bestätigt | mittel | – | – | – | R2 | DONE | Route-Test zweier Identitäten | Schreiben nur auf eigene Sketches, Seed schreibgeschützt |
| S4 | Runner-Reuse-Race | Isolation/Lifecycle | [Code] deterministisch reproduziert | hoch | – | – | – | R3a | DONE | Race-Test | Restfenster: Stop genau während `spawn` (ms); verwaiste Container fängt R4a |
| S4-CHILD | `ProcessController` leitet stdout/stderr/close/error eines ersetzten Kindprozesses an die Listener des nächsten Laufs weiter | Isolation/Lifecycle | [Code] reproduziert (neu bei R3a-Verifikation) | mittel | – | – | – | R3a | DONE | `process-controller-stale-child.test.ts` | – |
| A1 | Überlappende Concurrency-Mechanismen, vermischte Statusmetriken | Concurrency | [Code] | mittel | – | – | – | R5b | OPEN | – | – |
| A2 | Gatekeeper-TTL ohne Queue-Fortsetzung, tote Cache-Locks | Concurrency | [Code] | mittel | – | – | – | R5a | OPEN | – | – |
| A3 | Fallback umgeht Lastgrenze, keine Worker-Recovery, unbegrenzte Queue | Concurrency | [Code] | mittel | – | – | – | R5b | OPEN | – | – |
| A4 | Compile-Hash ohne Header im direkten Compiler | Korrektheit | [Code] bestätigt | mittel | – | – | – | R6 | DONE | Header-only-Test | `libraries` bleibt außerhalb des Hashes: arduino-cli erhält sie nicht |
| A5 | HEX-Binary in REST-JSON und LRU | Performance | [Code] bestätigt, [gemessen] 59.653 statt 562 Byte | gering | – | – | – | R6 | DONE | Payload-Test | Simulation nutzt das REST-Binary nicht |
| A6 | Pool setzt private Runner-Felder zurück | Kapselung | [Code] bestätigt | mittel | – | – | – | R3b | DONE | – | Pools `removeAllListeners`-Aufrufe waren wirkungslos (keine EventEmitter), `fileBuilder.reset` existierte nicht |
| A7 | Kein Orphan-Sweep, kein Heartbeat, kein Message-Limit | Lifecycle | [Code] bestätigt | mittel | – | – | – | R4a/R4b | DONE | – | – |
| A7-SERIAL | „Keine Serialisierung pro Verbindung“ als Defekt | Lifecycle | Verifikation: Nebenläufigkeit ist nötig, damit `stop_simulation`/`code_changed` einen wartenden Start abbrechen (`abortQueuedAcquire`); Doppelstarts verhindert die Reservation; synchrone Handler behalten die Reihenfolge | – | – | – | – | – | FALSIFIED | – | volle Serialisierung würde Stop-während-Warten brechen |
| P1 | Globaler API-Limiter pro IP (Campus-NAT) | Skalierung | [Code] bestätigt | mittel | – | – | – | R7 | DONE | Route-Test | Local-Modus bewusst pro IP: dort kann ein Client jederzeit eine neue Session erhalten |
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

- R4a begrenzt den Sweep bewusst auf den eigenen Owner (`<host>:<pid>`) statt
  auf ein Alterskriterium: Pausierte Simulationen haben keine Maximaldauer, und
  mehrere UnoSim-Instanzen können sich einen Docker-Host teilen. Ein Redeploy
  mit neuem Container-Hostnamen wird dadurch nicht abgedeckt; dort beendet der
  geordnete Shutdown die Runner.
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
| #161 | R2: Per-Identity-Isolation von Code-Fallback und Sketch-CRUD | `18c7d89b` | PR-CI 5/5 grün; Post-Merge-CI von #160 grün |
| #162 | R6: Einheitlicher Compile-Hash, kein Binary in der REST-Antwort | `9716910d` | PR-CI 5/5 grün; Post-Merge-CI von #161 grün |
| #163 | R7: Globaler API-Limiter nach Gateway-Subject | `7a39d554` | PR-CI 5/5 grün; Post-Merge-CI von #162 grün |
| #164 | R3a: Lauf-Generation, abbrechbares Start-Slot-Warten, Kindprozess-Guard | `0042bc08` | PR-CI 5/5 grün; Post-Merge-CI von #163 grün |
| #165 | R3b: Reset-Ownership im Runner | `206d2033` | PR-CI 5/5 grün; Post-Merge-CI von #164 grün |
| #166 | R4a: Orphan-Sweep für Sandbox-Container | `61ed9a64` | PR-CI 5/5 grün; Post-Merge-CI von #165 grün |
| R4b | WS-Heartbeat, Nachrichtenlimit, stdin-Obergrenze | – | – |
