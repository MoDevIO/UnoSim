# Phase 3.5 — Sandbox-Vertrag

Status: implementation in progress  
Datum: 2026-09-07  
Scope: Docker-Sandbox-Vertrag, Gateway-Annahmen, Penetration-/Container-Escape-Prüfung

## Ziel

Phase 3.5 verifiziert, dass fremder Sketch-Code nur innerhalb des definierten
Sandbox-Vertrags ausgeführt wird. Die Phase lockert keine Security-Defaults,
verwendet keine echten Secrets und öffnet keine öffentlichen Bindings.

## Vertragsmatrix

| Vertragsaspekt | Bestehende Evidenz | Bewertung | Ergänzung in Phase 3.5 |
| --- | --- | --- | --- |
| Container-Isolation / Docker-Run-Flags | `tests/integration/docker-security-contract.test.ts`, `tests/server/services/docker-command-builder.test.ts` prüfen `--network none`, `--read-only`, `--cap-drop ALL`, bounded `/tmp` und `/sandbox`-Mount. | Abgedeckt | Keine Änderung nötig. |
| Ressourcenlimits | `tests/server/services/docker-command-builder.test.ts` prüft Memory, CPU und PID-Flags; `tests/core/sandbox-stress.test.ts` prüft Output-/Stress-Verhalten als Heavy-Test. | Abgedeckt | Keine Änderung nötig. |
| Netzwerkverbot | Docker-Run-Flag ist abgedeckt. Ein realer Sketch-Versuch aus dem Container heraus fehlte. | Lücke | Additiver Integrationstest mit ausgehendem TCP-Verbindungsversuch gegen eine Testadresse. |
| Read-only RootFS | Docker-Run-Flag ist abgedeckt. Ein realer Schreibversuch außerhalb `/sandbox` fehlte. | Lücke | Additiver Integrationstest: Schreiben nach `/etc` muss scheitern, Schreiben in `/sandbox` muss möglich bleiben. |
| Container-/Host-Escape | Pfadvalidierung ist durch `tests/server/security/safe-paths.test.ts` abgedeckt; ein realer Sketch-Versuch auf Host-/Daemon-Pfade fehlte. | Lücke | Additiver Integrationstest: Zugriffe auf `/var/run/docker.sock`, `/host`, `/proc/1/root/etc/passwd` und `/root/.ssh/id_rsa` dürfen nicht erfolgreich sein. |
| Cleanup / Leaks | `tests/global-setup.docker.ts`, `tests/server/services/sandbox-lifecycle.integration.test.ts`, `check-leaks.sh` und Sandbox-Runner-Stop-Tests behandeln Container-/Prozess-Cleanup. | Abgedeckt | Gate explizit dokumentieren: `./check-leaks.sh --cleanup`. |
| Timeout | `tests/integration/docker-security-contract.test.ts` und `tests/server/services/sandbox/docker-manager.test.ts` prüfen finite Timeouts und SIGKILL. | Abgedeckt | Keine Änderung nötig. |
| Gateway-Sicherheitsannahmen | `docs/adr/0001-authentication-and-gateway-contract.md`, `README_SECURITY.md`, `README_ADMIN.md` und `tests/server/security/access-control.test.ts` prüfen Gateway-Secret, Proxy, Rollen und WS-Origin. | Abgedeckt | Keine Änderung nötig. |
| Keine Secrets / keine Public Bindings | Compose verlangt externe Secrets und bindet standardmäßig an `127.0.0.1`; Tests nutzen nur Dummy-Secrets. | Abgedeckt | Diese Vorgabe bleibt Gate-Kriterium. |

## Phase-3.5-Gates

Pflichtgates für Änderungen am Sandbox-Vertrag:

1. `npm run test:security:inputs`
2. `npm run test:docker`
3. `RUN_HEAVY_TESTS=1 ./run-tests.sh`
4. `./check-leaks.sh --cleanup`
5. `npm audit --omit=dev`
6. `npm run check`
7. `npm run check:docs`
8. SonarQube-Analyse der geänderten Dateien

## Abbruchkriterien

- Ein Test benötigt echte Secrets, Tokens oder produktive Zugangsdaten.
- Ein Test oder eine Konfigurationsänderung öffnet eine öffentliche Bindung.
- Ein Test lockert `--network none`, `--read-only`, `--cap-drop ALL`,
  `no-new-privileges`, PID-, CPU-, Memory- oder Timeout-Grenzen.
- Container oder Compiler-Prozesse bleiben nach dem Gate zurück.
- Ein Befund widerspricht ADR 0001 oder den Produktionsmindestanforderungen in
  `README_SECURITY.md`.

## Abschlusskriterium

Phase 3.5 ist abgeschlossen, wenn die oben genannten Lücken durch additive Tests
abgedeckt sind und alle Phase-3.5-Gates grün oder mit explizit dokumentiertem,
nicht sicherheitsminderndem Infrastrukturgrund deferred sind.
