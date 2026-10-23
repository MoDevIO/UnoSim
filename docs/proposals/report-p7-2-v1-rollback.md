# Bericht P7.2: Rückkehr auf das V1-Image

> **Nicht normativ.** Einmalige Prüfung aus Plan 9.3 zu
> [browser-emulation-plan.md](browser-emulation-plan.md); wird mit dem Plan
> gelöscht. Prüfskript: [spikes/p7-2/v1-rollback-check.mjs](../../spikes/p7-2/v1-rollback-check.mjs).

## Ziel

Plan 9.3 nimmt an, dass sich eine V2-Instanz durch Ausrollen des V1-Images
zurücksetzen lässt, **ohne** Änderung an Konfiguration und `storage/`, weil V2
nur neue Variablen und neue Cache-Dateien ergänzt. Diese Annahme wird hier
einmal geprüft, in beide Richtungen.

## Aufbau

- Images:
  - V2: `unosim-server:p72`, Stand dieses PRs (Backend ohne Compiler, 726 MB);
  - V1: `unosim-server:v1.0.1-rollback`, gebaut aus `git archive v1.0.1` (1,62 GB);
  - dazu `unosim-sandbox:latest` und `unosim-compile-sandbox:latest`. `Dockerfile.sandbox` ist seit v1.0.1 unverändert.
- Ein Backend-Container je Schritt mit derselben `--env-file` und denselben Mounts:
  - `storage/` an `/app/storage`;
  - das geteilte Temp-Verzeichnis unter gleichem Pfad;
  - der Docker-Socket.
- Die `.env` ist die einer V2-Pilot-Instanz, wie Compose sie übergibt, leere
  Einträge eingeschlossen:
  - `UNOSIM_RUNTIME_BACKENDS=browser,host-mock`, `UNOSIM_DEFAULT_RUNTIME=browser`, `UNOSIM_BOARDS=`, `UNOSIM_DEFAULT_BOARD=`;
  - `COMPILE_SANDBOX_IMAGE`, `COMPILE_SANDBOX_MEMORY_MB`, `COMPILE_SANDBOX_CPU_LIMIT`, `COMPILE_SANDBOX_PIDS_LIMIT`;
  - die übrigen Variablen wie im Gateway-Deployment-Test.
- Zugang: Testprofil (`NODE_ENV=test`, `UNOSIM_DOCKER_TEST_BYPASS_GATEWAY=1`)
  statt Gateway, damit die Prüfung direkt mit dem Backend spricht. Die
  Konfigurations- und Cache-Pfade sind dieselben wie im Produktionsprofil.
- Ablauf V2 → V1 → V2:
  1. Compile (Uno, Nano);
  2. Host-Mock-Lauf über den WebSocket bis zur ersten seriellen Ausgabe;
  3. Stopp, Start des nächsten Images auf demselben `storage/`.
- Gerät: Apple M2 Pro, Docker Desktop 29.9.1 (linux/arm64), 23.10.2026.

Befehl (im Repository, beide Sandbox-Images gebaut):

```bash
node spikes/p7-2/v1-rollback-check.mjs unosim-server:p72 unosim-server:v1.0.1-rollback
```

## Ergebnis

| Schritt | Prüfung | Ergebnis |
|---|---|---|
| V2 | Readiness | 200 |
| V2 | Compile Uno | 200, `success`, Artefakt `uno` |
| V2 | Compile Nano | 200, `success`, Artefakt `nano` |
| V2 | Host-Mock-Lauf | serielle Ausgabe `0` |
| V2 | Inhalt `storage/cache/hex-cache` | `<hash>.hex`, `<hash>.output.txt`, neu `<hash>.artifact.json` |
| V1 | Readiness mit derselben `.env` und demselben `storage/` | 200; die neuen Variablen werden ignoriert |
| V1 | Compile Uno, Eintrag aus V2 | 200, `success`, kein Artefakt (V1 kennt das Feld nicht) |
| V1 | Compile Uno, neuer Sketch | 200, `success` |
| V1 | Host-Mock-Lauf | serielle Ausgabe `0` |
| V2 erneut | Compile des Eintrags, den V1 schrieb | 200, `success`, Artefakt `uno` (neu gebaut, weil der Sidecar fehlt) |
| V2 erneut | Compile des V2-Eintrags | 200, `success`, Artefakt `uno` |
| Aufräumen | Container mit dem Owner der Prüfung | keine |

## Kriterium

**Erfüllt.** Die Rückkehr auf v1.0.1 braucht weder eine Änderung an `.env`
noch eine an `storage/`, und auch der Weg zurück auf V2 nicht. Ein
V1-Cache-Eintrag ohne Sidecar wird von V2 neu gebaut, wie in P2.5 vorgesehen.

## Grenzen

- Das Gateway ist nicht beteiligt (Testprofil); dessen Vertrag hat sich mit V2
  nicht geändert und wird im Deployment-Test geprüft.
- Ein Backend, das die neuen Variablen nicht kennt, ignoriert sie. Das gilt für
  v1.0.1; ein späterer V1-Patch, der unbekannte Variablen ablehnt, müsste neu
  geprüft werden.
- Browser-Läufe gibt es in V1 nicht. Nach der Rückkehr laufen alle Sketches im
  Host-Mock; Nano und Mega 2560 sind nicht mehr wählbar.
