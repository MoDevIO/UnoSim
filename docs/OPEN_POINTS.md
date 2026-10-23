# UnoSim – Offene Punkte (OPL)

> **Nicht normativ.** Enthält nur offene Punkte. Jeder Punkt wurde am
> 2026-10-11 gegen `main` @ `4dcc1ae9` geprüft. Erledigte Punkte werden aus
> dieser Liste entfernt; die abgeschlossene Refactoring-Serie mit Verlauf steht
> in [archive/refactoring/REFACTORING_OPL.md](archive/refactoring/REFACTORING_OPL.md).
> Normative Verträge bleiben ADRs und SSOTs.

Kein offener Punkt ist mit Risiko „hoch“ bewertet.

Statuswerte: `BLOCKED_DECISION` (wartet auf eine Entscheidung) · `DEFERRED`
(bewusst zurückgestellt) · `OPEN` (entschieden, noch nicht umgesetzt)

## Sicherheit und Verträge

| ID | Befund | Risiko | Beleg | Status | Nötige Entscheidung |
|---|---|---|---|---|---|
| R10-PROXY | ADR 0001 §51 verlangt, dass das Backend nur von `UNOSIM_TRUSTED_PROXY` erreichbar ist. Der Code validiert die Einstellung nur und setzt damit `trust proxy`; die Quell-IP eingehender Verbindungen prüft er nicht. | mittel | [access-control.ts:135-142](../server/security/access-control.ts#L135-L142), [index.ts:53](../server/index.ts#L53) | BLOCKED_DECISION | Quell-IP-Prüfung im Code (Rollout-Risiko bei falsch gesetztem Wert) oder ADR als Betreiberpflicht formulieren |
| S1-ASM | Die GAS-Direktive `.include` im Inline-Assembler gibt die ersten Zeichen jeder Zeile einer lesbaren Datei als Fehlermeldung aus. Ein Textfilter lässt sich per String-Konkatenation umgehen. Im Docker-Profil kompiliert der REST-Compile seit P2.4 in der Compile-Sandbox (nur Dateien des öffentlichen Images lesbar); offen bleibt das lokale Profil (ein Entwickler, Loopback), Restrisiko in [SECURITY.md](SECURITY.md). | gering | Marker-Präfix in der Assemblermeldung reproduziert; Vertragstest `compile-sandbox-contract.test.ts` | BLOCKED_DECISION | Annahme von ADR 0010 durch die Maintainer; lokales Profil bewusst ohne Sandbox |
| R10-HANDSHAKE | [EXTERNAL_API.md](EXTERNAL_API.md) beschreibt einen initialen `handshake` mit `protocolVersion`. Der Server sendet ihn nur, wenn der Client eine `testRunId` mitschickt. | gering | [simulation.ws.ts:889-895](../server/routes/simulation.ws.ts#L889-L895) | BLOCKED_DECISION | Handshake immer senden (Schemaänderung, `testRunId` optional) oder Vertragstext anpassen |

## Produktentscheidungen

| ID | Befund | Risiko | Beleg | Status | Nötige Entscheidung |
|---|---|---|---|---|---|
| T3 | Vom Client gesendete `answerRating`-Werte zählen als Mastery-Evidenz, solange für die Frage keine gespeicherte Evidenz existiert. Wirkt nur auf den eigenen Lernstand, widerspricht aber der deterministischen Mastery aus ADR 0007. | gering | [curriculum-tutor-adapter.ts:493-515](../server/services/tutor/curriculum-tutor-adapter.ts#L493-L515), [learning-planner.ts:193-200](../server/services/tutor/curriculum/learning-planner.ts#L193-L200) | BLOCKED_DECISION | Dürfen Client-Ratings Mastery beeinflussen? |
| D1 | LEARN nach schwacher oder mittlerer Antwort, wenn das aktuelle Concept keine frische Frage mehr hat, das Topic aber noch andere Fragen bietet. Die SSOT regelt nur den Fall, dass das ganze Topic nicht mehr abfragbar ist (`content-exhausted`). | gering | [LearningQuestions §Zustandsübergänge](../ssot/ssot_function_definition_LearningQuestions.md) | BLOCKED_DECISION | Gewünschtes Tutor-Verhalten festlegen, dann SSOT ergänzen |
| D4 | Tutor-Sessions laufen nach einer absoluten TTL ab (Default 1 h, per `TUTOR_SESSION_TTL_MS` einstellbar), auch bei laufender Nutzung. | gering | [config.ts:412](../server/config.ts#L412), [course-content-session.ts:107](../server/services/course-content/course-content-session.ts#L107) | BLOCKED_DECISION | Absolute oder gleitende TTL? |
| D5 | Ein laufender Sketch hält seinen Simulationsslot bis zum Lauf-Timeout (Default 60 s, Client-Maximum 300 s). Pausierte Läufe enden nach `SIMULATION_MAX_PAUSED_SECONDS` (600 s), jeder Container nach `SANDBOX_MAX_LIFETIME_SECONDS` (2 h). Einen Inaktivitäts-Timeout für laufende Simulationen gibt es nicht. | gering | [input-limits.ts:40-42](../shared/input-limits.ts#L40-L42), [config.ts:246-247](../server/config.ts#L246-L247) | BLOCKED_DECISION | Reichen die vorhandenen Grenzen, oder soll eine Simulation ohne Nutzerinteraktion früher enden? |
| HOSTMOCK-REMOVAL | Der Host-Mock bleibt nach ADR 0009 (E9) als Rückfallebene neben der Browser-Emulation; zwei Laufzeiten bedeuten doppelte Wartung (Runner-Pool, Laufzeit-Sandbox, WebSocket-Simulation, Mock-Tests). | gering | [ARCHITECTURE.md, Host-Mock als Rückfallebene](ARCHITECTURE.md#host-mock-als-rückfallebene) | DEFERRED | Nach `v2.0.0` und einem Semester ohne Rückfall: eigene ADR über den Abbau nach den dort festgeschriebenen Kriterien und Umfang |

## Erweiterungen

| ID | Befund | Risiko | Beleg | Status | Nötige Entscheidung |
|---|---|---|---|---|---|
| TUTOR-PROVIDER | Der Tutor funktioniert nur mit KI:connect.nrw und persönlichen Keys; das beschränkt ihn praktisch auf Schulen und Hochschulen in NRW. | gering | [config.ts:667-670](../server/config.ts#L667-L670), [tutor.routes.ts:129](../server/routes/tutor.routes.ts#L129), [Issue #243](https://github.com/MoDevIO/UnoSim/issues/243) | BLOCKED_DECISION | Credential-Modell (nur persönliche Keys oder auch Server-Key) und Provider-Abstraktion festlegen |

## Wartung

| ID | Befund | Risiko | Beleg | Status | Nötige Entscheidung |
|---|---|---|---|---|---|
| A2-DEAD | Die Cache-Lock-API (`acquireCacheLock`) und `drain()` im Gatekeeper werden im Produktionscode nicht genutzt; 48 Testreferenzen hängen daran. | gering | [unified-gatekeeper.ts:259](../server/services/unified-gatekeeper.ts#L259), [unified-gatekeeper.ts:502](../server/services/unified-gatekeeper.ts#L502) | DEFERRED | Entfernen samt Tests (Teständerung braucht Freigabe) |
| R10-SSOTREF | Die SSOT TutorQualityEvaluation verweist auf `ssot_function_tutor_model_registration.md`, die nicht im Repository liegt. | gering | [TutorQualityEvaluation:23](../ssot/ssot_function_definition_TutorQualityEvaluation.md) | DEFERRED | Datei versionieren oder Verweis entfernen (Owner) |
