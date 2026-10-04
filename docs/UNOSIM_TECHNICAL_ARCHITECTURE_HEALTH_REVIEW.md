# UnoSim – Technischer Architektur-, Qualitäts- und Gesundheitsbericht

> **Nicht normativ.** Analyse-Stand nach Abschluss der Tutor-SSOT-Arbeit
> (`main` @ `54cc2950`, nach #154–#158). Dieser Bericht ist die Grundlage der
> anschließenden Refactoring-Serie; deren Arbeitsstand steht in
> [UNOSIM_REFACTORING_OPL.md](UNOSIM_REFACTORING_OPL.md). Normative Verträge
> bleiben die ADRs unter [adr/](adr/) und die SSOTs unter [../ssot/](../ssot/).
>
> Status der Befunde nach der Refactoring-Serie (bestätigt, falsifiziert,
> umgesetzt, offen): siehe OPL. Dieser Bericht bleibt unverändert der
> Analyse-Stand.
>
> Ältere Planungsdokumente (z. B. `UNOSIM_TUTOR_SIMPLIFICATION_PLAN.md`)
> verweisen unter demselben Dateinamen auf eine frühere, nie versionierte
> Review vom 2026-09-29. Diese Datei ersetzt jene Referenz nicht inhaltlich;
> sie ist der hier beschriebene neue Analyse-Stand.

Methode: Lesen von Code, Tests, CI, SSOTs/ADRs und Git-Historie. Keine Änderungen,
keine Test-, Docker- oder Provider-Läufe während der Analyse.

Evidenzklassen:

- **[Code]** – direkt im Code belegt
- **[plausibel]** – Pfad im Code nachverfolgt, nicht ausgeführt
- **[gemessen]** – Messdaten aus dem Repository
- **[Hypothese]** – Vermutung ohne Beleg

Zeilenangaben beziehen sich auf `54cc2950`.

## 1. Gesamtbild

Das Projekt ist an vielen Stellen bewusst gebaut:

- Sandbox-Flags, Admission mit Reservation-Token und Gateway-Vertrag sind sauber umgesetzt.
- Der Course-Content-Snapshot hat Singleflight, Last-known-good und gepinnte Revisionen.
- Die Tutor-Evaluation nutzt den echten `TutorService` und baut die Orchestrierung nicht nach.

Die größten Schulden liegen nicht im Tutor, sondern in drei Bereichen:

- im **Simulations- und Compile-Lifecycle unter Parallelität**,
- in **einigen alten globalen Zuständen**,
- in der **Grenze zwischen Compiler und Backend-Container**.

Im Tutor gibt es vor allem Übergangsschichten und unklare Zuständigkeiten, aber keine falsche Semantik.

## 2. Kritische und hohe Befunde (Security, Isolation)

**S1. Ungeprüfter Compile im privilegierten Backend-Container: hoch [plausibel]**

- `POST /api/compile` lässt im Docker-Modus `arduino-cli` direkt im Backend-Container laufen, nicht in der Sandbox ([cli-runner.ts:60](../server/services/compiler/cli-runner.ts#L60)). Der Backend-Container hat Zugriff auf `docker.sock`.
- Der Spawn erbt die komplette Umgebung des Prozesses ([process-executor.ts:140](../server/services/process-executor.ts#L140)), also auch `UNOSIM_GATEWAY_SECRET`.
- Nicht auflösbare `#include`-Zeilen bleiben unverändert im Quelltext ([source-project.ts:349-359](../shared/source-project.ts#L349-L359)). Absolute Pfade werden nirgends abgewiesen.
- Die stderr-Ausgabe geht ungefiltert an den Client ([cli-runner.ts:133-164](../server/services/compiler/cli-runner.ts#L133-L164)).
- Ein `#include "/proc/self/environ"` könnte deshalb das Gateway-Secret in Compiler-Diagnosen sichtbar machen. Das ist nicht ausgeführt, sollte aber in einer isolierten Umgebung verifiziert werden.
- `SECURITY.md` beschreibt nur die Sandbox-Grenze der Simulation; der Compile-Pfad kommt dort nicht vor.

**S2. Globaler `lastCompiledCode` bricht die Isolation zwischen Nutzern: mittel bis hoch [Code]**

- Ein `start_simulation` ohne `code` führt den zuletzt von *irgendeinem* Nutzer kompilierten Code aus ([routes.ts:143](../server/routes.ts#L143), [simulation.ws.ts:519-527](../server/routes/simulation.ws.ts#L519-L527)).
- Der aktuelle Client sendet immer Code. Der Pfad wird also nur von manipulierten oder alten Clients erreicht.
- Der Isolationstest `concurrent-50-clients` läuft nur im `load`-Projekt, nicht in CI, und deckt nur den Pfad *mit* Code ab.

**S3. Sketch-CRUD ohne Besitzer: mittel [Code]**

- `POST/PUT/DELETE /api/sketches` arbeiten auf einem globalen `MemStorage` ([routes.ts:177-225](../server/routes.ts#L177-L225)).
- Der Client lädt `sketches[0]` als Start-Sketch für *alle* Nutzer ([useFileSystem.ts:107-131](../client/src/hooks/useFileSystem.ts#L107-L131)).
- Jeder angemeldete Nutzer kann so den Startcode aller anderen überschreiben oder löschen. Der Client selbst nutzt nur `GET`.

**S4. Race bei Runner-Wiederverwendung (fremde Ausgabe, verwaiste Container): hoch [plausibel]**

- Der `ExecutionState` gehört zum Runner und wird von Lauf zu Lauf wiederverwendet. Es gibt keinen Lauf-Token und kein Abbruchsignal.
- Ablauf des Problems:
  1. Nutzer A stoppt oder trennt die Verbindung, während er in der Warteschlange für einen Sandbox-Start-Slot steht ([execution-manager.ts:405-414](../server/services/sandbox/execution-manager.ts#L405-L414)).
  2. Der Runner wird zurückgesetzt ([sandbox-runner-pool.ts:381-452](../server/services/sandbox-runner-pool.ts#L381-L452)) und von B übernommen.
  3. Die Prüfung nach dem Warten in A's Lauf sieht B's Zustand `STARTING` und läuft weiter.
- Folgen:
  - A's Sketch-Ausgabe läuft über B's Batcher an B's Client.
  - Der Containername wurde schon *vor* dem Warten gesetzt (Zeile 394f) und dann von B überschrieben. A's Container wird deshalb nie mit `docker rm -f` entfernt.
- Bedingungen: mehr als 8 gleichzeitige Starts plus Stop oder Verbindungsabbruch in der Warteschlange. Das ist bei einem Burst zu Kursbeginn realistisch.
- Die WS-Schicht löst dasselbe Problem korrekt über Reservation-IDs ([ws-session-manager.ts:106-152](../server/routes/simulation/ws-session-manager.ts#L106-L152)); der ExecutionManager hat nichts Vergleichbares.

## 3. Architekturprobleme

- **A1. Bis zu fünf überlappende Concurrency-Mechanismen** [Code]: Admission (25), Runner-Pool-Queue (500), Sandbox-Start-Semaphore (8), Compile-Worker-Pool (fest auf ≤8 begrenzt, obwohl die Konfiguration bis 256 erlaubt: [compilation-worker-pool.ts:83-90](../server/services/compilation-worker-pool.ts#L83-L90)) und der UnifiedGatekeeper (im Docker-Betrieb nur noch auf dem Fallback-Pfad aktiv). `/api/status` vermischt die Zahlen: `capacity.compile` zeigt `COMPILE_MAX_CONCURRENT` mit den aktiven Workern, und das Legacy-Feld `compileSlots` zeigt in Wahrheit die Sandbox-Start-Semaphore ([status.routes.ts:59-70](../server/routes/status.routes.ts#L59-L70)).
- **A2. Gatekeeper-Fehler** [Code, ungetestet]:
  - Wenn ein Slot per TTL abläuft, wird zwar `slot_released` gesendet, aber kein wartender Auftrag bekommt den Slot ([unified-gatekeeper.ts:425-434](../server/services/unified-gatekeeper.ts#L425-L434)).
  - Die spätere echte Freigabe findet keinen Eintrag mehr und gibt die Warteschlange ebenfalls nicht frei ([unified-gatekeeper.ts:370-384](../server/services/unified-gatekeeper.ts#L370-L384)). Die Queue hängt also, während neue Anfragen am Fast-Path vorbeiziehen.
  - Die TTL-Tests geben nur frei und prüfen nichts davon ([unified-gatekeeper.test.ts:670-700](../tests/server/services/unified-gatekeeper.test.ts#L670-L700)).
  - Die Cache-Lock-API und `drain()` sind tote Abstraktionen.
- **A3. Fallback umgeht die Lastgrenze** [Code]:
  - Jeder Fehler des Worker-Pools führt zu einem Compile im Hauptthread ([compiler-with-fallback.ts:65-76](../server/services/compiler-with-fallback.ts#L65-L76)).
  - Abgestürzte Worker werden nicht neu gestartet ([compilation-worker-pool.ts:162-171](../server/services/compilation-worker-pool.ts#L162-L171)). Danach läuft dauerhaft alles im Hauptthread.
  - Die Worker-Queue ist unbegrenzt und hat keine Timeouts.
- **A4. Cache-Schlüssel unterscheiden sich** [Code]:
  - Der direkte Compiler hasht `code + fqbn + entryFile`, aber **ohne Header** ([arduino-compiler.ts:93-107](../server/services/arduino-compiler.ts#L93-L107)). Der Worker hasht mit Headern ([compile-worker-utils.ts:26-33](../server/services/workers/compile-worker-utils.ts#L26-L33)).
  - Folge im lokalen Modus und auf dem Fallback-Pfad: Wird nur eine Header-Datei geändert, liefert der Compile einen veralteten Erfolg aus dem Cache.
- **A5. Das HEX-Binary geht als JSON-Zahlenarray an den Client** [Code]: Es wird mitgeschickt (`Buffer` bzw. `{"0":58,…}` nach `postMessage`), aber vom Client nie genutzt ([compiler.routes.ts:190](../server/routes/compiler.routes.ts#L190)). Es liegt außerdem im LRU-Cache.
- **A6. Der Pool greift in private Felder des Runners** [Code]: Über das Cast `SandboxRunnerInternal` setzt der Pool rund 25 Felder des `ExecutionState` von Hand zurück ([sandbox-runner-pool.ts:25-63](../server/services/sandbox-runner-pool.ts#L25-L63), [381-452](../server/services/sandbox-runner-pool.ts#L381-L452)). Jedes neue Feld im Zustand ist eine mögliche Isolationslücke. Hängt der Reset, wird der Runner ersetzt, ohne dass der Container sicher beendet ist ([sandbox-runner-pool.ts:253-271](../server/services/sandbox-runner-pool.ts#L253-L271)).
- **A7. Lifecycle-Lücken:**
  - Beim Start gibt es keinen Sweep für verwaiste `unosim-sandbox-*`-Container. Bei `uncaughtException` beendet sich der Prozess im Docker-Modus sofort ([index.ts:186-193](../server/index.ts#L186-L193)), laufende Container bleiben stehen.
  - Es gibt keinen WS-Ping/Pong. Halb offene Verbindungen halten ihre Reservierung bis zum Simulations-Timeout.
  - Nachrichten einer Verbindung werden nicht serialisiert ([simulation.ws.ts:770-772](../server/routes/simulation.ws.ts#L770-L772)).
  - Für `serial_input` und `set_pin_value` gibt es kein Rate-Limit pro Nachricht.

## 4. Tutor, Course Content und Evaluation: Rückstände ohne Semantikfehler

- **T1. Übergangsschichten im `CurriculumTutorAdapter`** [Code]: Der Adapter kennt drei Snapshot-Quellen: den vom Route-Handler gelieferten Kontext, `CourseContentSnapshotProvider` und den Legacy-Zweig `DidacticContentRepository` ([curriculum-tutor-adapter.ts:192-217](../server/services/tutor/curriculum-tutor-adapter.ts#L192-L217)). Produktiv wird nur der erste genutzt (Factory ohne Abhängigkeiten). Das Repository ist als „Test-only compatibility port“ markiert, hält aber einen Zweig im Produktionscode und zehn Testdateien am Leben. `TutorCourseContentResolver.getTutorContent` wird nirgends aufgerufen.
- **T2. `match()` hat versteckte Seiteneffekte** [Code]: Die Methode verändert `activeTopicId`, `phase` und `progressionBlockedReason` ([curriculum-tutor-adapter.ts:219-256](../server/services/tutor/curriculum-tutor-adapter.ts#L219-L256)).
  - Deshalb muss `planAnswered` vorher klonen.
  - `planFollowup` ruft `match` zweimal auf.
  - Ein `catch {}` verschluckt jeden Fehler ohne Log und fällt still auf den freien Tutor zurück.
  - `findQuestion` existiert zweimal mit leicht unterschiedlicher Semantik (Adapter [curriculum-tutor-adapter.ts:618](../server/services/tutor/curriculum-tutor-adapter.ts#L618), Planner [learning-planner.ts:203](../server/services/tutor/curriculum/learning-planner.ts#L203)).
- **T3. Der Client hat bei der Mastery-Evidenz mitzureden** [Code]: `sessionHistory` mischt gespeicherte Evidenz mit den vom Client gesendeten `answerRating`/`questionId`. `collectObservations` zählt Client-Ratings für Fragen ohne gespeicherte Evidenz ([learning-planner.ts:193-201](../server/services/tutor/curriculum/learning-planner.ts#L193-L201)). Die Wirkung betrifft nur den eigenen Nutzer. Es widerspricht aber dem Geist von „deterministische Mastery“ aus ADR 0007. Das ist eine **Produkt- und Vertrauensfrage**, kein Bug.
- **T4. Verlorene Updates bei gleichzeitigen Anfragen** [Code]: Ablauf ist Klonen, Provider-Call (bis 30 s), dann Commit, bei dem der Letzte gewinnt ([tutor-service.ts:612-620](../server/services/tutor/tutor-service.ts#L612-L620), [progression-state.ts:52-64](../server/services/tutor/curriculum/progression-state.ts#L52-L64)). Zwei Anfragen auf derselben Session (Doppelklick, Retry nach 504) verlieren Evidenz. Abhilfe wäre ein Versions- oder Sperrmechanismus pro Session.
- **T5. GitHub als harte Abhängigkeit für neue Tutor-Fragen** [Code]: Neue Fragen verlangen `requireFresh`. Fällt GitHub aus, scheitern sie, während Examples mit veraltetem Stand weiterlaufen ([source-provider.ts:66-68](../server/services/examples/source-provider.ts#L66-L68)). Es gibt kein GitHub-Token; die unauthentifizierte API erlaubt 60 Anfragen pro Stunde und IP. Mit vielen Browser-Overrides ist das ein reales Risiko.
- **Kein Handlungsbedarf:**
  - Die Prompt-Duplikation zwischen Builder und `TUTOR_PROMPT_TEMPLATE_SOURCES` sichert ein Drift-Test ab (`tutor-prompt-revision.test.ts`).
  - Die Evaluation hängt nur über `canonical.ts` am Produktionscode.

## 5. Performance und Parallelität

| Befund | Status |
|---|---|
| Mit 200 Studierenden und 50 aktiven Simulationen liegt die Queue-Wartezeit bei p95 211 s. Die Doku nennt die Queue bei einer UX-Grenze von 240 s „infeasible“. Eine Simulation hält ihren Slot für die gesamte Laufzeit (Default 60 s, maximal 300 s). | [gemessen] ([CAPACITY_VALIDATION_PLAN.md](CAPACITY_VALIDATION_PLAN.md)) |
| Compose setzt `SIMULATION_MAX_CONCURRENT=200`, die Admission bleibt beim Default 25. Effektiv laufen also maximal 25 Simulationen; die 200 wirken nicht. Kalibriert empfohlen sind 50/8/200/43000. | [Code] |
| Jeder Compile & Run kompiliert zweimal: `arduino-cli` im Backend und `g++` im Sandbox-Container mit 0,25 CPU. Die REST-Compile-Kapazität ist laut Doku „nicht kalibriert“. | [Code] |
| Der globale API-Limiter erlaubt 300 Anfragen pro 15 min **pro IP** ([index.ts:113-124](../server/index.ts#L113-L124)). Hinter Campus-NAT teilt sich eine ganze Klasse dieses Budget; die identitätsbasierten Limiter existieren daneben. | [Code] Risiko, abhängig von der Netztopologie |
| Gatekeeper hängt nach TTL-Ablauf, der Fallback umgeht die Lastgrenze, die Worker-Queue ist unbegrenzt. | [Code] |
| Runner-Race (S4), keine Orphan-Sweeps, kein Heartbeat, Tutor-Lost-Update | Architekturrisiko |
| Kein `bufferedAmount`-Backpressure beim WS-Senden, stdin-Puffer bei Eingabe-Floods, Größe des Binary-JSON | [Hypothese] |
| Kleinere Leaks: `compileTimes` wächst unbegrenzt ([compilation-worker-pool.ts:265](../server/services/compilation-worker-pool.ts#L265)), nie gelöschte Race-Timer in [prepare-phase.ts:41-49](../server/services/sandbox/execution-phases/prepare-phase.ts#L41-L49) | [Code], geringe Wirkung |

## 6. Dokumentationsinkonsistenzen

| Stelle | Befund | Einordnung |
|---|---|---|
| ADR 0001 §51, `SECURITY.md` | „Backend nur von `UNOSIM_TRUSTED_PROXY` erreichbar“. Der Code prüft die Quell-IP nicht, er setzt nur `trust proxy` ([access-control.ts:177-213](../server/security/access-control.ts#L177-L213)). | echte Inkonsistenz |
| `SECURITY.md` Sandbox-Abschnitt | Der unsandboxed REST-Compile (S1) wird nicht erwähnt. | echte Inkonsistenz |
| `EXTERNAL_API.md:23` | „Initialer `handshake` mit `protocolVersion`“. Der Server sendet ihn nur bei `testRunId` ([simulation.ws.ts:762-768](../server/routes/simulation.ws.ts#L762-L768)). | echte Inkonsistenz |
| ARCHITECTURE, WS-Sicherheit | „Rate-Limiting der Nachrichtenfrequenz“: Es gibt nur ein Limit für `start_simulation`. | echte Inkonsistenz |
| Deprecation-Policy | ARCHITECTURE sagt „nach 2 Major-Releases“, der Code sagt „next major“ ([routes.ts:138-142](../server/routes.ts#L138-L142)). | konkurrierende Aussagen |
| `SECURITY.md` „Secrets/Sketch-Source nicht loggen“ | Auf Debug-Level werden Code und Payloads geloggt ([simulation.ws.ts:467-486](../server/routes/simulation.ws.ts#L467-L486), [ws-message-router.ts:41](../server/routes/simulation/ws-message-router.ts#L41)). | echte Inkonsistenz, nur bei Debug |
| `SECURITY.md` „reviewed immutable images“ | Dockerfile und CI installieren `arduino-cli` per `curl … master/install.sh \| sh`. | echte Inkonsistenz |
| ARCHITECTURE und docs/README: „Tree enthält nur normative Doku“ | Im Tree liegen rund 15 als historisch oder nicht normativ markierte Pläne und Reports sowie die historische SSOT Stage2B. | absichtlich historisch, aber die Governance-Aussage ist falsch |
| SSOT TutorQualityEvaluation und weitere getrackte Dateien | Sie verweisen auf `ssot_function_tutor_model_registration.md` und `UNOSIM_TECHNICAL_ARCHITECTURE_HEALTH_REVIEW.md`. Beide waren zum Analysezeitpunkt nie in Git. | bewusst lokal(?), für einen frischen Clone nicht nachvollziehbar |
| README/ARCHITECTURE nennen `SCALABILITY.md` „gemessene Kapazitätsgrenzen“ | Die Datei bezeichnet sich selbst als historisch. | kosmetisch bis irreführend |
| ARCHITECTURE: `ArduinoSimulatorPage` „753 Zeilen“, Coverage-Prozente, „In-Memory-Cache“, „Compile Semaphore“, „max. 60 s“ | Tatsächlich 7 Zeilen, drei Cache-Ebenen, Gatekeeper/Pool, maximal 300 s. | veraltet, eher kosmetisch |
| Config | `disableGatekeeper` und `compilation.timeoutMs` werden nicht genutzt; der CLI-Timeout ist auf 60 s fest codiert. | tote Wahrheit |

Bewusste Non-Goals, also **keine** Inkonsistenz: Single-Node-In-Memory-State und fehlende HA (ADR 0003), Stage-2B-SSOT als Historie, der Default-Satz an Kapazitätswerten.

## 7. Priorisierte Refactorings

**R1: Compile-Pfad absichern** (aus S1)

- **Root Cause:** ungeprüfter Code wird im Backend kompiliert, die Umgebung wird vererbt, Includes werden nicht validiert.
- **Betroffen:** `process-executor`, `cli-runner`, `source-project`/`compile`-Schema.
- **Nutzen:** schließt einen möglichen Weg zur Offenlegung von Secrets.
- **Risiko bei Nichtbehebung:** hoch.
- **Aufwand:** klein. **Änderungsradius:** klein. **Regressionsrisiko:** gering (nur absolute oder `..`-Includes werden abgelehnt).
- **Tests:** Unit-Tests zur Ablehnung, Test der Env-Allowlist, Toolchain-Canary.
- **PR-Grenze:** ein PR, „env allowlist + include guard“.
- **Abhängigkeiten:** keine. Später optional: REST-Compile in die Sandbox verlegen (größer, eigene Entscheidung).

**R2: Globale Altlasten entfernen** (aus S2, S3)

- **Root Cause:** Kompatibilitäts-Fallback und Demo-CRUD.
- **Betroffen:** `routes.ts`, `compiler.routes`, `simulation.ws`, `storage.ts`.
- **Nutzen:** echte Isolation zwischen Nutzern.
- **Risiko bei Nichtbehebung:** mittel bis hoch.
- **Aufwand:** klein. **Radius:** klein. **Regressionsrisiko:** gering, weil der Client immer Code sendet und die iframe-API nicht über WS läuft.
- **Tests:** „start ohne code erzeugt einen Fehler“, Sketch-Schreibendpunkte liefern 404/405.
- **PR-Grenze:** ein PR. **Abhängigkeiten:** keine.

**R3: Laufzeit-Generation im Runner-Lifecycle** (aus S4, A6)

- **Root Cause:** wiederverwendeter, veränderlicher `ExecutionState` ohne Lauf-Token; der Reset liegt außerhalb des Runners.
- **Betroffen:** `execution-manager`, `sandbox-runner`, `sandbox-runner-pool`, `docker-compile-semaphore` (dort ein `AbortSignal` ergänzen).
- **Nutzen:** keine fremde Ausgabe, keine verwaisten Container, Reset an einer Stelle.
- **Risiko bei Nichtbehebung:** hoch unter Kurslast.
- **Aufwand:** mittel. **Radius:** mittel. **Regressionsrisiko:** mittel.
- **Tests:** deterministischer Race-Test (Stop während des Semaphore-Wartens, B übernimmt, keine Ausgabe-Überkreuzung, `rm -f` des ersten Containers), danach die Docker-Integrationstests.
- **PR-Grenzen:** zwei PRs: (a) Token und Abbruch, (b) `runner.resetForReuse()`.
- **Abhängigkeiten:** keine.

**R4: Robustheit des Sandbox- und WS-Lifecycle** (aus A7)

- **Inhalt:** Label pro Instanz und Orphan-Sweep beim Start, WS-Heartbeat, Serialisierung pro Verbindung, Nachrichtenlimit für Ein-/Ausgabe-Nachrichten.
- **Nutzen:** Ressourcen nach Crashes und WLAN-Abbrüchen werden wieder frei.
- **Aufwand:** mittel. **Radius:** mittel. **Regressionsrisiko:** gering bis mittel.
- **Tests:** Lifecycle-Tests mit Fake-Timern, Docker-Sweep-Test.
- **PR-Grenzen:** zwei PRs (Sweep; WS). **Abhängigkeiten:** sinnvoll nach R3.

**R5: Compile-Concurrency konsolidieren** (aus A1–A3)

- **Inhalt:**
  - TTL-Ablauf gibt Wartende frei, die toten Cache-Locks fallen weg.
  - Der Fallback läuft nur über eine begrenzte Queue oder lehnt schnell mit „busy“ ab.
  - Abgestürzte Worker werden neu gestartet.
  - Die Worker-Queue bekommt eine Obergrenze und Timeouts.
  - Status-Metriken werden 1:1 zugeordnet, die stille Begrenzung auf 8 Worker wird explizit.
- **Nutzen:** Backpressure greift auch im Fehlerfall.
- **Aufwand:** mittel. **Radius:** mittel. **Regressionsrisiko:** mittel (Status-Felder sind Legacy-Vertrag).
- **Tests:** echte TTL-Tests, Tests für Pool-Crash und Neustart.
- **PR-Grenzen:** zwei PRs (Gatekeeper; Pool/Fallback). **Abhängigkeiten:** keine.

**R6: Einheitlicher Compile-Cache-Schlüssel und Payload ohne Binary** (aus A4, A5)

- **Inhalt:** ein gemeinsames `buildSketchHash` (Header, Bibliotheken, Cache-Version); `binary` wird vor `res.json` und dem LRU-Cache entfernt.
- **Aufwand:** klein. **Radius:** klein. **Regressionsrisiko:** gering (alte Cache-Einträge werden einmalig ungültig).
- **Tests:** „nur Header geändert, frischer Compile“; Response enthält kein `binary`.
- **PR-Grenze:** ein PR. **Abhängigkeiten:** keine.

**R7: Rate-Limit-Topologie**

- **Inhalt:** Der globale Limiter nutzt im Gateway-Modus `subject` als Schlüssel statt der IP.
- **Aufwand:** klein. **Radius:** klein. **Regressionsrisiko:** gering.
- **Tests:** Route-Tests für beide Trust-Modi.
- **PR-Grenze:** ein PR. **Abhängigkeiten:** keine.

**R8: Konsistenz der Tutor-Session** (aus T2, T4)

- **Inhalt:** `match` wird in eine reine Auflösung und eine explizite Zustandsänderung getrennt. Commit mit Versionsprüfung oder Mutex pro Session (bei Konflikt 409 oder Retry). Ein gemeinsames `findQuestion`. Fehler in `match` werden geloggt.
- **Semantik:** ausdrücklich unverändert.
- **Nutzen:** zukünftige Planner-Änderungen werden billiger und sicherer.
- **Aufwand:** mittel. **Radius:** Tutor-intern. **Regressionsrisiko:** mittel.
- **Tests:** die bestehende deterministische Tutor-Quality-Suite als Charakterisierungs-Gate, dazu ein Concurrency-Test.
- **PR-Grenzen:** zwei PRs (pure Auflösung; Session-Concurrency).
- **Abhängigkeiten:** nach R9 einfacher.

**R9: Übergangsschichten im Tutor entfernen** (aus T1)

- **Inhalt:** Tests auf den gelieferten `TutorPlanningContentContext` umstellen; Legacy-Repository-Zweig, `CourseContentSnapshotProvider` und `getTutorContent` entfernen.
- **Aufwand:** klein bis mittel. **Radius:** Tutor plus zehn Testdateien. **Regressionsrisiko:** gering.
- **PR-Grenzen:** zuerst Tests umstellen, dann den Code entfernen. **Abhängigkeiten:** keine.

**R10: Doku-Governance** (aus Abschnitt 6, *spätere* Doku-PRs)

- **Inhalt:** historische Dokumente nach `docs/history/` verschieben oder im Index kennzeichnen; ADR-0001-Aussage zur Proxy-IP entweder im Code durchsetzen oder als Betreiberpflicht formulieren; Handshake und Deprecation-Policy angleichen; nur lokal vorhandene Referenzen klären.
- **Aufwand:** klein. **Regressionsrisiko:** keins. Nach R1, R2 und R4, damit die Doku den neuen Stand beschreibt.

## 8. Empfohlene Reihenfolge

R1 → R2 → R6 → R7 (kleine Fixes mit großem Hebel, unabhängig voneinander) → R3 → R4 → R5 → R9 → R8 → R10.

## 9. Bewusst nicht refactoren

- **Zwei Compile-Pipelines** (AVR-`arduino-cli` für Diagnose und Speicherangaben, `g++`-Mock für die Simulation). Sie sind fachlich begründet; nur ihre Kosten in der Kapazitätsrechnung sichtbar machen.
- **Prompt-Template-Duplikation**: durch einen Drift-Test abgesichert.
- **Ort des Evaluation-Subsystems**: es nutzt den echten `TutorService`.
- **SourceProvider mit Singleflight und Last-known-good** sowie das **Admission-/Reservation-Design**: das ist das Vorbild für R3.
- **Single-Node-In-Memory-State** (ADR 0003): kein Redis ohne konkreten HA-Bedarf.
- **Großer Composition-Hook** `useArduinoSimulatorPage` (893 Zeilen): keine Defekt-Evidenz.
- **Tote Client-Hooks** (`use-simulation`, `use-compilation`, `use-telemetry`, nur von Tests am Leben gehalten): Aufräumen nur nebenbei, kein eigener PR.
- **Historische SSOTs und Pläne**: inhaltlich behalten, nur verorten.
- **Content- und Qualitätspunkte** (16 Serial-Examples ohne DEEPEN, fehlende Extensions, `expand-observable-result`, vorsichtige Bewertungen): Content-Arbeit, keine Architektur.

## 10. Vor weiterer Tutor-Qualitätsarbeit und unabhängig davon

- **Vorher bereinigen:** R9 und der „pure“-Teil von R8. Beides senkt Kosten und Risiko jeder weiteren Planner- oder Phasenänderung, ohne die Baseline zu berühren. T3 und T5 sollten vorher als Produktentscheidung geklärt sein, weil sie festlegen, was „deterministische Mastery“ und ein Tutor-Ausfall bedeuten.
- **Unabhängig, aber insgesamt wichtiger:** R1–R7. Sie betreffen Sicherheit, Isolation und Kurslast, nicht die Tutor-Semantik.
- **Offene Produktfragen, keine Refactorings:**
  - Schwache oder mittlere Antwort in LEARN, wenn das aktuelle Concept erschöpft ist (noch nicht spezifiziert).
  - Sollen Client-Ratings überhaupt zur Mastery zählen (T3)?
  - Last-known-good statt Fehler für neue Tutor-Fragen bei GitHub-Ausfall (T5)?
  - Absolute 1-Stunden-TTL der Tutor-Session.
  - Simulations-Slot für die gesamte Laufzeit belegen, Default-Timeout, automatisches Stoppen inaktiver Simulationen. Das ist der eigentliche Hebel für die gemessene Queue-Grenze bei Kursgröße.

Nicht vertieft geprüft wurden die UI-Komponenten, die Parser- und Registry-Module (`io-registry-parser`, `registry-manager`) und die E2E-Specs.
